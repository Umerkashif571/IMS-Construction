// Single currency formatting helper for the whole app:
// "Rs." prefix + comma-every-3-digits grouping (e.g. Rs. 555,000).
// Replaces the previous mixed "PKR 555,000" / "Rs. 5,55,000" styles.
export const formatPKR = (v) => {
  const n = Math.round(parseFloat(v) || 0)
  const sign = n < 0 ? '-' : ''
  return `Rs. ${sign}${String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}