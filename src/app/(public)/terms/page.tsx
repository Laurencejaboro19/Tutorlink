import { LegalPage } from "../legal-page";

export const metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="October 2026">
      <p>These terms govern use of TutorLink (&ldquo;the platform&rdquo;), a marketplace that connects learners with independent tutors in Nigeria. By creating an account you agree to them. TutorLink is a marketplace: tutors are independent providers, not employees of TutorLink.</p>
      <h2>Accounts</h2>
      <ul>
        <li>You must be 18 or older to hold an account. A parent or guardian may book sessions on behalf of a learner under 18 and remains responsible for that learner&apos;s participation and safety.</li>
        <li>One person, one account. A single account may hold both the student and tutor roles.</li>
        <li>You are responsible for keeping your password confidential and for activity under your account.</li>
      </ul>
      <h2>Bookings and payments</h2>
      <ul>
        <li>Prices are set by tutors. The amount you pay is calculated on our servers at booking time and shown before checkout.</li>
        <li>Payments are processed by Flutterwave. A session is confirmed only after the payment is verified with the processor.</li>
        <li>Cancellations: cancel at least 24 hours before the start time for a full refund; later cancellations may receive a partial refund as shown at booking. Tutor cancellations and no-shows are refunded in full.</li>
        <li>Platform credits are promotional, non-transferable, not redeemable for cash and may expire.</li>
      </ul>
      <h2>Tutor obligations and commission</h2>
      <ul>
        <li>Tutors must provide accurate identity and qualification information and keep their availability current.</li>
        <li>A platform commission (30% Free, 20% Premium, 10% Premium+) is deducted from each completed session at the rate in force when the session was booked.</li>
        <li>Earnings become eligible for payout after session completion and the dispute window; payouts require verified bank details and may be reviewed.</li>
      </ul>
      <h2>Challenges, leaderboards and rewards</h2>
      <p>Reward eligibility rules are published on the &ldquo;How rewards work&rdquo; page and may change prospectively. Fraud, automated participation, fake accounts or manipulated engagement voids eligibility and may lead to suspension.</p>
      <h2>Prohibited conduct</h2>
      <p>Harassment, discrimination, off-platform payment solicitation designed to avoid commission, impersonation, sharing of answer keys, scraping, and any unlawful activity are prohibited.</p>
      <h2>Liability</h2>
      <p>To the extent permitted by Nigerian law, TutorLink is not liable for the conduct of tutors or learners, for lesson outcomes, or for indirect losses. Nothing here limits liability that cannot be limited by law.</p>
      <h2>Changes and contact</h2>
      <p>We may update these terms; material changes will be notified in-app. Questions: support@tutorlink.ng.</p>
    </LegalPage>
  );
}
