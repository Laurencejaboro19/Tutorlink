import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { subjects, tutorProfiles, tutorSubjects } from "@/db/schema";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireTutor } from "@/lib/auth";
import { getOwnPackage, PACKAGE_STATUS } from "@/server/packages";
import { canPublishAnotherPackage, getActivePlan } from "@/server/plans";
import { listExams } from "@/server/reference";
import { PackageForm, PackageStatusActions } from "../../package-form";

export const metadata = { title: "Edit package" };
export const dynamic = "force-dynamic";

export default async function EditPackagePage({ params, searchParams }: PageProps<"/tutor/packages/[id]/edit">) {
  const user = await requireTutor();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const pkg = await getOwnPackage(user.id, id);
  if (!pkg) notFound();
  const [profile, mySubjects, exams, cap, { plan }] = await Promise.all([
    db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, user.id) }),
    db.select({ id: subjects.id, name: subjects.name }).from(tutorSubjects).innerJoin(subjects, eq(subjects.id, tutorSubjects.subjectId)).where(eq(tutorSubjects.tutorId, user.id)).orderBy(asc(subjects.name)),
    listExams(),
    canPublishAnotherPackage(user.id),
    getActivePlan(user.id),
  ]);
  const st = PACKAGE_STATUS[pkg.status];
  return (
    <>
      <nav className="mb-4 text-sm text-ink-500" aria-label="Breadcrumb">
        <Link href="/tutor/packages" className="hover:text-brand-600">
          Packages
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-ink-700">{pkg.title}</span>
      </nav>
      <PageHeader title={pkg.title} description={<Badge tone={st.tone}>{st.label}</Badge>} />
      {sp.created === "1" && (
        <Alert tone="success" className="mb-5">
          Draft created. Review it below, then publish when ready.
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card className="p-5 sm:p-6">
          {pkg.status === "archived" ? (
            <Alert tone="neutral">This package is archived and read-only. Its bookings and history are kept.</Alert>
          ) : (
            <PackageForm
              values={{ ...pkg, examId: pkg.examId }}
              subjects={mySubjects}
              exams={exams.map((e) => ({ id: e.id, name: e.name }))}
              formats={{ physical: !!profile?.offersPhysical, online: !!profile?.offersOnline }}
            />
          )}
        </Card>
        <aside>
          <Card>
            <CardHeader title="Visibility" description={`Status: ${st.label}`} />
            <div className="px-5 pb-5">
              <PackageStatusActions
                id={pkg.id}
                status={pkg.status}
                canPublish={cap.ok}
                limitText={`Your ${plan.name} plan allows ${cap.limit} published package${cap.limit === 1 ? "" : "s"}; you have ${cap.published}.`}
              />
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
