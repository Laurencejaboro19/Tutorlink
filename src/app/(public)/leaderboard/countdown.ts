export function countdownLabel(ms: number) {
  if (ms <= 0) return "Cycle ended — results are being finalized";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} day${d === 1 ? "" : "s"} ${h} h left`;
  if (h > 0) return `${h} h ${m} min left`;
  return `${m} min ${s % 60} s left`;
}
