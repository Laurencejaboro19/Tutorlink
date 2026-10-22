import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { listStates, listSubjects } from "@/server/reference";
import { logoutAction } from "@/server/auth-actions";
import { LocationStep, ProfileStep, RoleStep, VerifyStep } from "./steps";

export const metadata = { title: "Set up your account" };

const STEPS = ["verify_email", "location", "role", "profile"] as const;

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.onboardingStep === "complete") redirect(user.isStudent ? "/dashboard" : "/tutor");
  const idx = STEPS.indexOf(user.onboardingStep as (typeof STEPS)[number]);
  const states = await listStates();
  const subjects = user.isTutor ? await listSubjects() : [];

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ink-50">
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <Logo size={36} />
          <form action={logoutAction}>
            <button className="text-sm text-ink-500 hover:text-ink-900">Sign out</button>
          </form>
        </div>
        <ol className="mb-6 flex items-center gap-2 text-xs font-medium text-ink-500" aria-label="Setup progress">
          {["Verify email", "Location", "Role", "Profile"].map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${i < idx ? "bg-teal-500 text-white" : i === idx ? "bg-brand-600 text-white" : "bg-ink-200 text-ink-600"}`} aria-current={i === idx ? "step" : undefined}>
                {i < idx ? "✓" : i + 1}
              </span>
              <span className={i === idx ? "text-ink-900" : ""}>{label}</span>
              {i < 3 && <span className="mx-1 h-px w-4 bg-ink-200 sm:w-8" aria-hidden="true" />}
            </li>
          ))}
        </ol>
        <div className="tl-card p-6 sm:p-8">
          {user.onboardingStep === "verify_email" && <VerifyStep email={user.email} />}
          {user.onboardingStep === "location" && <LocationStep states={states} />}
          {user.onboardingStep === "role" && <RoleStep />}
          {user.onboardingStep === "profile" && <ProfileStep isTutor={user.isTutor} fullName={user.fullName} subjects={subjects} />}
        </div>
        <p className="mt-4 text-center text-xs text-ink-400">
          Need help? <Link href="/safety" className="underline">Contact support</Link>
        </p>
      </div>
    </div>
  );
}
