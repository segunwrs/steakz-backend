const router = require('express').Router();
const { db } = require('../db');
const { authenticate, authorize } = require('../auth');

router.use(authenticate, authorize('admin'));

router.get('/audit-logs', (req, res) => {
  const lim = Math.min(Number(req.query.limit) || 100, 500);
  const where = [], args = [];
  if (req.query.entity) { where.push('a.entity = ?'); args.push(req.query.entity); }
  if (req.query.user_id) { where.push('a.user_id = ?'); args.push(Number(req.query.user_id)); }
  res.json(db.prepare(`SELECT a.*, u.name AS user_name, u.role AS user_role FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ${lim}`).all(...args));
});

router.get('/stats', (req, res) => {
  const one = (sql) => db.prepare(sql).get().c;
  res.json({
    branches: one('SELECT COUNT(*) c FROM branches WHERE active = 1'),
    users: one("SELECT COUNT(*) c FROM users WHERE role <> 'customer'"),
    customers: one("SELECT COUNT(*) c FROM users WHERE role = 'customer'"),
    menu_items: one('SELECT COUNT(*) c FROM menu_items WHERE available = 1'),
    orders_today: one("SELECT COUNT(*) c FROM orders WHERE date(created_at) = date('now')"),
    logins_24h: one("SELECT COUNT(*) c FROM audit_logs WHERE action = 'login' AND created_at >= datetime('now','-1 day')"),
    disabled_users: one('SELECT COUNT(*) c FROM users WHERE active = 0'),
    users_by_role: db.prepare('SELECT role, COUNT(*) AS count FROM users GROUP BY role ORDER BY count DESC').all(),
  });
});

module.exports = router;
