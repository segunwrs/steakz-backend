const router = require('express').Router();
const { db, audit } = require('../db');
const { authenticate, authorize, scopeBranch, canTouchBranch, isGlobal } = require('../auth');
const { validate, h, HttpError } = require('../util');

router.use(authenticate);

router.get('/', authorize('admin', 'hq_manager', 'branch_manager', 'chef'), (req, res) => {
  const b = scopeBranch(req, req.query.branch_id);
  const low = req.query.low === '1';
  const where = [], args = [];
  if (b) { where.push('i.branch_id = ?'); args.push(b); }
  if (low) where.push('i.quantity <= i.reorder_level');
  res.json(db.prepare(`SELECT i.*, br.name AS branch_name, (i.quantity <= i.reorder_level) AS low_stock
    FROM inventory_items i JOIN branches br ON br.id = i.branch_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY br.name, low_stock DESC, i.name`).all(...args));
});

router.post('/', authorize('admin', 'branch_manager'), h((req, res) => {
  const d = validate(req.body, { branch_id: 'int', name: 'required|string|min:2|max:80', unit: 'required|string|max:20', quantity: 'required|number|min:0', reorder_level: 'required|number|min:0' });
  const branchId = isGlobal(req.user) ? d.branch_id : req.user.branch_id;
  if (!branchId) throw new HttpError(400, 'branch_id is required');
  if (db.prepare('SELECT 1 FROM inventory_items WHERE branch_id = ? AND name = ?').get(branchId, d.name)) throw new HttpError(409, 'This item already exists in the branch stock list');
  const r = db.prepare('INSERT INTO inventory_items (branch_id, name, unit, quantity, reorder_level) VALUES (?,?,?,?,?)')
    .run(branchId, d.name, d.unit, d.quantity, d.reorder_level);
  audit(req.user.id, 'create', 'inventory', r.lastInsertRowid, d);
  res.status(201).json(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(r.lastInsertRowid));
}));

// Chefs record stock counts; managers can also change units and reorder levels.
router.patch('/:id', authorize('admin', 'branch_manager', 'chef'), h((req, res) => {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
  if (!item || !canTouchBranch(req.user, item.branch_id)) throw new HttpError(404, 'Stock item not found');
  const rules = req.user.role === 'chef'
    ? { quantity: 'required|number|min:0' }
    : { name: 'string|min:2|max:80', unit: 'string|max:20', quantity: 'number|min:0', reorder_level: 'number|min:0' };
  const d = validate(req.body, rules);
  const n = { ...item, ...d };
  db.prepare("UPDATE inventory_items SET name=?, unit=?, quantity=?, reorder_level=?, updated_at=datetime('now') WHERE id=?")
    .run(n.name, n.unit, n.quantity, n.reorder_level, item.id);
  audit(req.user.id, 'update', 'inventory', item.id, { before: item.quantity, after: n.quantity });
  res.json(db.prepare('SELECT *, (quantity <= reorder_level) AS low_stock FROM inventory_items WHERE id = ?').get(item.id));
}));

router.delete('/:id', authorize('admin', 'branch_manager'), h((req, res) => {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
  if (!item || !canTouchBranch(req.user, item.branch_id)) throw new HttpError(404, 'Stock item not found');
  db.prepare('DELETE FROM inventory_items WHERE id = ?').run(item.id);
  audit(req.user.id, 'delete', 'inventory', item.id, { name: item.name });
  res.json({ message: 'Stock item removed' });
}));

module.exports = router;
