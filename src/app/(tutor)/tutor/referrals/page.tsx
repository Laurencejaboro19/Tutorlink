import { ReferralsPanel } from "@/components/referrals-panel";
import { PageHeader } from "@/components/ui";
import { requireTutor } from "@/lib/auth";

export const metadata = { title: "Refer & earn" };
export const dynamic = "force-dynamic";

export default async function TutorReferralsPage() {
  const user = await requireTutor();
  return (
    <>
      <PageHeader eyebrow="Tutor" title="Refer & earn" description="Invite students and fellow tutors to TutorLink and earn platform credit when they hit milestones." />
      <ReferralsPanel userId={user.id} isTutor />
    </>
  );
}
