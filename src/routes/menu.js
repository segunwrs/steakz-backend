const router = require('express').Router();
const { db, audit } = require('../db');
const { authenticate, authorize } = require('../auth');
const { validate, h, HttpError } = require('../util');

router.use(authenticate);

// Staff see unavailable items too (to switch them back on); customers use /api/public/menu.
router.get('/', authorize('admin', 'hq_manager', 'branch_manager', 'chef', 'cashier', 'delivery', 'customer'), (req, res) => {
  const all = req.user.role !== 'customer';
  res.json(db.prepare(`SELECT * FROM menu_items ${all ? '' : 'WHERE available = 1'} ORDER BY category, name`).all());
});

const rules = { name: 'required|string|min:2|max:80', category: 'required|string|max:40', description: 'string|max:300', price: 'required|number|min:0', allergens: 'string|max:200', available: 'bool' };

router.post('/', authorize('admin', 'hq_manager'), h((req, res) => {
  const d = validate(req.body, rules);
  const r = db.prepare('INSERT INTO menu_items (name, category, description, price, allergens, available) VALUES (?,?,?,?,?,?)')
    .run(d.name, d.category, d.description || null, d.price, d.allergens || null, d.available ?? 1);
  audit(req.user.id, 'create', 'menu_item', r.lastInsertRowid, d);
  res.status(201).json(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(r.lastInsertRowid));
}));

router.put('/:id', authorize('admin', 'hq_manager'), h((req, res) => {
  const m = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  if (!m) throw new HttpError(404, 'Menu item not found');
  const d = validate({ ...m, ...req.body }, rules);
  db.prepare('UPDATE menu_items SET name=?, category=?, description=?, price=?, allergens=?, available=? WHERE id=?')
    .run(d.name, d.category, d.description || null, d.price, d.allergens || null, d.available, m.id);
  audit(req.user.id, 'update', 'menu_item', m.id, req.body);
  res.json(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(m.id));
}));

router.delete('/:id', authorize('admin', 'hq_manager'), h((req, res) => {
  const m = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  if (!m) throw new HttpError(404, 'Menu item not found');
  if (db.prepare('SELECT 1 FROM order_items WHERE menu_item_id = ? LIMIT 1').get(m.id)) {
    db.prepare('UPDATE menu_items SET available = 0 WHERE id = ?').run(m.id);
    audit(req.user.id, 'archive', 'menu_item', m.id);
    return res.json({ message: 'Item has sales history, so it was hidden from the menu instead of deleted' });
  }
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(m.id);
  audit(req.user.id, 'delete', 'menu_item', m.id);
  res.json({ message: 'Menu item deleted' });
}));

module.exports = router;
