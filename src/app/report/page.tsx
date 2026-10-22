import Link from "next/link";
import { Alert, buttonClass, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { REPORT_TARGETS, resolveTarget } from "@/server/admin";
import { ReportForm } from "./report-form";

export const metadata = { title: "Report a problem" };

const TARGET_LABEL: Record<string, string> = { user: "a user", booking: "a session", challenge: "a challenge", review: "a review" };

export default async function ReportPage({ searchParams }: PageProps<"/report">) {
  await requireUser({ allowIncompleteOnboarding: true });
  const sp = await searchParams;
  const sent = typeof sp.sent === "string" ? sp.sent : null;
  const type = typeof sp.type === "string" ? sp.type : "";
  const id = typeof sp.id === "string" ? sp.id : "";
  const validType = (REPORT_TARGETS as readonly string[]).includes(type);
  const validId = /^[0-9a-f-]{36}$/i.test(id);

  if (sent) {
    return (
      <>
        <PageHeader title="Thanks for the report" description="Our moderation team has been notified and will review it. We will let you know in your notifications when it is handled." />
        <Alert tone="success">Report reference: {sent.slice(0, 8)}</Alert>
        <div className="mt-6">
          <Link href="/" className={buttonClass("outline", "md")}>
            Back to TutorLink
          </Link>
        </div>
      </>
    );
  }

  const target = validType && validId ? await resolveTarget(type, id) : null;

  return (
    <>
      <PageHeader title="Report a problem" description="Reports are confidential. False reports may lead to action on your own account." />
      {!target || target.type === "missing" ? (
        <Alert tone="warning" title="Nothing to report here">
          Open this page from the “Report” link on a tutor profile, a session, a challenge or a review so we know what you are reporting.
          {target?.type === "missing" && <p className="mt-1">{target.label}.</p>}
        </Alert>
      ) : (
        <>
          <div className="tl-card px-5 py-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">You are reporting {TARGET_LABEL[type]}</p>
            <p className="mt-1 font-medium text-ink-900">{target.label}</p>
          </div>
          <ReportForm type={type} id={id} />
          <p className="mt-6 text-xs text-ink-500">
            In an emergency, contact the police first. Read our <Link href="/safety" className="font-semibold text-brand-600 hover:underline">safety guidance</Link>.
          </p>
        </>
      )}
    </>
  );
}
