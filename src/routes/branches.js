const router = require('express').Router();
const { db, audit } = require('../db');
const { authenticate, authorize, isGlobal } = require('../auth');
const { validate, h, HttpError } = require('../util');

router.use(authenticate);

router.get('/', authorize('admin', 'hq_manager', 'branch_manager', 'chef', 'cashier', 'delivery'), (req, res) => {
  const sql = `SELECT b.*, (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id AND u.role <> 'customer') AS staff_count
               FROM branches b`;
  const rows = isGlobal(req.user)
    ? db.prepare(sql + ' ORDER BY b.city').all()
    : db.prepare(sql + ' WHERE b.id = ?').all(req.user.branch_id);
  res.json(rows);
});

const rules = { name: 'required|string|min:2|max:80', city: 'required|string|max:60', address: 'required|string|max:160', phone: 'string|max:30', seats: 'int|min:1|max:1000', active: 'bool' };

router.post('/', authorize('admin'), h((req, res) => {
  const d = validate(req.body, rules);
  if (db.prepare('SELECT 1 FROM branches WHERE name = ?').get(d.name)) throw new HttpError(409, 'A branch with this name already exists');
  const r = db.prepare('INSERT INTO branches (name, city, address, phone, seats) VALUES (?,?,?,?,?)')
    .run(d.name, d.city, d.address, d.phone || null, d.seats || 80);
  audit(req.user.id, 'create', 'branch', r.lastInsertRowid, d);
  res.status(201).json(db.prepare('SELECT * FROM branches WHERE id = ?').get(r.lastInsertRowid));
}));

router.put('/:id', authorize('admin'), h((req, res) => {
  const b = db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id);
  if (!b) throw new HttpError(404, 'Branch not found');
  const d = validate({ ...b, ...req.body }, rules);
  db.prepare('UPDATE branches SET name=?, city=?, address=?, phone=?, seats=?, active=? WHERE id=?')
    .run(d.name, d.city, d.address, d.phone || null, d.seats, d.active ?? b.active, b.id);
  audit(req.user.id, 'update', 'branch', b.id, req.body);
  res.json(db.prepare('SELECT * FROM branches WHERE id = ?').get(b.id));
}));

router.delete('/:id', authorize('admin'), h((req, res) => {
  const b = db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id);
  if (!b) throw new HttpError(404, 'Branch not found');
  // Branches with trading history are deactivated, not deleted, so past sales stay reportable.
  const hasOrders = db.prepare('SELECT 1 FROM orders WHERE branch_id = ? LIMIT 1').get(b.id);
  if (hasOrders) {
    db.prepare('UPDATE branches SET active = 0 WHERE id = ?').run(b.id);
    audit(req.user.id, 'deactivate', 'branch', b.id);
    return res.json({ message: 'Branch has order history, so it was deactivated instead of deleted' });
  }
  db.prepare('DELETE FROM branches WHERE id = ?').run(b.id);
  audit(req.user.id, 'delete', 'branch', b.id);
  res.json({ message: 'Branch deleted' });
}));

module.exports = router;
