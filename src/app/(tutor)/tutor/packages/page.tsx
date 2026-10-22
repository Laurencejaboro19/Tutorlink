import Link from "next/link";
import { Alert, Badge, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { requireTutor } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { listTutorPackages, PACKAGE_STATUS } from "@/server/packages";
import { canPublishAnotherPackage, getActivePlan } from "@/server/plans";
import { levelLabel } from "@/server/reference";

export const metadata = { title: "Packages" };
export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const user = await requireTutor();
  const [rows, cap, { plan }] = await Promise.all([listTutorPackages(user.id), canPublishAnotherPackage(user.id), getActivePlan(user.id)]);
  const active = rows.filter((r) => r.pkg.status !== "archived");
  const archived = rows.filter((r) => r.pkg.status === "archived");
  return (
    <>
      <PageHeader
        title="Packages"
        description="What students can book. Drafts are private until you publish."
        action={
          <Link href="/tutor/packages/new" className={buttonClass("primary", "sm")}>
            New package
          </Link>
        }
      />
      <Alert tone={cap.ok ? "info" : "warning"} className="mb-5">
        <span className="font-semibold">{plan.name} plan:</span> {cap.published} of {cap.limit === null ? "unlimited" : cap.limit} published package{cap.limit === 1 ? "" : "s"} used.
        {!cap.ok && (
          <>
            {" "}
            Unpublish one to publish another, or{" "}
            <Link href="/tutor/subscription" className="font-semibold underline">
              upgrade for unlimited packages
            </Link>
            .
          </>
        )}
      </Alert>
      {active.length === 0 ? (
        <EmptyState
          title="No packages yet"
          description="Create your first package: a subject, level, price and what the student will achieve."
          action={
            <Link href="/tutor/packages/new" className={buttonClass("primary", "sm")}>
              Create a package
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3" aria-label="Packages">
          {active.map(({ pkg, subject, exam }) => {
            const st = PACKAGE_STATUS[pkg.status];
            return (
              <li key={pkg.id} className="tl-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <Badge tone="brand">{subject}</Badge>
                    <Badge>{levelLabel(pkg.level)}</Badge>
                    {exam && <Badge tone="teal">{exam}</Badge>}
                  </div>
                  <p className="mt-2 font-semibold text-ink-900">
                    <Link href={`/tutor/packages/${pkg.id}/edit`} className="hover:text-brand-600">
                      {pkg.title}
                    </Link>
                  </p>
                  <p className="text-sm text-ink-600">
                    {formatNgn(pkg.priceNgn)} · {pkg.sessionsCount} × {pkg.durationMinutes} min · {pkg.format === "hybrid" ? "In person or online" : pkg.format === "physical" ? "In person" : "Online"}
                  </p>
                </div>
                <Link href={`/tutor/packages/${pkg.id}/edit`} className={buttonClass("outline", "sm")}>
                  Edit
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {archived.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-ink-600">Archived ({archived.length})</summary>
          <ul className="mt-3 space-y-2">
            {archived.map(({ pkg, subject }) => (
              <li key={pkg.id} className="tl-card flex items-center justify-between gap-3 p-4 text-sm">
                <span>
                  <Badge>Archived</Badge> <span className="ml-1 font-medium text-ink-700">{pkg.title}</span> <span className="text-ink-500">· {subject}</span>
                </span>
                <span className="text-ink-500">{formatNgn(pkg.priceNgn)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
