// Date utilities. Calendar dates are stored as plain "YYYY-MM-DD" strings (no time zone),
// so UTC/local differences and Egypt DST can never shift a due date.
export const TZ = 'Africa/Cairo';
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const pad = n => String(n).padStart(2, '0');
const parts = s => s.split('-').map(Number);
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const todayISO = override => override || dayFmt.format(new Date());
export const nowHHMM = () => timeFmt.format(new Date());
export const toUTC = s => { const [y, m, d] = parts(s); return Date.UTC(y, m - 1, d); };
export const fromUTC = t => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export const addDays = (s, n) => fromUTC(toUTC(s) + n * 864e5);
export function addMonths(s, n) { // real calendar months; clamps to month end (31 Jan + 1 month = 28/29 Feb)
  const [y, m, d] = parts(s); const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = t % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`;
}
export const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / 864e5);
export function isValid(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  return fromUTC(toUTC(s)) === s;
}
export const dow = s => new Date(toUTC(s)).getUTCDay();
export const weekStart = s => addDays(s, -((dow(s) + 1) % 7)); // weeks start on Saturday (Egypt)
export const monthStart = s => s.slice(0, 8) + '01';
export const monthEnd = s => { const [y, m] = parts(s); return fromUTC(Date.UTC(y, m, 0)); };
export const fmtShort = s => { const [, m, d] = parts(s); return `${d} ${MONTHS[m - 1].slice(0, 3)}`; };
export const fmtLong = s => { const [y, m, d] = parts(s); return `${d} ${MONTHS[m - 1]} ${y}`; };
export const fmtDay = s => `${DOW[dow(s)]}, ${fmtShort(s)}`;
