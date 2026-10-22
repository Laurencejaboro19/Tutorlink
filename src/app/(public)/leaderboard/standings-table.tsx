import { Avatar, cn } from "@/components/ui";
import { durationLabel } from "@/app/(public)/challenges/format";
import type { StandingRow } from "@/server/leaderboards";

/** Shared standings table: display names + city only, never emails. */
export function StandingsTable({ rows, highlightUserId, extra }: { rows: StandingRow[]; highlightUserId?: string | null; extra?: StandingRow | null }) {
  const all = extra && !rows.some((r) => r.userId === extra.userId) ? [...rows, extra] : rows;
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="tl-table min-w-[560px]">
        <thead>
          <tr>
            <th className="w-12">#</th>
            <th>Student</th>
            <th>Points</th>
            <th>Correct</th>
            <th>Attempts</th>
            <th>Total time</th>
          </tr>
        </thead>
        <tbody>
          {all.map((r, i) => {
            const me = r.userId === highlightUserId;
            const gap = extra && i === rows.length && all.length > rows.length;
            return (
              <tr key={r.userId} className={cn(me && "bg-teal-50", gap && "border-t-4 border-ink-100")} aria-current={me ? "true" : undefined}>
                <td className="font-semibold text-ink-900">
                  {r.rank}
                  {r.rank <= 3 && <span className="sr-only"> (top {r.rank})</span>}
                </td>
                <td>
                  <span className="flex items-center gap-2">
                    <Avatar name={r.displayName} size={28} />
                    <span>
                      <span className="block font-medium text-ink-900">
                        {r.displayName}
                        {me && <span className="ml-1 rounded-full bg-teal-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white">You</span>}
                      </span>
                      {(r.city || r.state) && <span className="block text-xs text-ink-500">{[r.city, r.state].filter(Boolean).join(", ")}</span>}
                    </span>
                  </span>
                </td>
                <td className="font-semibold text-ink-900">{r.points}</td>
                <td className="text-ink-700">{r.correctCount}</td>
                <td className="text-ink-700">{r.attemptsCount}</td>
                <td className="text-ink-700">{durationLabel(r.totalDurationSeconds)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
