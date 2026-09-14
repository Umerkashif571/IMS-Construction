// Single currency formatting helper for the whole app: "Rs." prefix + comma grouping.
//
// formatPKR      -> always 2 decimals (Rs. 250.50) so ledger rows, balances and totals
//                   reconcile against bank statements (paisa amounts are never rounded away).
// formatPKRWhole -> whole rupees (Rs. 555,000) for dashboard / stat tiles where paisa is noise.
const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export const formatPKR = (v) => {
  const n = Number(v)
  const safe = Number.isFinite(n) ? n : 0
  const sign = safe < 0 ? '-' : ''
  const [int, dec] = Math.abs(safe).toFixed(2).split('.')
  return `Rs. ${sign}${group(int)}.${dec}`
}

export const formatPKRWhole = (v) => {
  const n = Number(v)
  const safe = Math.round(Number.isFinite(n) ? n : 0)
  const sign = safe < 0 ? '-' : ''
  return `Rs. ${sign}${group(String(Math.abs(safe)))}`
}

// Back-compat alias for callers that prefer the "0 dp" name.
export const formatPKR0 = formatPKRWhole
