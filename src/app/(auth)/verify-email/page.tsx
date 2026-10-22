import Link from "next/link";
import { Alert, buttonClass } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { verifyEmailToken } from "@/server/auth-actions";

export const metadata = { title: "Verify your email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const result = token ? await verifyEmailToken(token) : { ok: false, message: "Missing verification token." };
  const user = await getCurrentUser();
  return (
    <>
      <h1 className="text-2xl font-bold text-ink-900">Email verification</h1>
      <Alert tone={result.ok ? "success" : "danger"} className="mt-4">
        {result.message}
      </Alert>
      <div className="mt-6">
        {result.ok ? (
          <Link href={user ? "/onboarding" : "/login"} className={buttonClass("primary", "md", "w-full")}>
            {user ? "Continue setup" : "Sign in to continue"}
          </Link>
        ) : (
          <Link href={user ? "/onboarding" : "/login"} className={buttonClass("outline", "md", "w-full")}>
            {user ? "Request a new link" : "Sign in"}
          </Link>
        )}
      </div>
    </>
  );
}
