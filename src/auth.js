const jwt = require('jsonwebtoken');
const { db } = require('./db');

const SECRET = () => process.env.JWT_SECRET || 'dev-only-secret-change-me';

// Three access levels used across the portal:
//   1 = Admin (system owner)
//   2 = Management (HQ manager = all branches, branch manager = own branch)
//   3 = Operational staff (chef, cashier/waiter, delivery) and customers
const ROLES = ['admin', 'hq_manager', 'branch_manager', 'chef', 'cashier', 'delivery', 'customer'];
const ACCESS_LEVEL = { admin: 1, hq_manager: 2, branch_manager: 2, chef: 3, cashier: 3, delivery: 3, customer: 3 };
const BRANCH_BOUND = ['branch_manager', 'chef', 'cashier', 'delivery'];
const GLOBAL_ROLES = ['admin', 'hq_manager'];

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role, branch_id: user.branch_id }, SECRET(), { expiresIn: '8h' });
}

function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return { ...rest, active: !!rest.active, access_level: ACCESS_LEVEL[u.role] };
}

// Verifies the token and reloads the user, so a deactivated or deleted account loses access immediately.
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, SECRET());
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Account not found or disabled' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission for this action' });
  next();
};

const isGlobal = (user) => GLOBAL_ROLES.includes(user.role);

// Returns the branch a request may operate on. Branch staff are always pinned to their own branch;
// global roles may pass ?branch_id= to narrow down, or get null (= all branches).
function scopeBranch(req, requested) {
  if (isGlobal(req.user)) return requested ? Number(requested) : null;
  return req.user.branch_id;
}

function canTouchBranch(user, branchId) {
  return isGlobal(user) || Number(user.branch_id) === Number(branchId);
}

module.exports = { ROLES, ACCESS_LEVEL, BRANCH_BOUND, GLOBAL_ROLES, sign, publicUser, authenticate, authorize, isGlobal, scopeBranch, canTouchBranch };
