import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { subjects, tutorProfiles, tutorSubjects } from "@/db/schema";
import { Alert, Card, PageHeader, buttonClass } from "@/components/ui";
import { requireTutor } from "@/lib/auth";
import { listExams } from "@/server/reference";
import { PackageForm } from "../package-form";

export const metadata = { title: "New package" };
export const dynamic = "force-dynamic";

export default async function NewPackagePage() {
  const user = await requireTutor();
  const [profile, mySubjects, exams] = await Promise.all([
    db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, user.id) }),
    db.select({ id: subjects.id, name: subjects.name }).from(tutorSubjects).innerJoin(subjects, eq(subjects.id, tutorSubjects.subjectId)).where(eq(tutorSubjects.tutorId, user.id)).orderBy(asc(subjects.name)),
    listExams(),
  ]);
  return (
    <>
      <nav className="mb-4 text-sm text-ink-500" aria-label="Breadcrumb">
        <Link href="/tutor/packages" className="hover:text-brand-600">
          Packages
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-ink-700">New</span>
      </nav>
      <PageHeader title="New package" description="Saved as a draft first. Publish it from the edit page when you are ready." />
      {mySubjects.length === 0 ? (
        <Alert tone="warning" title="Add a subject to your profile first">
          Packages must be for a subject you teach.{" "}
          <Link href="/tutor/profile" className={buttonClass("primary", "sm", "mt-3")}>
            Go to profile
          </Link>
        </Alert>
      ) : (
        <Card className="p-5 sm:p-6">
          <PackageForm values={{}} subjects={mySubjects} exams={exams.map((e) => ({ id: e.id, name: e.name }))} formats={{ physical: !!profile?.offersPhysical, online: !!profile?.offersOnline }} />
        </Card>
      )}
    </>
  );
}
