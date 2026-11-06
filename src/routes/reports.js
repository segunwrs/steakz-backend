// Management reporting: the "information" side of the MIS.
const router = require('express').Router();
const { db } = require('../db');
const { authenticate, authorize, scopeBranch, isGlobal } = require('../auth');
const { h } = require('../util');

router.use(authenticate, authorize('admin', 'hq_manager', 'branch_manager'));

function range(q) {
  const to = q.to || new Date().toISOString().slice(0, 10);
  const from = q.from || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  return { from, to };
}

router.get('/summary', h((req, res) => {
  const { from, to } = range(req.query);
  const b = scopeBranch(req, req.query.branch_id);
  const bw = b ? 'AND o.branch_id = ?' : '';
  const a = (...x) => (b ? [...x, b] : x);
  const period = "date(o.created_at) BETWEEN date(?) AND date(?)";

  const kpi = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN o.status <> 'cancelled' THEN o.total END),0) AS revenue,
      COUNT(*) AS orders,
      SUM(o.status = 'cancelled') AS cancelled,
      COALESCE(AVG(CASE WHEN o.status <> 'cancelled' THEN o.total END),0) AS avg_order_value,
      SUM(o.status IN ('pending','preparing','ready','out_for_delivery')) AS open_orders
    FROM orders o WHERE ${period} ${bw}`).get(...a(from, to));

  const byDay = db.prepare(`SELECT date(o.created_at) AS day, ROUND(SUM(o.total),2) AS revenue, COUNT(*) AS orders
    FROM orders o WHERE o.status <> 'cancelled' AND ${period} ${bw} GROUP BY day ORDER BY day`).all(...a(from, to));

  const byBranch = (isGlobal(req.user) && !b) ? db.prepare(`SELECT br.id, br.name, br.city,
      ROUND(COALESCE(SUM(CASE WHEN o.status <> 'cancelled' THEN o.total END),0),2) AS revenue, COUNT(o.id) AS orders,
      ROUND(COALESCE(AVG(CASE WHEN o.status <> 'cancelled' THEN o.total END),0),2) AS avg_order_value
    FROM branches br LEFT JOIN orders o ON o.branch_id = br.id AND ${period}
    GROUP BY br.id ORDER BY revenue DESC`).all(from, to) : [];

  const topItems = db.prepare(`SELECT m.name, m.category, SUM(oi.quantity) AS qty, ROUND(SUM(oi.quantity * oi.unit_price),2) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN menu_items m ON m.id = oi.menu_item_id
    WHERE o.status <> 'cancelled' AND ${period} ${bw} GROUP BY m.id ORDER BY revenue DESC LIMIT 8`).all(...a(from, to));

  const byType = db.prepare(`SELECT o.type, COUNT(*) AS orders, ROUND(SUM(o.total),2) AS revenue
    FROM orders o WHERE o.status <> 'cancelled' AND ${period} ${bw} GROUP BY o.type`).all(...a(from, to));

  const byHour = db.prepare(`SELECT CAST(strftime('%H', o.created_at) AS INTEGER) AS hour, COUNT(*) AS orders
    FROM orders o WHERE o.status <> 'cancelled' AND ${period} ${bw} GROUP BY hour ORDER BY hour`).all(...a(from, to));

  const lowStock = db.prepare(`SELECT i.id, i.name, i.unit, i.quantity, i.reorder_level, br.name AS branch_name
    FROM inventory_items i JOIN branches br ON br.id = i.branch_id
    WHERE i.quantity <= i.reorder_level ${b ? 'AND i.branch_id = ?' : ''} ORDER BY br.name, i.name`).all(...(b ? [b] : []));

  const reservations = db.prepare(`SELECT COUNT(*) AS upcoming, COALESCE(SUM(party_size),0) AS covers FROM reservations r
    WHERE r.status = 'booked' AND r.date >= date('now') ${b ? 'AND r.branch_id = ?' : ''}`).get(...(b ? [b] : []));

  res.json({ from, to, branch_id: b, kpi, byDay, byBranch, topItems, byType, byHour, lowStock, reservations });
}));

// CSV export so managers can take numbers into Excel.
router.get('/sales.csv', h((req, res) => {
  const { from, to } = range(req.query);
  const b = scopeBranch(req, req.query.branch_id);
  const rows = db.prepare(`SELECT o.id, br.name AS branch, o.type, o.status, o.payment_status, o.payment_method, o.total, o.created_at
    FROM orders o JOIN branches br ON br.id = o.branch_id
    WHERE date(o.created_at) BETWEEN date(?) AND date(?) ${b ? 'AND o.branch_id = ?' : ''} ORDER BY o.created_at`).all(...(b ? [from, to, b] : [from, to]));
  const head = 'order_id,branch,type,status,payment_status,payment_method,total,created_at';
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const csv = [head, ...rows.map((r) => Object.values(r).map(esc).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="steakz-sales-${from}-to-${to}.csv"`);
  res.send(csv);
}));

module.exports = router;
