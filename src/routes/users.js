const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, audit } = require('../db');
const { authenticate, authorize, publicUser, ROLES, BRANCH_BOUND } = require('../auth');
const { validate, h, HttpError } = require('../util');

router.use(authenticate);

const STAFF_A_MANAGER_CAN_MANAGE = ['chef', 'cashier', 'delivery'];
const base = `SELECT u.*, b.name AS branch_name FROM users u LEFT JOIN branches b ON b.id = u.branch_id`;

router.get('/', authorize('admin', 'hq_manager', 'branch_manager'), (req, res) => {
  const { role, branch_id, q } = req.query;
  const where = [], args = [];
  if (req.user.role === 'branch_manager') { where.push('u.branch_id = ?'); args.push(req.user.branch_id); }
  else if (branch_id) { where.push('u.branch_id = ?'); args.push(Number(branch_id)); }
  if (role) { where.push('u.role = ?'); args.push(role); }
  if (q) { where.push('(u.name LIKE ? OR u.email LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const rows = db.prepare(`${base} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.role, u.name`).all(...args);
  res.json(rows.map(publicUser));
});

function checkBranchRule(role, branchId) {
  if (BRANCH_BOUND.includes(role) && !branchId) throw new HttpError(400, 'This role must be assigned to a branch');
  if (branchId && !db.prepare('SELECT 1 FROM branches WHERE id = ?').get(branchId)) throw new HttpError(400, 'Branch does not exist');
}

router.post('/', authorize('admin', 'branch_manager'), h((req, res) => {
  // Permission check first, so an unauthorised request gets 403 before any validation detail is revealed.
  if (req.user.role === 'branch_manager' && !STAFF_A_MANAGER_CAN_MANAGE.includes(req.body?.role))
    throw new HttpError(403, 'Branch managers can only create chef, cashier/waiter or delivery accounts');
  const d = validate(req.body, {
    name: 'required|string|min:2|max:80', email: 'required|email', password: 'required|string|min:8|max:100',
    role: `required|in:${ROLES.join(',')}`, branch_id: 'int', phone: 'string|max:30',
  });
  if (req.user.role === 'branch_manager') {
    // Branch managers can only hire operational staff into their own branch.
    if (!STAFF_A_MANAGER_CAN_MANAGE.includes(d.role)) throw new HttpError(403, 'Branch managers can only create chef, cashier/waiter or delivery accounts');
    d.branch_id = req.user.branch_id;
  }
  if (!BRANCH_BOUND.includes(d.role)) d.branch_id = null;
  checkBranchRule(d.role, d.branch_id);
  const email = d.email.toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with this email already exists');
  const r = db.prepare('INSERT INTO users (name, email, password_hash, role, branch_id, phone) VALUES (?,?,?,?,?,?)')
    .run(d.name, email, bcrypt.hashSync(d.password, 10), d.role, d.branch_id ?? null, d.phone || null);
  audit(req.user.id, 'create', 'user', r.lastInsertRowid, { role: d.role, branch_id: d.branch_id });
  res.status(201).json(publicUser(db.prepare(`${base} WHERE u.id = ?`).get(r.lastInsertRowid)));
}));

router.put('/:id', authorize('admin', 'branch_manager'), h((req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) throw new HttpError(404, 'User not found');
  const d = validate(req.body, {
    name: 'string|min:2|max:80', email: 'email', role: `in:${ROLES.join(',')}`, branch_id: 'int',
    phone: 'string|max:30', active: 'bool', password: 'string|min:8|max:100',
  });
  if (req.user.role === 'branch_manager') {
    if (target.branch_id !== req.user.branch_id || !STAFF_A_MANAGER_CAN_MANAGE.includes(target.role))
      throw new HttpError(403, 'You can only edit operational staff in your own branch');
    if (d.role && !STAFF_A_MANAGER_CAN_MANAGE.includes(d.role)) throw new HttpError(403, 'You cannot promote staff to that role');
    delete d.branch_id; // cannot move staff to another branch
  }
  if (target.id === req.user.id && (d.role || d.active === 0)) throw new HttpError(400, 'You cannot change your own role or disable yourself');
  const next = { ...target, ...d };
  if (d.email) {
    next.email = d.email.toLowerCase();
    if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(next.email, target.id)) throw new HttpError(409, 'Email already in use');
  }
  if (!BRANCH_BOUND.includes(next.role)) next.branch_id = null;
  checkBranchRule(next.role, next.branch_id);
  if (d.password) next.password_hash = bcrypt.hashSync(d.password, 10);
  db.prepare('UPDATE users SET name=?, email=?, role=?, branch_id=?, phone=?, active=?, password_hash=? WHERE id=?')
    .run(next.name, next.email, next.role, next.branch_id ?? null, next.phone ?? null, next.active, next.password_hash, target.id);
  const { password, ...logged } = d;
  audit(req.user.id, 'update', 'user', target.id, { ...logged, password_reset: !!password });
  res.json(publicUser(db.prepare(`${base} WHERE u.id = ?`).get(target.id)));
}));

router.delete('/:id', authorize('admin'), h((req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) throw new HttpError(404, 'User not found');
  if (target.id === req.user.id) throw new HttpError(400, 'You cannot delete your own account');
  if (target.role === 'admin' && db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c <= 1)
    throw new HttpError(400, 'Cannot delete the last admin');
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  audit(req.user.id, 'delete', 'user', target.id, { email: target.email, role: target.role });
  res.json({ message: 'User deleted' });
}));

module.exports = router;
