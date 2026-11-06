# Steakz MIS – Back end (REST API)

Node.js + Express 5 REST API for the Steakz restaurant Management Information System.
It handles login, roles, branches, users, menu, orders, stock, reservations, reports and the audit log.
The React front end lives in a separate project: **steakz-frontend**.

**Stack:** Node.js 22 · Express 5 · SQLite (Node's built-in `node:sqlite`) · JWT · bcrypt

## 1. Requirements

- **Node.js 22.13 or newer** – check with `node -v`. Download from https://nodejs.org (LTS).
- Nothing else. The database is a single SQLite file created automatically.

## 2. Run it

```bash
cd steakz-backend
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm start
```

You should see:

```
Empty database - seeding demo data...
Seed complete. All demo accounts use the password: Steakz@2026
Steakz MIS API running on http://localhost:4000
```

Check it works: open http://localhost:4000/api/health → `{"status":"ok", ...}`

Leave this terminal open, then start the front end in a second terminal (see the steakz-frontend README).

## 3. Useful commands

| Command | What it does |
|---|---|
| `npm start` | Start the API on port 4000 |
| `npm run dev` | Start with auto-restart when you edit code |
| `npm run seed` | Wipe the database and reload the demo data |
| `npm test` | Run the 30 automated API tests (uses a temporary database) |

## 4. Environment variables (`.env`)

| Variable | Example | Purpose |
|---|---|---|
| PORT | 4000 | Port the API listens on |
| JWT_SECRET | a long random string | Signs login tokens – change it |
| DB_FILE | ./data/steakz.db | SQLite database file |
| SEED_PASSWORD | Steakz@2026 | Password given to every demo account |
| CORS_ORIGIN | http://localhost:5173 | Front-end address(es) allowed to call the API, comma-separated. Leave blank to allow all (fine for local use) |

## 5. Demo accounts (password `Steakz@2026`)

| Role | Email |
|---|---|
| Admin | admin@steakz.co.uk |
| HQ manager | hq@steakz.co.uk |
| Branch manager | manager.london@ · manager.manchester@ · manager.leeds@steakz.co.uk |
| Chef | chef.london@ · chef.manchester@ · chef.leeds@steakz.co.uk |
| Cashier / waiter | cashier.london@ · waiter.london@ (same for manchester, leeds) |
| Delivery driver | driver.london@ · driver.manchester@ · driver.leeds@steakz.co.uk |
| Customer | emily@example.com · noah@example.com · grace@example.com · leo@example.com |

## 6. Test with Postman

1. Start the API (`npm start`).
2. In Postman: **Import** → `docs/Steakz-MIS.postman_collection.json`.
3. Run folder **1. Auth** first – it logs in as every role and saves the tokens.
4. Run the other folders (49 requests, 63 assertions).

Or from the terminal: `npx newman run docs/Steakz-MIS.postman_collection.json`

## 7. API endpoints

All paths start with `/api`.

| Method | Endpoint | Access |
|---|---|---|
| GET | /health | Public |
| GET | /public/branches · /public/menu | Public |
| POST | /public/reservations | Public (guest booking) |
| POST | /auth/register | Public (creates a customer) |
| POST | /auth/login | Public (rate-limited) |
| GET | /auth/me | Logged in |
| PATCH | /auth/me/password | Logged in |
| GET | /branches | Admin, HQ (all); branch staff (own) |
| POST / PUT / DELETE | /branches · /branches/:id | Admin |
| GET | /users | Admin, HQ (all); branch manager (own branch) |
| POST / PUT | /users · /users/:id | Admin (any role); branch manager (own chef/cashier/driver) |
| DELETE | /users/:id | Admin |
| GET | /menu | Logged in |
| POST / PUT / DELETE | /menu · /menu/:id | Admin, HQ manager |
| GET | /orders · /orders/:id | Admin, HQ (all); branch staff (own); driver (assigned); customer (own) |
| POST | /orders | Admin, branch manager, cashier, customer |
| PATCH | /orders/:id/status | Chef, cashier, driver, branch manager, customer (cancel) – follows the order workflow |
| PATCH | /orders/:id/payment · /orders/:id/assign | Admin, branch manager, cashier |
| GET | /inventory | Admin, HQ (all); branch manager, chef (own) |
| POST / DELETE | /inventory · /inventory/:id | Admin, branch manager |
| PATCH | /inventory/:id | Admin, branch manager; chef (quantity only) |
| GET / POST / PATCH | /reservations · /reservations/:id | Admin, HQ (read), branch manager, cashier, customer (own) |
| GET | /reports/summary · /reports/sales.csv | Admin, HQ (all); branch manager (own) |
| GET | /admin/stats · /admin/audit-logs | Admin |

Send the token from `/auth/login` as a header: `Authorization: Bearer <token>`

## 8. Project structure

```
src/
  index.js        starts the server (seeds demo data on first run)
  app.js          Express app: middleware, routes, error handler
  db.js           SQLite connection + table definitions (8 tables)
  auth.js         JWT, roles, access levels, branch scoping
  util.js         input validation helpers
  seed.js         demo data (3 branches, all roles, menu, ~45 days of orders)
  routes/         auth, public, branches, users, menu, orders, inventory, reservations, reports, admin
tests/api.test.js automated tests
docs/             Postman collection, test results, ERD
```

## 9. Deploy (Render, free)

1. Push this folder to its own GitHub repo (e.g. `steakz-backend`).
2. render.com → **New → Blueprint** → choose the repo (uses `render.yaml`).
3. Once the front end is deployed, set `CORS_ORIGIN` to its URL in Render → Environment.
4. Your API URL will look like `https://steakz-backend.onrender.com` – give this to the front end as `VITE_API_URL`.

On the free plan the disk resets on restart, so demo data reloads – fine for a demo.

## Troubleshooting

- **`No such built-in module: node:sqlite`** → your Node is too old. Install Node 22.13+.
- **`EADDRINUSE: port 4000`** → something else is using 4000. Change `PORT` in `.env` (and the front-end proxy).
- **Want fresh data?** → `npm run seed`
