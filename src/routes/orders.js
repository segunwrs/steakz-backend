const router = require('express').Router();
const { db, audit, tx } = require('../db');
const { authenticate, authorize, isGlobal, scopeBranch, canTouchBranch } = require('../auth');
const { validate, h, HttpError } = require('../util');

router.use(authenticate);

const SELECT = `
  SELECT o.*, b.name AS branch_name, c.name AS customer_name, s.name AS created_by_name, d.name AS driver_name
  FROM orders o
  JOIN branches b ON b.id = o.branch_id
  LEFT JOIN users c ON c.id = o.customer_id
  LEFT JOIN users s ON s.id = o.created_by
  LEFT JOIN users d ON d.id = o.delivery_user_id`;

const itemsFor = db.prepare(`SELECT oi.*, m.name, m.category FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id WHERE oi.order_id = ?`);
const load = (id) => { const o = db.prepare(`${SELECT} WHERE o.id = ?`).get(id); if (o) o.items = itemsFor.all(o.id); return o; };

// Who can see an order: global roles all, branch staff their branch, delivery drivers their assigned drops, customers their own.
function canView(user, o) {
  if (isGlobal(user)) return true;
  if (user.role === 'customer') return o.customer_id === user.id;
  if (user.role === 'delivery') return o.branch_id === user.branch_id && (o.delivery_user_id === user.id || (o.type === 'delivery' && o.status === 'ready' && !o.delivery_user_id));
  return o.branch_id === user.branch_id;
}

router.get('/', h((req, res) => {
  const { status, type, from, to, limit } = req.query;
  const where = [], args = [];
  const u = req.user;
  if (u.role === 'customer') { where.push('o.customer_id = ?'); args.push(u.id); }
  else if (u.role === 'delivery') { where.push("o.branch_id = ? AND o.type = 'delivery' AND (o.delivery_user_id = ? OR (o.status = 'ready' AND o.delivery_user_id IS NULL))"); args.push(u.branch_id, u.id); }
  else { const b = scopeBranch(req, req.query.branch_id); if (b) { where.push('o.branch_id = ?'); args.push(b); } }
  if (status) { const list = String(status).split(','); where.push(`o.status IN (${list.map(() => '?').join(',')})`); args.push(...list); }
  if (type) { where.push('o.type = ?'); args.push(type); }
  if (from) { where.push('date(o.created_at) >= date(?)'); args.push(from); }
  if (to) { where.push('date(o.created_at) <= date(?)'); args.push(to); }
  const lim = Math.min(Number(limit) || 100, 500);
  const rows = db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.created_at DESC, o.id DESC LIMIT ${lim}`).all(...args);
  rows.forEach((o) => (o.items = itemsFor.all(o.id)));
  res.json(rows);
}));

router.get('/:id', h((req, res) => {
  const o = load(req.params.id);
  if (!o || !canView(req.user, o)) throw new HttpError(404, 'Order not found');
  res.json(o);
}));

router.post('/', authorize('admin', 'branch_manager', 'cashier', 'customer'), h((req, res) => {
  const u = req.user;
  const d = validate(req.body, {
    branch_id: 'int', type: 'required|in:dine_in,takeaway,delivery', table_no: 'string|max:10',
    delivery_address: 'string|max:200', notes: 'string|max:300', payment_method: 'in:cash,card,online',
  });
  const branchId = isGlobal(u) || u.role === 'customer' ? d.branch_id : u.branch_id;
  if (!branchId) throw new HttpError(400, 'branch_id is required');
  if (!db.prepare('SELECT 1 FROM branches WHERE id = ? AND active = 1').get(branchId)) throw new HttpError(400, 'Branch not found or closed');
  if (u.role === 'customer' && d.type === 'dine_in') throw new HttpError(400, 'Online orders must be takeaway or delivery');
  if (d.type === 'delivery' && !d.delivery_address) throw new HttpError(400, 'Delivery address is required for delivery orders');
  if (d.type === 'dine_in' && !d.table_no) throw new HttpError(400, 'Table number is required for dine-in orders');

  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw new HttpError(400, 'Order must contain at least one item');
  const priced = items.map((it) => {
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw new HttpError(400, 'Each item quantity must be 1-50');
    const m = db.prepare('SELECT * FROM menu_items WHERE id = ? AND available = 1').get(it.menu_item_id);
    if (!m) throw new HttpError(400, `Menu item ${it.menu_item_id} is not available`);
    return { menu_item_id: m.id, quantity: qty, unit_price: m.price }; // price always taken from the server, never the client
  });
  const total = Math.round(priced.reduce((s, i) => s + i.quantity * i.unit_price, 0) * 100) / 100;

  const id = tx(() => {
    const paidOnline = u.role === 'customer';
    const r = db.prepare(`INSERT INTO orders (branch_id, customer_id, created_by, type, table_no, delivery_address, notes, total, payment_status, payment_method)
                          VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(branchId, u.role === 'customer' ? u.id : null, u.id, d.type, d.table_no || null, d.delivery_address || null, d.notes || null, total,
        paidOnline ? 'paid' : 'unpaid', paidOnline ? 'online' : null);
    const ins = db.prepare('INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price) VALUES (?,?,?,?)');
    priced.forEach((i) => ins.run(r.lastInsertRowid, i.menu_item_id, i.quantity, i.unit_price));
    return r.lastInsertRowid;
  });
  audit(u.id, 'create', 'order', id, { total, type: d.type });
  res.status(201).json(load(id));
}));

// Status workflow. Each transition lists the roles allowed to make it (admin can always).
const FLOW = {
  'pending>preparing': ['chef', 'branch_manager'],
  'preparing>ready': ['chef', 'branch_manager'],
  'ready>completed': ['cashier', 'branch_manager'],             // served at table / collected
  'ready>out_for_delivery': ['delivery', 'branch_manager'],
  'out_for_delivery>completed': ['delivery', 'branch_manager'],
  'pending>cancelled': ['cashier', 'branch_manager', 'customer'],
  'preparing>cancelled': ['branch_manager'],
};

router.patch('/:id/status', authorize('admin', 'branch_manager', 'chef', 'cashier', 'delivery', 'customer'), h((req, res) => {
  const d = validate(req.body, { status: 'required|in:pending,preparing,ready,out_for_delivery,completed,cancelled' });
  const o = load(req.params.id);
  if (!o || !canView(req.user, o) || !canTouchBranch(req.user, o.branch_id) && req.user.role !== 'customer') throw new HttpError(404, 'Order not found');
  const key = `${o.status}>${d.status}`;
  const allowed = FLOW[key];
  if (!allowed) throw new HttpError(400, `Cannot move an order from ${o.status} to ${d.status}`);
  if (req.user.role !== 'admin' && !allowed.includes(req.user.role)) throw new HttpError(403, `Your role cannot move orders from ${o.status} to ${d.status}`);
  if (d.status === 'out_for_delivery' && o.type !== 'delivery') throw new HttpError(400, 'Only delivery orders can go out for delivery');
  if (key === 'ready>completed' && o.type === 'delivery') throw new HttpError(400, 'Delivery orders are completed by the driver');
  if (d.status === 'completed' && o.payment_status !== 'paid' && o.type !== 'delivery') throw new HttpError(400, 'Take payment before completing this order');

  tx(() => {
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(d.status, o.id);
    if (d.status === 'out_for_delivery' && req.user.role === 'delivery') db.prepare('UPDATE orders SET delivery_user_id = ? WHERE id = ?').run(req.user.id, o.id);
    // Cash on delivery is marked paid when the driver completes the drop.
    if (o.type === 'delivery' && d.status === 'completed' && o.payment_status !== 'paid') db.prepare("UPDATE orders SET payment_status='paid', payment_method='cash' WHERE id = ?").run(o.id);
    if (d.status === 'cancelled' && o.payment_status === 'paid') db.prepare("UPDATE orders SET payment_status='refunded' WHERE id = ?").run(o.id);
  });
  audit(req.user.id, 'status', 'order', o.id, { from: o.status, to: d.status });
  res.json(load(o.id));
}));

router.patch('/:id/payment', authorize('admin', 'branch_manager', 'cashier'), h((req, res) => {
  const d = validate(req.body, { payment_method: 'required|in:cash,card' });
  const o = load(req.params.id);
  if (!o || !canTouchBranch(req.user, o.branch_id)) throw new HttpError(404, 'Order not found');
  if (o.payment_status === 'paid') throw new HttpError(400, 'Order is already paid');
  if (o.status === 'cancelled') throw new HttpError(400, 'Order is cancelled');
  db.prepare("UPDATE orders SET payment_status='paid', payment_method=?, updated_at=datetime('now') WHERE id=?").run(d.payment_method, o.id);
  audit(req.user.id, 'payment', 'order', o.id, { method: d.payment_method, total: o.total });
  res.json(load(o.id));
}));

router.patch('/:id/assign', authorize('admin', 'branch_manager', 'cashier'), h((req, res) => {
  const d = validate(req.body, { delivery_user_id: 'required|int' });
  const o = load(req.params.id);
  if (!o || !canTouchBranch(req.user, o.branch_id)) throw new HttpError(404, 'Order not found');
  if (o.type !== 'delivery') throw new HttpError(400, 'Not a delivery order');
  const driver = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'delivery' AND active = 1").get(d.delivery_user_id);
  if (!driver || driver.branch_id !== o.branch_id) throw new HttpError(400, 'Driver must be an active delivery user in the same branch');
  db.prepare("UPDATE orders SET delivery_user_id = ?, updated_at = datetime('now') WHERE id = ?").run(driver.id, o.id);
  audit(req.user.id, 'assign_driver', 'order', o.id, { driver: driver.id });
  res.json(load(o.id));
}));

module.exports = router;
