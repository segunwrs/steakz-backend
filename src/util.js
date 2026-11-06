class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Tiny validator: rules = { field: 'required|string|email|int|number|min:1|max:20|in:a,b' }
function validate(body, rules) {
  const errors = {};
  const out = {};
  for (const [field, ruleStr] of Object.entries(rules)) {
    const rules = ruleStr.split('|');
    let v = body?.[field];
    if (typeof v === 'string') v = v.trim();
    const empty = v === undefined || v === null || v === '';
    if (empty) {
      if (rules.includes('required')) errors[field] = 'is required';
      continue;
    }
    for (const r of rules) {
      const [name, arg] = r.split(':');
      if (name === 'string' && typeof v !== 'string') errors[field] = 'must be text';
      if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[field] = 'must be a valid email';
      if (name === 'int') { if (!Number.isInteger(Number(v))) errors[field] = 'must be a whole number'; else v = Number(v); }
      if (name === 'number') { if (Number.isNaN(Number(v))) errors[field] = 'must be a number'; else v = Number(v); }
      if (name === 'min' && (typeof v === 'number' ? v < Number(arg) : String(v).length < Number(arg))) errors[field] = `must be at least ${arg}${typeof v === 'number' ? '' : ' characters'}`;
      if (name === 'max' && (typeof v === 'number' ? v > Number(arg) : String(v).length > Number(arg))) errors[field] = `must be at most ${arg}${typeof v === 'number' ? '' : ' characters'}`;
      if (name === 'in' && !arg.split(',').includes(String(v))) errors[field] = `must be one of: ${arg.replace(/,/g, ', ')}`;
      if (name === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[field] = 'must be a date (YYYY-MM-DD)';
      if (name === 'time' && !/^\d{2}:\d{2}$/.test(v)) errors[field] = 'must be a time (HH:MM)';
      if (name === 'bool') v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
    }
    out[field] = v;
  }
  if (Object.keys(errors).length) {
    const e = new HttpError(400, 'Validation failed');
    e.fields = errors;
    throw e;
  }
  return out;
}

// Wraps route handlers so thrown errors reach the error middleware.
const h = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r?.catch) r.catch(next); } catch (e) { next(e); } };

module.exports = { HttpError, validate, h };
