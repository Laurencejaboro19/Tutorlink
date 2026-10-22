/**
 * Money helpers. NGN amounts travel through the app as decimal strings
 * (what Postgres numeric returns) or as integer kobo for arithmetic.
 * Never use JS floats for money.
 */

export type Ngn = string; // "12345.67"

export function toKobo(amount: Ngn | number): bigint {
  const s = typeof amount === "number" ? amount.toFixed(2) : String(amount).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid money amount: ${amount}`);
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const kobo = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return neg ? -kobo : kobo;
}

export function fromKobo(kobo: bigint): Ngn {
  const neg = kobo < 0n;
  const abs = neg ? -kobo : kobo;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export function addNgn(...amounts: Ngn[]): Ngn {
  return fromKobo(amounts.reduce((acc, a) => acc + toKobo(a), 0n));
}

export function subNgn(a: Ngn, b: Ngn): Ngn {
  return fromKobo(toKobo(a) - toKobo(b));
}

export function compareNgn(a: Ngn, b: Ngn): -1 | 0 | 1 {
  const x = toKobo(a);
  const y = toKobo(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function minNgn(a: Ngn, b: Ngn): Ngn {
  return compareNgn(a, b) <= 0 ? a : b;
}

export function isPositive(a: Ngn) {
  return toKobo(a) > 0n;
}

/** percentage of an amount, rounded half-up to the kobo. pct is e.g. "30.00". */
export function percentOf(amount: Ngn, pct: Ngn | number): Ngn {
  const kobo = toKobo(amount);
  const pctHundredths = toKobo(pct); // "30.00" -> 3000
  // kobo * pct / 100 => kobo * pctHundredths / 10000, round half up
  const num = kobo * pctHundredths;
  const q = num / 10000n;
  const r = num % 10000n;
  return fromKobo(r * 2n >= 10000n ? q + 1n : q);
}

export function formatNgn(amount: Ngn | number, opts: { compact?: boolean } = {}): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (opts.compact && Math.abs(n) >= 1000) {
    return "₦" + new Intl.NumberFormat("en-NG", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  }
  return "₦" + new Intl.NumberFormat("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}

export function ngn(amount: number | string): Ngn {
  return fromKobo(toKobo(amount));
}
