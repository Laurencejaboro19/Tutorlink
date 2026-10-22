import Link from "next/link";
import { LegalPage } from "../legal-page";

export const metadata = { title: "Safety & reporting" };

export default function SafetyPage() {
  return (
    <LegalPage title="Safety & reporting" updated="October 2026">
      <h2>Before an in-person session</h2>
      <ul>
        <li>Check the tutor&apos;s verification badges and reviews from completed sessions.</li>
        <li>For learners under 18, a parent or guardian should be present for in-person sessions.</li>
        <li>Keep payments on the platform — that is what makes refunds and dispute handling possible.</li>
      </ul>
      <h2>Reporting a problem</h2>
      <p>Every booking, profile, challenge and review has a &ldquo;Report&rdquo; action. Reports go to the moderation team, are logged, and are never shown publicly. Urgent safety concerns: contact the police first, then email safety@tutorlink.ng.</p>
      <h2>Disputes and refunds</h2>
      <p>If a session did not happen or was materially different from what was booked, open a dispute from the booking within 48 hours. The payment is held until the dispute is resolved by the finance team.</p>
      <p>
        Signed in? <Link href="/dashboard/bookings" className="underline">Go to your sessions</Link> to report or dispute.
      </p>
    </LegalPage>
  );
}
