const router = require('express').Router();
const { db, audit } = require('../db');
const { authenticate, authorize, scopeBranch, canTouchBranch } = require('../auth');
const { validate, h, HttpError } = require('../util');

router.use(authenticate);

router.get('/', authorize('admin', 'hq_manager', 'branch_manager', 'cashier', 'customer'), (req, res) => {
  const where = [], args = [];
  if (req.user.role === 'customer') { where.push('r.customer_id = ?'); args.push(req.user.id); }
  else { const b = scopeBranch(req, req.query.branch_id); if (b) { where.push('r.branch_id = ?'); args.push(b); } }
  if (req.query.date) { where.push('r.date = ?'); args.push(req.query.date); }
  if (req.query.upcoming === '1') where.push("r.date >= date('now')");
  res.json(db.prepare(`SELECT r.*, b.name AS branch_name FROM reservations r JOIN branches b ON b.id = r.branch_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.date, r.time LIMIT 300`).all(...args));
});

router.post('/', authorize('customer', 'cashier', 'branch_manager', 'admin'), h((req, res) => {
  const d = validate(req.body, { branch_id: 'int', name: 'string|min:2|max:80', phone: 'string|min:6|max:30', date: 'required|date', time: 'required|time', party_size: 'required|int|min:1|max:20' });
  const u = req.user;
  const branchId = ['cashier', 'branch_manager'].includes(u.role) ? u.branch_id : d.branch_id;
  if (!branchId || !db.prepare('SELECT 1 FROM branches WHERE id = ? AND active = 1').get(branchId)) throw new HttpError(400, 'Valid branch_id is required');
  if (d.date < new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Reservation date cannot be in the past');
  const name = d.name || u.name, phone = d.phone || u.phone;
  if (!phone) throw new HttpError(400, 'Phone number is required');
  const r = db.prepare('INSERT INTO reservations (branch_id, customer_id, name, phone, date, time, party_size) VALUES (?,?,?,?,?,?,?)')
    .run(branchId, u.role === 'customer' ? u.id : null, name, phone, d.date, d.time, d.party_size);
  audit(u.id, 'create', 'reservation', r.lastInsertRowid);
  res.status(201).json(db.prepare('SELECT * FROM reservations WHERE id = ?').get(r.lastInsertRowid));
}));

router.patch('/:id', authorize('customer', 'cashier', 'branch_manager', 'admin'), h((req, res) => {
  const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  const u = req.user;
  const mine = u.role === 'customer' ? r?.customer_id === u.id : r && canTouchBranch(u, r.branch_id);
  if (!mine) throw new HttpError(404, 'Reservation not found');
  const d = validate(req.body, { status: `required|in:${u.role === 'customer' ? 'cancelled' : 'booked,seated,cancelled,no_show'}` });
  db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(d.status, r.id);
  audit(u.id, 'status', 'reservation', r.id, { to: d.status });
  res.json(db.prepare('SELECT * FROM reservations WHERE id = ?').get(r.id));
}));

module.exports = router;
