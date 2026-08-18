const Decimal = require('decimal.js');

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function d(v) {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  try {
    return new Decimal(v);
  } catch (e) {
    return new Decimal(NaN);
  }
}

function add(a, b) { return d(a).plus(d(b)); }
function sub(a, b) { return d(a).minus(d(b)); }
function mul(a, b) { return d(a).times(d(b)); }
function div(a, b) { return d(a).div(d(b)); }
function round2(v) { return d(v).toDecimalPlaces(2); }
function toNumber(v) { return round2(v).toNumber(); }
function toFixed(v, dp = 2) { return round2(v).toFixed(dp); }
function eq(a, b) { return d(a).equals(d(b)); }
function gt(a, b) { return d(a).gt(d(b)); }
function gte(a, b) { return d(a).gte(d(b)); }
function lt(a, b) { return d(a).lt(d(b)); }
function lte(a, b) { return d(a).lte(d(b)); }

module.exports = { Decimal, d, add, sub, mul, div, round2, toNumber, toFixed, eq, gt, gte, lt, lte };