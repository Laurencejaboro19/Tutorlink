import Link from "next/link";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-bold text-ink-900">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-500">Enter your email and we will send a link that is valid for 30 minutes.</p>
      <ForgotForm />
      <p className="mt-6 text-center text-sm text-ink-600">
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
