const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, audit } = require('../db');
const { sign, publicUser, authenticate } = require('../auth');
const { validate, h, HttpError } = require('../util');

const withBranch = (id) => db.prepare(`
  SELECT u.*, b.name AS branch_name FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.id = ?`).get(id);

// Public sign-up is for customers only. Staff accounts are created by an admin or branch manager.
router.post('/register', h((req, res) => {
  const d = validate(req.body, { name: 'required|string|min:2|max:80', email: 'required|email', password: 'required|string|min:8|max:100', phone: 'string|max:30' });
  const email = d.email.toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with this email already exists');
  const r = db.prepare('INSERT INTO users (name, email, password_hash, role, phone) VALUES (?,?,?,?,?)')
    .run(d.name, email, bcrypt.hashSync(d.password, 10), 'customer', d.phone || null);
  audit(r.lastInsertRowid, 'register', 'user', r.lastInsertRowid);
  const user = withBranch(r.lastInsertRowid);
  res.status(201).json({ token: sign(user), user: publicUser(user) });
}));

router.post('/login', h((req, res) => {
  const d = validate(req.body, { email: 'required|email', password: 'required|string' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(d.email.toLowerCase());
  // Same message for unknown email and wrong password, so accounts can't be enumerated.
  if (!user || !bcrypt.compareSync(d.password, user.password_hash)) throw new HttpError(401, 'Incorrect email or password');
  if (!user.active) throw new HttpError(403, 'This account has been disabled. Contact your manager.');
  audit(user.id, 'login', 'user', user.id);
  res.json({ token: sign(user), user: publicUser(withBranch(user.id)) });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(withBranch(req.user.id)) }));

router.patch('/me/password', authenticate, h((req, res) => {
  const d = validate(req.body, { current_password: 'required|string', new_password: 'required|string|min:8|max:100' });
  if (!bcrypt.compareSync(d.current_password, req.user.password_hash)) throw new HttpError(400, 'Current password is incorrect');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(d.new_password, 10), req.user.id);
  audit(req.user.id, 'change_password', 'user', req.user.id);
  res.json({ message: 'Password updated' });
}));

module.exports = router;
