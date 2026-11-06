// Open area: no login needed.
const router = require('express').Router();
const { db, audit } = require('../db');
const { validate, h, HttpError } = require('../util');

router.get('/branches', (req, res) => {
  res.json(db.prepare('SELECT id, name, city, address, phone, seats FROM branches WHERE active = 1 ORDER BY city').all());
});

router.get('/menu', (req, res) => {
  res.json(db.prepare('SELECT id, name, category, description, price, allergens FROM menu_items WHERE available = 1 ORDER BY category, name').all());
});

// Guests can book a table without an account. Logged-in customers use /api/reservations instead.
router.post('/reservations', h((req, res) => {
  const d = validate(req.body, {
    branch_id: 'required|int', name: 'required|string|min:2|max:80', phone: 'required|string|min:6|max:30',
    date: 'required|date', time: 'required|time', party_size: 'required|int|min:1|max:20',
  });
  if (!db.prepare('SELECT 1 FROM branches WHERE id = ? AND active = 1').get(d.branch_id)) throw new HttpError(404, 'Branch not found');
  if (d.date < new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Reservation date cannot be in the past');
  const r = db.prepare('INSERT INTO reservations (branch_id, name, phone, date, time, party_size) VALUES (?,?,?,?,?,?)')
    .run(d.branch_id, d.name, d.phone, d.date, d.time, d.party_size);
  audit(null, 'create', 'reservation', r.lastInsertRowid, { source: 'public' });
  res.status(201).json({ id: r.lastInsertRowid, message: 'Table booked. See you soon!' });
}));

module.exports = router;
