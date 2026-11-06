// Demo data for Steakz: 3 UK branches, every role, menu, stock, ~45 days of orders.
// Run on its own with `npm run seed` (wipes and reloads), or automatically on first start.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, tx } = require('./db');

const PASSWORD = process.env.SEED_PASSWORD || 'Steakz@2026';

function seed() {
  // Deterministic pseudo-random so screenshots and reports are repeatable.
  let s = 42;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  tx(() => {
    db.exec(`DELETE FROM audit_logs; DELETE FROM order_items; DELETE FROM orders; DELETE FROM reservations;
             DELETE FROM inventory_items; DELETE FROM menu_items; DELETE FROM users; DELETE FROM branches;
             DELETE FROM sqlite_sequence;`);

    const branches = [
      ['Steakz London Soho', 'London', '42 Dean Street, London W1D 4PZ', '020 7946 0101', 120],
      ['Steakz Manchester', 'Manchester', '15 Deansgate, Manchester M3 2BA', '0161 496 0202', 100],
      ['Steakz Leeds', 'Leeds', '8 Briggate, Leeds LS1 6HD', '0113 496 0303', 80],
    ];
    const bIns = db.prepare('INSERT INTO branches (name, city, address, phone, seats) VALUES (?,?,?,?,?)');
    const branchIds = branches.map((b) => Number(bIns.run(...b).lastInsertRowid));

    const hash = bcrypt.hashSync(PASSWORD, 10);
    const uIns = db.prepare('INSERT INTO users (name, email, password_hash, role, branch_id, phone) VALUES (?,?,?,?,?,?)');
    const user = (name, email, role, branch = null, phone = null) => Number(uIns.run(name, email, hash, role, branch, phone).lastInsertRowid);

    user('Amara Okafor', 'admin@steakz.co.uk', 'admin');
    user('James Whitfield', 'hq@steakz.co.uk', 'hq_manager');
    const codes = ['london', 'manchester', 'leeds'];
    const staff = {};
    const names = {
      london: ['Priya Shah', 'Tom Baker', 'Lucy Grant', 'Ade Bello', 'Kai Chen'],
      manchester: ['Sophie Turner', 'Marco Rossi', 'Hannah Lee', 'Ryan Patel', 'Zoe Clarke'],
      leeds: ['Daniel Hughes', 'Fatima Noor', 'Ollie Wright', 'Ella Brown', 'Sam Ward'],
    };
    codes.forEach((c, i) => {
      const b = branchIds[i], n = names[c];
      staff[b] = {
        manager: user(n[0], `manager.${c}@steakz.co.uk`, 'branch_manager', b),
        chef: user(n[1], `chef.${c}@steakz.co.uk`, 'chef', b),
        cashier: user(n[2], `cashier.${c}@steakz.co.uk`, 'cashier', b),
        cashier2: user(n[3], `waiter.${c}@steakz.co.uk`, 'cashier', b),
        driver: user(n[4], `driver.${c}@steakz.co.uk`, 'delivery', b),
      };
    });
    const customers = [
      ['Emily Carter', 'emily@example.com', '07700 900111'], ['Noah Evans', 'noah@example.com', '07700 900222'],
      ['Grace Hall', 'grace@example.com', '07700 900333'], ['Leo Morris', 'leo@example.com', '07700 900444'],
    ].map(([n, e, p]) => user(n, e, 'customer', null, p));

    const menu = [
      ['Ribeye 10oz', 'Steaks', '28-day dry-aged British ribeye, chips and peppercorn sauce', 29.5, 'Milk'],
      ['Sirloin 8oz', 'Steaks', 'Grass-fed Scottish sirloin with garlic butter', 24.0, 'Milk'],
      ['Fillet 7oz', 'Steaks', 'Centre-cut fillet, the tenderest cut', 34.0, null],
      ['T-Bone 16oz', 'Steaks', 'Sirloin and fillet on the bone, for big appetites', 39.0, null],
      ['Steakz Burger', 'Burgers', 'Chuck and brisket patty, cheddar, brioche bun', 15.5, 'Gluten, Milk, Egg, Sesame'],
      ['Mushroom Burger', 'Burgers', 'Portobello, halloumi, rocket (vegetarian)', 13.5, 'Gluten, Milk'],
      ['Prawn Cocktail', 'Starters', 'Classic with Marie Rose sauce', 8.5, 'Crustaceans, Egg'],
      ['Beef Carpaccio', 'Starters', 'Rocket, parmesan, truffle oil', 9.5, 'Milk'],
      ['Triple-cooked Chips', 'Sides', null, 4.5, null],
      ['Mac & Cheese', 'Sides', 'Three-cheese, crispy crumb', 5.5, 'Gluten, Milk'],
      ['House Salad', 'Sides', null, 4.0, 'Mustard'],
      ['Sticky Toffee Pudding', 'Desserts', 'With vanilla ice cream', 7.5, 'Gluten, Milk, Egg'],
      ['Chocolate Brownie', 'Desserts', null, 6.5, 'Gluten, Milk, Egg, Nuts'],
      ['House Red (175ml)', 'Drinks', 'Malbec, Argentina', 7.0, 'Sulphites'],
      ['Craft Lager', 'Drinks', 'Pint', 5.8, 'Gluten'],
      ['Soft Drink', 'Drinks', null, 3.0, null],
    ];
    const mIns = db.prepare('INSERT INTO menu_items (name, category, description, price, allergens) VALUES (?,?,?,?,?)');
    const menuRows = menu.map((m) => ({ id: Number(mIns.run(...m).lastInsertRowid), price: m[3], cat: m[1] }));

    const stock = [
      ['Ribeye (aged)', 'kg', 40, 15], ['Sirloin', 'kg', 35, 12], ['Fillet', 'kg', 20, 8], ['Beef mince', 'kg', 25, 10],
      ['Potatoes', 'kg', 120, 40], ['Brioche buns', 'pcs', 150, 60], ['Cheddar', 'kg', 10, 4], ['Butter', 'kg', 12, 5],
      ['Prawns', 'kg', 8, 3], ['House red wine', 'bottles', 60, 24], ['Lager keg', 'kegs', 6, 2], ['Salad leaves', 'kg', 9, 4],
    ];
    const iIns = db.prepare('INSERT INTO inventory_items (branch_id, name, unit, quantity, reorder_level) VALUES (?,?,?,?,?)');
    branchIds.forEach((b, bi) => stock.forEach(([n, u, q, r], k) => {
      let qty = Math.round(q * (0.6 + rnd() * 0.8));
      if ((k + bi) % 5 === 0) qty = Math.max(1, Math.round(r * 0.7)); // a few low-stock items to show alerts
      iIns.run(b, n, u, qty, r);
    }));

    // Orders: last 45 days, busier at weekends and in London.
    const oIns = db.prepare(`INSERT INTO orders (branch_id, customer_id, created_by, delivery_user_id, type, table_no, delivery_address, status, payment_status, payment_method, total, created_at, updated_at)
                             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const oiIns = db.prepare('INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price) VALUES (?,?,?,?)');
    const weight = [1.4, 1.1, 0.8];
    const now = new Date();
    const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
    for (let day = 44; day >= 0; day--) {
      const date = new Date(now.getTime() - day * 864e5);
      const weekend = [5, 6, 0].includes(date.getUTCDay());
      branchIds.forEach((b, bi) => {
        const count = Math.round((6 + rnd() * 5) * weight[bi] * (weekend ? 1.5 : 1) * (day < 10 ? 1.1 : 1));
        for (let k = 0; k < count; k++) {
          const hour = pick([12, 12, 13, 13, 14, 17, 18, 18, 19, 19, 19, 20, 20, 21, 22]);
          const t = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, Math.floor(rnd() * 60)));
          if (t > now) continue;
          const type = rnd() < 0.6 ? 'dine_in' : rnd() < 0.5 ? 'takeaway' : 'delivery';
          const online = type !== 'dine_in' && rnd() < 0.5;
          const cust = online ? pick(customers) : null;
          const st = staff[b];
          const isToday = day === 0;
          let status = rnd() < 0.04 ? 'cancelled' : 'completed';
          if (isToday && rnd() < 0.5) status = pick(['pending', 'preparing', 'ready']);
          const items = [];
          const nMain = 1 + Math.floor(rnd() * 3);
          for (let x = 0; x < nMain; x++) items.push(pick(menuRows.filter((m) => ['Steaks', 'Burgers'].includes(m.cat))));
          for (let x = 0; x < Math.floor(rnd() * 3); x++) items.push(pick(menuRows.filter((m) => !['Steaks', 'Burgers'].includes(m.cat))));
          const total = Math.round(items.reduce((acc, m) => acc + m.price, 0) * 100) / 100;
          const paid = status === 'completed' || online;
          const r = oIns.run(b, cust, online ? cust : pick([st.cashier, st.cashier2]), type === 'delivery' && status === 'completed' ? st.driver : null,
            type, type === 'dine_in' ? String(1 + Math.floor(rnd() * 30)) : null,
            type === 'delivery' ? `${10 + Math.floor(rnd() * 200)} High Street, ${branches[bi][1]}` : null,
            status, status === 'cancelled' && online ? 'refunded' : paid ? 'paid' : 'unpaid',
            online ? 'online' : paid ? pick(['card', 'card', 'card', 'cash']) : null, total, fmt(t), fmt(t));
          items.forEach((m) => oiIns.run(r.lastInsertRowid, m.id, 1, m.price));
        }
      });
    }

    // A few live tickets from the last hour so the kitchen, till and delivery screens have work on them.
    branchIds.forEach((b, bi) => {
      const st = staff[b];
      [['pending', 'dine_in'], ['pending', 'delivery'], ['preparing', 'dine_in'], ['preparing', 'takeaway'], ['ready', 'dine_in'], ['ready', 'delivery'], ['ready', 'delivery']]
        .forEach(([status, type], k) => {
          const t = fmt(new Date(now.getTime() - (55 - k * 7) * 60000));
          const items = [pick(menuRows.filter((m) => m.cat === 'Steaks')), pick(menuRows.filter((m) => m.cat === 'Sides')), pick(menuRows.filter((m) => m.cat === 'Drinks'))];
          const total = Math.round(items.reduce((acc, m) => acc + m.price, 0) * 100) / 100;
          const r = oIns.run(b, null, st.cashier, null, type, type === 'dine_in' ? String(3 + k * 2) : null,
            type === 'delivery' ? `${20 + k * 11} Market Street, ${branches[bi][1]}` : null, status,
            k === 4 ? 'paid' : 'unpaid', k === 4 ? 'card' : null, total, t, t);
          items.forEach((m) => oiIns.run(r.lastInsertRowid, m.id, 1, m.price));
        });
    });

    // Reservations for the coming week
    const rIns = db.prepare('INSERT INTO reservations (branch_id, customer_id, name, phone, date, time, party_size) VALUES (?,?,?,?,?,?,?)');
    const guests = ['Emily Carter', 'Noah Evans', 'Grace Hall', 'Leo Morris', 'Ava Singh', 'Jack Doyle', 'Mia Green', 'Oscar Price'];
    for (let i = 0; i < 18; i++) {
      const d = new Date(now.getTime() + Math.floor(rnd() * 7) * 864e5).toISOString().slice(0, 10);
      const g = Math.floor(rnd() * guests.length);
      rIns.run(pick(branchIds), g < 4 ? customers[g] : null, guests[g], `07700 9${String(10000 + i * 137).slice(0, 5)}`, d,
        pick(['12:30', '13:00', '18:00', '19:00', '19:30', '20:00']), 2 + Math.floor(rnd() * 5));
    }
  });
  console.log(`Seed complete. All demo accounts use the password: ${PASSWORD}`);
}

if (require.main === module) seed();
module.exports = { seed };
