/**
 * The true raid date for an AxiBridge run.
 *
 * AxiBridge builds report IDs as `YYYYMMDD-HHMMSS-xxxx` from the recorder's
 * LOCAL time (getFullYear/getMonth/getDate), so the prefix is the actual day
 * the raid happened. The published `dateStart` is a UTC/ISO timestamp, which
 * for a late-evening raid is already past midnight UTC and reads a day ahead
 * (e.g. a Jun 11 20:08 raid shows dateStart 2026-06-12). Prefer the ID prefix;
 * fall back to the ISO date only when the ID isn't in the expected shape.
 *
 * Returns `YYYY-MM-DD`, or null when neither source yields a date.
 */
export function localRunDate(id?: string, isoFallback?: string | null): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})-/.exec(id ?? '')
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return isoFallback ? isoFallback.slice(0, 10) : null
}
