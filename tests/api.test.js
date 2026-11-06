// End-to-end API tests: run with `npm test`. Uses a throwaway in-memory database.
process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seed } = require('../src/seed');
const app = require('../src/app');

let server, base;
const PW = 'Steakz@2026';
const tokens = {};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const login = async (email) => (await call('POST', '/api/auth/login', { body: { email, password: PW } })).data.token;

before(async () => {
  seed();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, e] of Object.entries({
    admin: 'admin@steakz.co.uk', hq: 'hq@steakz.co.uk', mgrMan: 'manager.manchester@steakz.co.uk', mgrLeeds: 'manager.leeds@steakz.co.uk',
    chefMan: 'chef.manchester@steakz.co.uk', cashMan: 'cashier.manchester@steakz.co.uk', drvMan: 'driver.manchester@steakz.co.uk',
    chefLeeds: 'chef.leeds@steakz.co.uk', cust: 'emily@example.com',
  })) tokens[k] = await login(e);
});
after(() => server.close());

// ---------- Authentication ----------
test('T01 health check is public', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200); assert.equal(r.data.status, 'ok');
});
test('T02 wrong password is rejected with a generic message', async () => {
  const r = await call('POST', '/api/auth/login', { body: { email: 'admin@steakz.co.uk', password: 'nope1234' } });
  assert.equal(r.status, 401); assert.match(r.data.error, /Incorrect email or password/);
});
test('T03 every role can log in and gets the right access level', async () => {
  const me = async (t) => (await call('GET', '/api/auth/me', { token: t })).data.user;
  assert.equal((await me(tokens.admin)).access_level, 1);
  assert.equal((await me(tokens.hq)).access_level, 2);
  assert.equal((await me(tokens.mgrMan)).access_level, 2);
  assert.equal((await me(tokens.chefMan)).access_level, 3);
  assert.equal((await me(tokens.cust)).access_level, 3);
});
test('T04 protected endpoints need a token', async () => {
  assert.equal((await call('GET', '/api/orders')).status, 401);
  assert.equal((await call('GET', '/api/orders', { token: 'garbage' })).status, 401);
});
test('T05 password hashes are never returned', async () => {
  const r = await call('GET', '/api/users', { token: tokens.admin });
  assert.equal(r.status, 200); assert.ok(r.data.every((u) => !('password_hash' in u)));
});

// ---------- Role-based access ----------
test('T06 customer cannot list users (403)', async () => {
  assert.equal((await call('GET', '/api/users', { token: tokens.cust })).status, 403);
});
test('T07 chef cannot take payments (403)', async () => {
  assert.equal((await call('PATCH', '/api/orders/1/payment', { token: tokens.chefMan, body: { payment_method: 'cash' } })).status, 403);
});
test('T08 HQ manager cannot delete users (403)', async () => {
  assert.equal((await call('DELETE', '/api/users/5', { token: tokens.hq })).status, 403);
});
test('T09 branch manager cannot create an admin account (403)', async () => {
  const r = await call('POST', '/api/users', { token: tokens.mgrMan, body: { name: 'Sneaky', email: 'sneaky@steakz.co.uk', password: 'Password1!', role: 'admin' } });
  assert.equal(r.status, 403);
});
test('T10 audit log is admin-only', async () => {
  assert.equal((await call('GET', '/api/admin/audit-logs', { token: tokens.hq })).status, 403);
  assert.equal((await call('GET', '/api/admin/audit-logs', { token: tokens.admin })).status, 200);
});

// ---------- Branch isolation ----------
test('T11 Manchester manager only sees Manchester orders', async () => {
  const r = await call('GET', '/api/orders?limit=500', { token: tokens.mgrMan });
  assert.ok(r.data.length > 0); assert.ok(r.data.every((o) => o.branch_id === 2));
});
test('T12 Manchester manager cannot widen scope with ?branch_id=3', async () => {
  const r = await call('GET', '/api/orders?branch_id=3&limit=500', { token: tokens.mgrMan });
  assert.ok(r.data.every((o) => o.branch_id === 2));
});
test('T13 Leeds chef cannot open or move a Manchester order', async () => {
  const mine = (await call('GET', '/api/orders?limit=1', { token: tokens.mgrMan })).data[0];
  assert.equal((await call('GET', `/api/orders/${mine.id}`, { token: tokens.chefLeeds })).status, 404);
  assert.equal((await call('PATCH', `/api/orders/${mine.id}/status`, { token: tokens.chefLeeds, body: { status: 'preparing' } })).status, 404);
});
test('T14 branch reports are scoped; HQ gets branch comparison', async () => {
  const b = (await call('GET', '/api/reports/summary', { token: tokens.mgrMan })).data;
  assert.equal(b.branch_id, 2); assert.equal(b.byBranch.length, 0);
  const hq = (await call('GET', '/api/reports/summary', { token: tokens.hq })).data;
  assert.equal(hq.byBranch.length, 3);
});
test('T15 Manchester manager only sees Manchester staff', async () => {
  const r = await call('GET', '/api/users', { token: tokens.mgrMan });
  assert.ok(r.data.every((u) => u.branch_id === 2));
});

// ---------- Business workflow ----------
let orderId;
test('T16 cashier order total is calculated on the server (price tampering ignored)', async () => {
  const r = await call('POST', '/api/orders', { token: tokens.cashMan, body: { type: 'dine_in', table_no: '7', items: [{ menu_item_id: 1, quantity: 2, unit_price: 0.01 }] } });
  assert.equal(r.status, 201); assert.equal(r.data.total, 59); assert.equal(r.data.branch_id, 2);
  orderId = r.data.id;
});
test('T17 invalid status jump pending→completed is blocked', async () => {
  const r = await call('PATCH', `/api/orders/${orderId}/status`, { token: tokens.mgrMan, body: { status: 'completed' } });
  assert.equal(r.status, 400);
});
test('T18 cashier cannot do the chef\'s job (pending→preparing)', async () => {
  assert.equal((await call('PATCH', `/api/orders/${orderId}/status`, { token: tokens.cashMan, body: { status: 'preparing' } })).status, 403);
});
test('T19 full dine-in flow: chef cooks, cashier takes payment and serves', async () => {
  assert.equal((await call('PATCH', `/api/orders/${orderId}/status`, { token: tokens.chefMan, body: { status: 'preparing' } })).status, 200);
  assert.equal((await call('PATCH', `/api/orders/${orderId}/status`, { token: tokens.chefMan, body: { status: 'ready' } })).status, 200);
  assert.equal((await call('PATCH', `/api/orders/${orderId}/status`, { token: tokens.cashMan, body: { status: 'completed' } })).status, 400, 'must pay first');
  assert.equal((await call('PATCH', `/api/orders/${orderId}/payment`, { token: tokens.cashMan, body: { payment_method: 'card' } })).status, 200);
  const done = await call('PATCH', `/api/orders/${orderId}/status`, { token: tokens.cashMan, body: { status: 'completed' } });
  assert.equal(done.data.status, 'completed'); assert.equal(done.data.payment_status, 'paid');
});
test('T20 delivery flow: driver picks up and delivers, cash marked paid', async () => {
  const o = (await call('POST', '/api/orders', { token: tokens.cashMan, body: { type: 'delivery', delivery_address: '1 Test Rd, Manchester', items: [{ menu_item_id: 5, quantity: 1 }] } })).data;
  await call('PATCH', `/api/orders/${o.id}/status`, { token: tokens.chefMan, body: { status: 'preparing' } });
  await call('PATCH', `/api/orders/${o.id}/status`, { token: tokens.chefMan, body: { status: 'ready' } });
  const list = (await call('GET', '/api/orders', { token: tokens.drvMan })).data;
  assert.ok(list.some((x) => x.id === o.id), 'driver sees ready delivery');
  const out = (await call('PATCH', `/api/orders/${o.id}/status`, { token: tokens.drvMan, body: { status: 'out_for_delivery' } })).data;
  assert.equal(out.driver_name, 'Zoe Clarke');
  const done = (await call('PATCH', `/api/orders/${o.id}/status`, { token: tokens.drvMan, body: { status: 'completed' } })).data;
  assert.equal(done.payment_status, 'paid');
});
test('T21 customer online order and can only see own orders', async () => {
  const r = await call('POST', '/api/orders', { token: tokens.cust, body: { branch_id: 1, type: 'takeaway', items: [{ menu_item_id: 2, quantity: 1 }] } });
  assert.equal(r.status, 201); assert.equal(r.data.payment_status, 'paid');
  const mine = (await call('GET', '/api/orders?limit=500', { token: tokens.cust })).data;
  assert.ok(mine.every((o) => o.customer_id === r.data.customer_id));
  assert.equal((await call('POST', '/api/orders', { token: tokens.cust, body: { branch_id: 1, type: 'dine_in', table_no: '1', items: [{ menu_item_id: 2, quantity: 1 }] } })).status, 400);
});

// ---------- Admin powers ----------
test('T22 admin can add a branch, create another admin, and delete a user', async () => {
  const b = await call('POST', '/api/branches', { token: tokens.admin, body: { name: 'Steakz Birmingham', city: 'Birmingham', address: '1 New St, B2 4QA' } });
  assert.equal(b.status, 201);
  const a = await call('POST', '/api/users', { token: tokens.admin, body: { name: 'Second Admin', email: 'admin2@steakz.co.uk', password: 'Password1!', role: 'admin' } });
  assert.equal(a.status, 201);
  const s = await call('POST', '/api/users', { token: tokens.admin, body: { name: 'Temp Chef', email: 'temp@steakz.co.uk', password: 'Password1!', role: 'chef', branch_id: b.data.id } });
  assert.equal((await call('DELETE', `/api/users/${s.data.id}`, { token: tokens.admin })).status, 200);
});
test('T23 admin can change a role; disabled accounts lose access immediately', async () => {
  const u = (await call('POST', '/api/users', { token: tokens.admin, body: { name: 'Pat Moss', email: 'pat@steakz.co.uk', password: 'Password1!', role: 'cashier', branch_id: 1 } })).data;
  const t = (await call('POST', '/api/auth/login', { body: { email: 'pat@steakz.co.uk', password: 'Password1!' } })).data.token;
  const upd = await call('PUT', `/api/users/${u.id}`, { token: tokens.admin, body: { role: 'chef' } });
  assert.equal(upd.data.role, 'chef');
  await call('PUT', `/api/users/${u.id}`, { token: tokens.admin, body: { active: false } });
  assert.equal((await call('GET', '/api/orders', { token: t })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'pat@steakz.co.uk', password: 'Password1!' } })).status, 403);
});
test('T24 branch-bound roles must have a branch', async () => {
  const r = await call('POST', '/api/users', { token: tokens.admin, body: { name: 'No Branch', email: 'nb@steakz.co.uk', password: 'Password1!', role: 'chef' } });
  assert.equal(r.status, 400);
});

// ---------- Validation & robustness ----------
test('T25 validation errors return 400 with field messages', async () => {
  const r = await call('POST', '/api/auth/register', { body: { name: 'A', email: 'not-an-email', password: '123' } });
  assert.equal(r.status, 400); assert.ok(r.data.fields.email && r.data.fields.password && r.data.fields.name);
});
test('T26 SQL injection in search is treated as text', async () => {
  const r = await call('GET', `/api/users?q=${encodeURIComponent("' OR 1=1 --")}`, { token: tokens.admin });
  assert.equal(r.status, 200); assert.equal(r.data.length, 0);
});
test('T27 public booking in the past is rejected', async () => {
  const r = await call('POST', '/api/public/reservations', { body: { branch_id: 1, name: 'Old', phone: '0770000000', date: '2020-01-01', time: '19:00', party_size: 2 } });
  assert.equal(r.status, 400);
});
test('T28 chef stock count updates quantity only', async () => {
  const items = (await call('GET', '/api/inventory', { token: tokens.chefMan })).data;
  assert.ok(items.every((i) => i.branch_id === 2));
  const r = await call('PATCH', `/api/inventory/${items[0].id}`, { token: tokens.chefMan, body: { quantity: 99, reorder_level: 0 } });
  assert.equal(r.data.quantity, 99); assert.equal(r.data.reorder_level, items[0].reorder_level);
});
test('T29 malformed JSON returns 400 not 500', async () => {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
});
test('T30 CSV export works for managers', async () => {
  const res = await fetch(base + '/api/reports/sales.csv', { headers: { Authorization: `Bearer ${tokens.mgrMan}` } });
  assert.equal(res.status, 200); assert.match(await res.text(), /^order_id,branch/);
});
