import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { auditTrailFor, getUserDetail } from "@/server/admin";
import { locationLabel } from "@/server/reference";
import { humanize, ROLE_TONE } from "../../_components/labels";
import { AuditTrail, DL, StatusBadge, When } from "../../_components/table";
import { CreditActions, ModerationActions, ReverseCreditButton, RoleActions } from "./user-actions";

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({ params }: PageProps<"/admin/users/[id]">) {
  const viewer = await requireAdmin();
  const { id } = await params;
  const d = await getUserDetail(id);
  if (!d) notFound();
  const [loc, trail] = await Promise.all([locationLabel(d.user), auditTrailFor("user", id, 50)]);
  const u = d.user;
  const props = { userId: u.id, status: u.status, adminRole: u.adminRole, isStudent: u.isStudent, isTutor: u.isTutor, viewerRole: viewer.adminRole, isSelf: viewer.id === u.id };
  const canFinance = viewer.adminRole === "super" || viewer.adminRole === "finance";
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/users" className="hover:underline">← Users</Link>}
        title={u.fullName}
        description={u.email}
        action={
          <div className="flex flex-wrap gap-1">
            <StatusBadge status={u.status} />
            {u.isStudent && <Badge tone="brand">Student</Badge>}
            {u.isTutor && <Badge tone="teal">Tutor</Badge>}
            {u.adminRole && <Badge tone={ROLE_TONE[u.adminRole]}>Admin · {u.adminRole}</Badge>}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Profile" />
            <div className="px-5 pb-5">
              <DL
                items={[
                  { label: "User id", value: <code className="text-xs">{u.id}</code> },
                  { label: "Display name", value: u.displayName },
                  { label: "Phone", value: u.phone },
                  { label: "Location", value: loc || null },
                  { label: "Timezone", value: u.timezone },
                  { label: "Onboarding", value: humanize(u.onboardingStep) },
                  { label: "Email verified", value: <When d={u.emailVerifiedAt} /> },
                  { label: "Phone verified", value: <When d={u.phoneVerifiedAt} /> },
                  { label: "Joined", value: <When d={u.createdAt} /> },
                  { label: "Last seen", value: <When d={u.lastSeenAt} /> },
                  { label: "Referred by", value: d.referredBy ? <Link href={`/admin/users/${d.referredBy.id}`} className="text-brand-600 hover:underline">{d.referredBy.email}</Link> : null },
                  { label: "Active sessions", value: String(d.counts.sessions) },
                ]}
              />
            </div>
          </Card>
          {d.profile && (
            <Card>
              <CardHeader
                title="Tutor verification"
                action={
                  <Link href={`/admin/tutors/${u.id}`} className="text-sm font-semibold text-brand-600 hover:underline">
                    Review →
                  </Link>
                }
              />
              <div className="px-5 pb-5">
                <DL
                  items={[
                    { label: "Identity", value: <StatusBadge status={d.profile.identityStatus} /> },
                    { label: "Qualifications", value: <StatusBadge status={d.profile.qualificationStatus} /> },
                    { label: "Listed in search", value: d.profile.isListed ? <Badge tone="success">Listed</Badge> : <Badge tone="neutral">Not listed</Badge> },
                    { label: "Rank score", value: d.profile.rankScore },
                    { label: "Rating", value: `${Number(d.profile.ratingAvg).toFixed(1)} (${d.profile.ratingCount})` },
                    { label: "Completed sessions", value: String(d.profile.completedSessions) },
                  ]}
                />
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Activity" />
            <div className="grid gap-3 px-5 pb-5 sm:grid-cols-3">
              {[
                { label: "Bookings as student", value: d.counts.bookingsAsStudent, href: `/admin/bookings?student=${encodeURIComponent(u.email)}` },
                { label: "Bookings as tutor", value: d.counts.bookingsAsTutor, href: `/admin/bookings?tutor=${encodeURIComponent(u.email)}` },
                { label: "Challenge attempts", value: d.counts.attempts, href: null },
                { label: "Referrals made", value: d.counts.referralsMade, href: `/admin/referrals?q=${encodeURIComponent(u.email)}` },
                { label: "Credit balance", value: formatNgn(d.creditBalance), href: null },
              ].map((x) => (
                <div key={x.label} className="rounded-[var(--radius-md)] border border-ink-100 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{x.label}</p>
                  <p className="mt-1 text-lg font-bold text-ink-900">{x.href ? <Link href={x.href} className="hover:underline">{x.value}</Link> : x.value}</p>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Credit entries" description="Most recent 25. Balance = sum of available entries." />
            {d.credits.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-ink-500">No credit entries.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tl-table min-w-[560px]">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Type</th>
                      <th>Reason</th>
                      <th className="text-right">Amount</th>
                      <th>Status</th>
                      {canFinance && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {d.credits.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <When d={c.createdAt} />
                        </td>
                        <td>{humanize(c.type)}</td>
                        <td className="max-w-[260px] whitespace-normal text-ink-600">{c.reason}</td>
                        <td className={`text-right tabular-nums ${c.amountNgn.startsWith("-") ? "text-danger-600" : "text-success-600"}`}>{formatNgn(c.amountNgn)}</td>
                        <td>
                          <StatusBadge status={c.status} />
                        </td>
                        {canFinance && <td>{c.status === "available" && !c.amountNgn.startsWith("-") && <ReverseCreditButton entryId={c.id} />}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Audit trail" description="Everything done to this account" />
            <AuditTrail rows={trail} />
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Moderation" />
            <div className="px-5 pb-5">
              <ModerationActions {...props} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Roles" />
            <div className="px-5 pb-5">
              <RoleActions {...props} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Credit adjustment" description="Adds an 'adjustment' credit entry with your reason." />
            <div className="px-5 pb-5">
              <CreditActions userId={u.id} viewerRole={viewer.adminRole} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
