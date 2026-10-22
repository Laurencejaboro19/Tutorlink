/** Time helpers. All storage is UTC; the platform day for challenges is Africa/Lagos (UTC+1, no DST). */

export const PLATFORM_TZ = "Africa/Lagos";

export function formatDateTime(d: Date, tz = PLATFORM_TZ) {
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(d);
}

export function formatDate(d: Date | string, tz = PLATFORM_TZ) {
  const date = typeof d === "string" ? new Date(d + (d.length === 10 ? "T00:00:00+01:00" : "")) : d;
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeZone: tz }).format(date);
}

export function formatTime(d: Date, tz = PLATFORM_TZ) {
  return new Intl.DateTimeFormat("en-NG", { timeStyle: "short", timeZone: tz }).format(d);
}

/** YYYY-MM-DD for the platform day containing `d`. */
export function platformDay(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PLATFORM_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Start of the given platform day (YYYY-MM-DD) as a UTC Date. Lagos is UTC+1 with no DST. */
export function platformDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+01:00`);
}

export function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86_400_000);
}

export function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60_000);
}

/** Minutes from midnight in the platform timezone and weekday (0 = Sunday). */
export function localParts(d: Date, tz = PLATFORM_TZ) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hour = Number(get("hour")) % 24;
  return { minute: hour * 60 + Number(get("minute")), weekday: weekdays.indexOf(get("weekday")) };
}

export function minutesToLabel(m: number) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

export function relativeDays(d: Date) {
  const diff = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}
