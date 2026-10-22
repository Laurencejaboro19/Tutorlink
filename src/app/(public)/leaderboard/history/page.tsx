import Link from "next/link";
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, Field, PageHeader, Pagination, Select, cn, type Tone } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import { CYCLE_STATUS_LABEL, cycleResults, cycleRewardOutcomes, cycleSubjectScopes, getCycle, listPastCycles, REWARD_STATUS_LABEL, type Scope } from "@/server/leaderboards";
import { StandingsTable } from "../standings-table";

export const metadata = { title: "Past leaderboard cycles" };
export const dynamic = "force-dynamic";

function rewardTone(status: keyof typeof REWARD_STATUS_LABEL): Tone {
  if (status === "credited" || status === "paid") return "success";
  if (status === "rejected" || status === "failed" || status === "reversed") return "danger";
  if (status === "approved" || status === "payout_initiated") return "brand";
  return "warning";
}

export default async function LeaderboardHistoryPage({ searchParams }: PageProps<"/leaderboard/history">) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const rpage = Math.max(1, Number(sp.rpage ?? 1) || 1);
  const user = await getCurrentUser();
  const cycles = await listPastCycles(page);
  const selectedId = typeof sp.cycle === "string" && /^[0-9a-f-]{36}$/.test(sp.cycle) ? sp.cycle : cycles.rows[0]?.id;
  const cycle = selectedId ? await getCycle(selectedId) : null;
  const scope: Scope = sp.scope === "subject" ? "subject" : "nationwide";
  const subjectScopes = cycle ? await cycleSubjectScopes(cycle.id) : [];
  const subjectKey = typeof sp.subject === "string" && /^\d+$/.test(sp.subject) ? sp.subject : subjectScopes[0] ? String(subjectScopes[0].id) : "";
  const scopeKey = scope === "subject" ? subjectKey : "all";
  const results = cycle && cycle.status !== "open" && (scope === "nationwide" || subjectKey) ? await cycleResults({ cycleId: cycle.id, scope, scopeKey, limit: 50, page: rpage }) : null;
  const rewards = cycle && cycle.status === "rewarded" ? await cycleRewardOutcomes(cycle.id) : [];
  const rewardNgn = await getSetting("leaderboard.reward_ngn");
  const hrefFor = (p: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { page: page > 1 ? String(page) : undefined, cycle: cycle?.id, scope: scope === "subject" ? "subject" : undefined, subject: scope === "subject" ? subjectKey : undefined, rpage: rpage > 1 ? String(rpage) : undefined, ...p };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return `/leaderboard/history${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Leaderboard"
        title="Past cycles"
        description="Finalized standings and reward outcomes for every completed cycle. Historical cycles are kept forever."
        action={
          <ButtonLink href="/leaderboard" variant="outline" size="sm">
            Current cycle
          </ButtonLink>
        }
      />

      {cycles.rows.length === 0 ? (
        <EmptyState title="No finished cycles yet" description="The first cycle is still running. Results appear here once it ends." action={<ButtonLink href="/leaderboard" size="sm">See the live leaderboard</ButtonLink>} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <aside>
            <Card>
              <CardHeader title="Cycles" />
              <ul className="divide-y divide-ink-100">
                {cycles.rows.map((c) => (
                  <li key={c.id}>
                    <Link href={hrefFor({ cycle: c.id, scope: undefined, subject: undefined, rpage: undefined })} aria-current={c.id === cycle?.id ? "page" : undefined} className={cn("block px-5 py-3 text-sm hover:bg-ink-50", c.id === cycle?.id && "bg-brand-50")}>
                      <span className="block font-medium text-ink-900">
                        {formatDate(c.startsAt)} – {formatDate(new Date(c.endsAt.getTime() - 1))}
                      </span>
                      <span className="text-xs text-ink-500">{CYCLE_STATUS_LABEL[c.status]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="px-5 pb-4">
                <Pagination page={cycles.page} pageCount={cycles.pageCount} hrefFor={(p) => hrefFor({ page: String(p), cycle: undefined, rpage: undefined })} />
              </div>
            </Card>
          </aside>

          <div className="min-w-0 space-y-6">
            {cycle && (
              <>
                <Card>
                  <CardHeader
                    title={`${formatDate(cycle.startsAt)} – ${formatDate(new Date(cycle.endsAt.getTime() - 1))}`}
                    description={`${CYCLE_STATUS_LABEL[cycle.status]}${cycle.finalizedAt ? ` · finalized ${formatDate(cycle.finalizedAt)}` : ""}`}
                    action={<Badge tone={cycle.status === "rewarded" ? "success" : "brand"}>{CYCLE_STATUS_LABEL[cycle.status]}</Badge>}
                  />
                  <div className="px-5 pb-5">
                    <div className="mb-4 flex flex-wrap items-end gap-2">
                      <nav aria-label="Scope" className="flex gap-1">
                        <Link href={hrefFor({ scope: undefined, subject: undefined, rpage: undefined })} aria-current={scope === "nationwide" ? "page" : undefined} className={cn("rounded-full px-4 py-2 text-sm font-semibold", scope === "nationwide" ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200")}>
                          Nationwide
                        </Link>
                        {subjectScopes.length > 0 && (
                          <Link href={hrefFor({ scope: "subject", subject: subjectKey, rpage: undefined })} aria-current={scope === "subject" ? "page" : undefined} className={cn("rounded-full px-4 py-2 text-sm font-semibold", scope === "subject" ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200")}>
                            By subject
                          </Link>
                        )}
                      </nav>
                      {scope === "subject" && subjectScopes.length > 0 && (
                        <form method="get" action="/leaderboard/history" className="flex items-end gap-2">
                          <input type="hidden" name="cycle" value={cycle.id} />
                          <input type="hidden" name="scope" value="subject" />
                          {page > 1 && <input type="hidden" name="page" value={page} />}
                          <Field label="Subject" name="subject">
                            <Select id="subject" name="subject" defaultValue={subjectKey}>
                              {subjectScopes.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Button type="submit" variant="outline">
                            Show
                          </Button>
                        </form>
                      )}
                    </div>
                    {results && results.rows.length > 0 ? (
                      <>
                        <StandingsTable rows={results.rows} highlightUserId={user?.id} />
                        <Pagination page={results.page} pageCount={results.pageCount} hrefFor={(p) => hrefFor({ rpage: String(p) })} />
                      </>
                    ) : (
                      <p className="text-sm text-ink-500">No counted attempts in this scope for this cycle.</p>
                    )}
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Reward outcomes" description={cycle.status === "rewarded" ? `Top finishers with at least the minimum attempts. Each reward is worth ₦${Number(rewardNgn).toLocaleString()} as cash or platform credit.` : "Rewards are distributed shortly after a cycle is finalized."} />
                  <div className="px-5 pb-5">
                    {rewards.length === 0 ? (
                      <p className="text-sm text-ink-500">{cycle.status === "rewarded" ? "No eligible winners in this cycle." : "Not distributed yet."}</p>
                    ) : (
                      <ul className="divide-y divide-ink-100">
                        {rewards.map((r) => (
                          <li key={r.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-3", r.userId === user?.id && "bg-teal-50 -mx-2 px-2 rounded")}>
                            <span className="text-sm">
                              <span className="font-semibold text-ink-900">#{r.rank}</span> {r.displayName}
                              {r.city && <span className="text-ink-500"> · {r.city}</span>}
                            </span>
                            <span className="flex gap-2">
                              <Badge tone="neutral">{r.kind === "cash" ? "Cash" : "Credit"}</Badge>
                              <Badge tone={rewardTone(r.status)}>{REWARD_STATUS_LABEL[r.status]}</Badge>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
