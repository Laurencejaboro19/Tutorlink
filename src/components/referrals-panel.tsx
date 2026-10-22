import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, Stat, type Tone } from "@/components/ui";
import { addNgn, formatNgn } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import { referralSummary } from "@/server/referrals";
import { CopyButton } from "./copy-button";

const MILESTONE_LABEL = {
  student_verified: "Signed up & verified",
  student_first_session: "First paid session",
  tutor_paid_upgrade: "Paid plan upgrade",
  tutor_five_sessions: "Five paid sessions",
} as const;

type Milestone = keyof typeof MILESTONE_LABEL;

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Shared by /dashboard/referrals (students) and /tutor/referrals (tutor-only accounts). */
export async function ReferralsPanel({ userId, isTutor }: { userId: string; isTutor: boolean }) {
  const [summary, s] = await Promise.all([referralSummary(userId), getSettings(["referral.student_verified_ngn", "referral.student_first_session_ngn", "referral.tutor_paid_upgrade_ngn", "referral.tutor_five_sessions_ngn", "referral.min_qualifying_session_ngn", "referral.credit_expiry_days"])]);
  const link = `${appUrl()}/register?ref=${summary.code}`;
  const message = `Join me on TutorLink — verified tutors near you and online, plus daily challenges with rewards. Sign up with my link: ${link}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(message)}`;
  const eventsByReferral = new Map<string, typeof summary.events>();
  for (const e of summary.events) eventsByReferral.set(e.referralId, [...(eventsByReferral.get(e.referralId) ?? []), e]);
  const earned = summary.events.filter((e) => e.creditEntryId).reduce((acc, e) => addNgn(acc, e.amountNgn), "0.00");
  const milestonesFor = (kind: "student" | "tutor"): { m: Milestone; amount: number }[] =>
    kind === "student"
      ? [
          { m: "student_verified", amount: s["referral.student_verified_ngn"] },
          { m: "student_first_session", amount: s["referral.student_first_session_ngn"] },
        ]
      : [
          { m: "tutor_paid_upgrade", amount: s["referral.tutor_paid_upgrade_ngn"] },
          { m: "tutor_five_sessions", amount: s["referral.tutor_five_sessions_ngn"] },
        ];

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Your code" value={<span className="font-mono tracking-wider">{summary.code}</span>} tone="brand" />
        <Stat label="Friends referred" value={summary.referrals.length} hint={`${summary.referrals.filter((r) => r.onboardingStep === "complete").length} completed setup`} />
        <Stat label="Credit earned" value={formatNgn(earned)} hint="From referral milestones" tone="teal" />
      </div>

      <Card className="mb-6">
        <CardHeader title="Share your link" description="Friends who sign up with your link are tracked automatically." />
        <div className="space-y-3 px-5 pb-5">
          <label className="tl-label" htmlFor="referral-link">
            Referral link
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="referral-link" className="tl-input font-mono text-sm" value={link} readOnly />
            <CopyButton text={link} label="Copy link" />
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[#25D366] px-4 text-[15px] font-semibold text-white hover:brightness-95">
              Share on WhatsApp
            </a>
            <CopyButton text={message} label="Copy message" variant="ghost" />
          </div>
        </div>
      </Card>

      <Card className="mb-6">
        <CardHeader title="How it works" />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Refer a student</h3>
            <ul className="mt-1 space-y-1 text-sm text-ink-700">
              <li>• {formatNgn(s["referral.student_verified_ngn"])} when they verify their email and complete setup</li>
              <li>
                • {formatNgn(s["referral.student_first_session_ngn"])} more after their first paid session of {formatNgn(s["referral.min_qualifying_session_ngn"])} or more
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Refer a tutor</h3>
            <ul className="mt-1 space-y-1 text-sm text-ink-700">
              <li>• {formatNgn(s["referral.tutor_paid_upgrade_ngn"])} when they pay for Premium or Premium+</li>
              <li>• {formatNgn(s["referral.tutor_five_sessions_ngn"])} more after five qualifying paid sessions</li>
            </ul>
          </div>
        </div>
        <p className="px-5 pb-5 text-xs text-ink-500">
          Credits expire after {s["referral.credit_expiry_days"]} days and are applied to bookings, not paid out. Self-referrals, duplicate accounts and sessions created to game referrals are rejected and may lead to suspension.{" "}
          <Link href="/how-rewards-work" className="font-semibold text-brand-600 hover:underline">
            Full rules
          </Link>
        </p>
      </Card>

      <Card>
        <CardHeader title="Your referrals" description={`${summary.referrals.length} so far`} />
        <div className="px-5 pb-5">
          {summary.referrals.length === 0 ? (
            <EmptyState title="Nobody yet" description={isTutor ? "Share your link with students and fellow tutors." : "Share your link with classmates and friends."} />
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="tl-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>Friend</th>
                    <th>Joined</th>
                    <th>Milestones</th>
                    <th>Earned</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.referrals.map((r) => {
                    const evs = eventsByReferral.get(r.id) ?? [];
                    const total = evs.filter((e) => e.creditEntryId).reduce((acc, e) => addNgn(acc, e.amountNgn), "0.00");
                    return (
                      <tr key={r.id}>
                        <td>
                          <p className="font-medium text-ink-900">{r.name.split(" ")[0]}</p>
                          <p className="text-xs text-ink-500">{r.kind === "tutor" ? "Tutor" : "Student"}</p>
                        </td>
                        <td className="text-sm text-ink-700">{formatDate(r.createdAt)}</td>
                        <td>
                          {r.flagged ? (
                            <Badge tone="danger">Flagged — not eligible</Badge>
                          ) : (
                            <ul className="space-y-1">
                              {milestonesFor(r.kind).map(({ m, amount }) => {
                                const done = evs.some((e) => e.milestone === m);
                                const tone: Tone = done ? "success" : r.onboardingStep !== "complete" && m !== "student_verified" ? "neutral" : "warning";
                                return (
                                  <li key={m} className="flex items-center gap-2 text-sm">
                                    <Badge tone={tone}>{done ? "Earned" : "Pending"}</Badge>
                                    <span className="text-ink-700">
                                      {MILESTONE_LABEL[m]} · {formatNgn(amount)}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </td>
                        <td className="text-sm font-semibold text-ink-900">{formatNgn(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
