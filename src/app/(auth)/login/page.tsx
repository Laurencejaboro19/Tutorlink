import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const user = await getCurrentUser();
  if (user) redirect(user.onboardingStep === "complete" ? "/dashboard" : "/onboarding");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "";
  return (
    <>
      <h1 className="text-2xl font-bold text-ink-900">Welcome back</h1>
      <p className="mt-1 text-sm text-ink-500">Sign in to manage your sessions, challenges and rewards.</p>
      {sp.reset === "1" && <Alert tone="success" className="mt-4">Your password was updated. Sign in with the new one.</Alert>}
      <LoginForm next={next} />
      <p className="mt-6 text-center text-sm text-ink-600">
        New to TutorLink?{" "}
        <Link href="/register" className="font-semibold text-brand-600 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
