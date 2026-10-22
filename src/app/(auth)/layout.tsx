import Link from "next/link";
import { Logo } from "@/components/ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-ink-50">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
        <Link href="/" className="mb-8 self-center" aria-label="TutorLink home">
          <Logo size={44} />
        </Link>
        <div className="tl-card p-6 sm:p-8">{children}</div>
        <p className="mt-6 text-center text-xs text-ink-400">
          By continuing you agree to our <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy notice</Link>.
        </p>
      </div>
    </div>
  );
}
