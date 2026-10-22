import { PageHeader } from "@/components/ui";
import { requireTutor } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { addDays, platformDay } from "@/lib/time";
import { LEVELS, listExams, listSubjects } from "@/server/reference";
import { ChallengeForm } from "../challenge-form";
import { CATEGORIES } from "../categories";

export const metadata = { title: "New challenge" };
export const dynamic = "force-dynamic";

export default async function NewChallengePage() {
  const user = await requireTutor();
  const [subjects, exams, requireReview, defaultLimit, defaultAttempts] = await Promise.all([listSubjects(), listExams(), getSetting("challenge.require_review_for_tutor_challenges"), getSetting("challenge.default_time_limit_seconds"), getSetting("challenge.default_max_attempts")]);
  const tomorrow = platformDay(addDays(new Date(), 1));
  return (
    <>
      <PageHeader eyebrow="Tutor" title="New challenge" description="Multiple-choice only. Students see the questions and options; correct answers and explanations are revealed after they submit." />
      <ChallengeForm
        initial={{ title: "", description: "", category: CATEGORIES[0], subjectId: null, level: "", examId: null, scheduledFor: tomorrow, timeLimitSeconds: defaultLimit, maxAttempts: defaultAttempts, questions: [] }}
        subjects={subjects.map((s) => ({ id: s.id, name: s.name, category: s.category }))}
        exams={exams.map((e) => ({ id: e.id, name: e.name }))}
        levels={LEVELS}
        minDay={platformDay()}
        directPublish={Boolean(user.adminRole) || !requireReview}
      />
    </>
  );
}
