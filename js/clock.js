/**
 * Clock-hour scheduling utilities for top-of-the-hour (:00) artwork rotation.
 */

/**
 * Returns a stable local clock-hour identifier such as "2026-11-20T15".
 * Ticks cleanly on every local :00 boundary (including half-hour time zones).
 */
export function getCurrentHourKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}`;
}

/**
 * Returns a Date pointing to the upcoming top of the hour (:00:00.000).
 */
export function getNextHourDate(date = new Date()) {
  const next = new Date(date.getTime());
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return next;
}

/**
 * Milliseconds remaining until the next :00 clock hour (with a tiny 150ms buffer
 * so timers never fire 1ms early inside the previous hour).
 */
export function getMsUntilNextHour(date = new Date()) {
  const next = getNextHourDate(date);
  return Math.max(250, next.getTime() - date.getTime() + 150);
}

/**
 * Formats an hour timestamp for calm display (e.g. "4:00 PM" or "16:00" per locale).
 */
export function formatHourLabel(date = new Date()) {
  const top = new Date(date.getTime());
  top.setMinutes(0, 0, 0);
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(top);
  } catch {
    const h = top.getHours();
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:00 ${period}`;
  }
}

/**
 * Formats milliseconds remaining until the next hour as a concise countdown.
 */
export function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const mins = Math.ceil(totalSec / 60);
  if (mins >= 60) {
    return '60m';
  }
  return `${mins}m`;
}
