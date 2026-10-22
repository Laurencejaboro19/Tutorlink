import { ReferralsPanel } from "@/components/referrals-panel";
import { PageHeader } from "@/components/ui";
import { requireStudent } from "@/lib/auth";

export const metadata = { title: "Refer & earn" };
export const dynamic = "force-dynamic";

export default async function StudentReferralsPage() {
  const user = await requireStudent();
  return (
    <>
      <PageHeader eyebrow="Student" title="Refer & earn" description="Invite friends to TutorLink and earn platform credit when they hit milestones." />
      <ReferralsPanel userId={user.id} isTutor={user.isTutor} />
    </>
  );
}
