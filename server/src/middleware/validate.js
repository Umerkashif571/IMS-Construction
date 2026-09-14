// Shared request-validation helpers used by every router.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// router.param handler: 400 instead of a Postgres 22P02 → 500 for a malformed id.
function requireUuid(req, res, next, value) {
  if (!isUuid(value)) return res.status(400).json({ error: 'Invalid id format' });
  next();
}

// Forms send '' for untouched optional fields; Postgres rejects '' for DATE/INT/NUMERIC/UUID
// columns with a 500. Convert empty strings to null recursively (objects and arrays) so every
// route can bind req.body values directly. Strings are otherwise left untouched (no trimming).
function normalizeEmpty(value) {
  if (value === '') return null;
  if (Array.isArray(value)) return value.map(normalizeEmpty);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeEmpty(v);
    return out;
  }
  return value;
}
function normalizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') req.body = normalizeEmpty(req.body);
  next();
}

// Map Postgres error codes to client errors so user-typed input never produces a bare 500.
// Usage in a route catch:  catch (err) { return dbError(res, err); }
const PG_ERRORS = {
  '22P02': [400, 'Invalid value format'],            // invalid_text_representation (bad uuid / number)
  '22003': [400, 'Number out of range'],             // numeric_value_out_of_range
  '22001': [400, 'Value too long'],                  // string_data_right_truncation
  '22007': [400, 'Invalid date'],                    // invalid_datetime_format
  '22008': [400, 'Invalid date'],                    // datetime_field_overflow
  '23502': [400, 'A required field is missing'],     // not_null_violation
  '23503': [400, 'Referenced record does not exist'],// foreign_key_violation
  '23505': [409, 'A record with this value already exists'], // unique_violation
  '23514': [400, 'Value not allowed'],               // check_violation
};
function dbError(res, err, fallback = 'Server error') {
  const mapped = err && PG_ERRORS[err.code];
  if (mapped) {
    const [status, message] = mapped;
    // include the column/constraint hint when Postgres provides one — helps the user fix the form
    const detail = err.column ? ` (${err.column})` : err.constraint ? ` (${err.constraint})` : '';
    return res.status(status).json({ error: message + detail });
  }
  console.error(err);
  if (res.headersSent) return;
  return res.status(500).json({ error: fallback });
}

// Small value validators for route bodies
const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' && typeof v !== 'string') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const isPositive = (v) => { const n = toNumber(v); return n !== null && !Number.isNaN(n) && n > 0; };
const isNonNegative = (v) => { const n = toNumber(v); return n !== null && !Number.isNaN(n) && n >= 0; };
const isDate = (v) => v === null || v === undefined || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));
const maxLen = (v, n) => v === null || v === undefined || (typeof v === 'string' && v.length <= n);

module.exports = { isUuid, requireUuid, normalizeBody, normalizeEmpty, dbError, toNumber, isPositive, isNonNegative, isDate, maxLen };
