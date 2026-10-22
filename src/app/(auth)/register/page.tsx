import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Create your account" };

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const user = await getCurrentUser();
  if (user) redirect(user.onboardingStep === "complete" ? "/dashboard" : "/onboarding");
  const sp = await searchParams;
  const ref = typeof sp.ref === "string" ? sp.ref : "";
  const as = typeof sp.as === "string" ? sp.as : "";
  return (
    <>
      <h1 className="text-2xl font-bold text-ink-900">{as === "tutor" ? "Start teaching on TutorLink" : "Create your account"}</h1>
      <p className="mt-1 text-sm text-ink-500">
        {as === "tutor" ? "Set up your tutor profile, publish packages and get booked." : "Find trusted tutors, book sessions and earn rewards."}
      </p>
      <RegisterForm refCode={ref} />
      <p className="mt-6 text-center text-sm text-ink-600">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
