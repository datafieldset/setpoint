// lib/marketHours.js
//
// "Is this the first two hours of the US stock market day?" (v19.43, Na, Oct 22)
//
// Trend Rider on the 30 and 15 minute charts only fires from 9:30am to 11:30am US Eastern, Monday to Friday,
// skipping days the New York Stock Exchange is closed. Eastern time shifts with daylight saving, so this
// asks the clock for New York time instead of using a fixed Hawaii or UTC hour.
//
// Holidays follow the NYSE rules (fixed dates move to the nearest weekday when they land on a weekend,
// Good Friday is worked out from Easter), so no yearly list needs updating. Half-days (day after
// Thanksgiving, Christmas Eve) are normal for this purpose: the market still opens at 9:30.

export const OPEN_FROM_MIN = 9 * 60 + 30;  // 9:30am Eastern
export const OPEN_TO_MIN = 11 * 60 + 30;   // 11:30am Eastern (exclusive)

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", hour12: false });
export function easternParts(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, wd: p.weekday, min: (+p.hour % 24) * 60 + +p.minute };
}

const pad = (n) => String(n).padStart(2, "0");
const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
// nth weekday (0=Sun) of a month; n = -1 for the last one
function nthWeekday(y, m, wd, n) {
  if (n > 0) { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return 1 + ((wd - first + 7) % 7) + (n - 1) * 7; }
  const last = new Date(Date.UTC(y, m, 0)); return last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7);
}
// a fixed-date holiday: Saturday -> the Friday before, Sunday -> the Monday after (NYSE rule)
function observed(y, m, d) {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const t = new Date(Date.UTC(y, m - 1, d + (wd === 6 ? -1 : wd === 0 ? 1 : 0)));
  return key(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function easter(y) { // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mm + 114) / 31), day = ((h + l - 7 * mm + 114) % 31) + 1;
  return { month, day };
}
const cache = new Map();
export function holidaysFor(y) {
  if (cache.has(y)) return cache.get(y);
  const s = new Set();
  s.add(observed(y, 1, 1));                                   // New Year's Day
  s.add(key(y, 1, nthWeekday(y, 1, 1, 3)));                   // Martin Luther King Jr. Day
  s.add(key(y, 2, nthWeekday(y, 2, 1, 3)));                   // Presidents Day
  const e = easter(y), gf = new Date(Date.UTC(y, e.month - 1, e.day - 2)); s.add(key(y, gf.getUTCMonth() + 1, gf.getUTCDate())); // Good Friday
  s.add(key(y, 5, nthWeekday(y, 5, 1, -1)));                  // Memorial Day
  if (y >= 2022) s.add(observed(y, 6, 19));                   // Juneteenth
  s.add(observed(y, 7, 4));                                   // Independence Day
  s.add(key(y, 9, nthWeekday(y, 9, 1, 1)));                   // Labor Day
  s.add(key(y, 11, nthWeekday(y, 11, 4, 4)));                 // Thanksgiving
  s.add(observed(y, 12, 25));                                 // Christmas
  cache.set(y, s); return s;
}
// New Year's Day on a Saturday is not observed on the Friday before (it would fall in the prior year): NYSE stays open.
export function isMarketDay(ms) {
  const { y, m, d, wd } = easternParts(ms);
  if (wd === "Sat" || wd === "Sun") return false;
  if (m === 12 && d === 31 && observed(y + 1, 1, 1) === key(y, 12, 31)) return true;
  return !holidaysFor(y).has(key(y, m, d));
}
// true when `ms` falls inside the first two hours of a US market day
export function inMarketOpenWindow(ms) {
  if (!Number.isFinite(ms)) return false;
  const { min } = easternParts(ms);
  return min >= OPEN_FROM_MIN && min < OPEN_TO_MIN && isMarketDay(ms);
}
