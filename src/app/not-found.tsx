import Link from "next/link";
import { buttonClass, Logo } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <Logo size={40} withWordmark={false} />
      <h1 className="mt-6 text-2xl font-bold text-ink-900">Page not found</h1>
      <p className="mt-2 max-w-md text-ink-500">The page you are looking for does not exist or you do not have access to it.</p>
      <Link href="/" className={buttonClass("primary", "md", "mt-6")}>
        Back to home
      </Link>
    </div>
  );
}
