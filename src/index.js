require('dotenv').config();
const { db } = require('./db');

// First run on a fresh database: load demo data automatically.
if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
  console.log('Empty database - seeding demo data...');
  require('./seed').seed();
}

const app = require('./app');
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Steakz MIS API running on http://localhost:${port}`));
