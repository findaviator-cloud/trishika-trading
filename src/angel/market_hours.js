// Indian cash-market window (IST). Used to stop Angel One traffic when markets are closed.
// Mon-Fri 09:00-15:45 IST (15 min buffer each side). Override: ANGEL_ALWAYS_ON=true.
// Holidays: INDIA_MARKET_HOLIDAYS="2026-12-25,2027-01-26" (yyyy-mm-dd, IST dates).
const IST_MS = 5.5 * 3_600_000;
const BOOT_MS = Date.now();
const BOOT_GRACE_MS = 4 * 60_000; // after a (re)start: connect briefly so last session can be loaded

export function istParts(nowMs = Date.now()) {
  const d = new Date(nowMs + IST_MS);
  return { day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), date: d.toISOString().slice(0, 10) };
}

export function isIndianMarketWindow(nowMs = Date.now(), env = process.env) {
  if (env.ANGEL_ALWAYS_ON === 'true') return true;
  const { day, minutes, date } = istParts(nowMs);
  if (day === 0 || day === 6) return false;
  const holidays = String(env.INDIA_MARKET_HOLIDAYS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (holidays.includes(date)) return false;
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 45;
}

export function isAngelAllowedNow(nowMs = Date.now(), env = process.env) {
  return isIndianMarketWindow(nowMs, env) || nowMs - BOOT_MS < BOOT_GRACE_MS;
}
