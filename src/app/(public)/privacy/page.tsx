import { LegalPage } from "../legal-page";

export const metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice" updated="October 2026">
      <p>This notice explains how TutorLink collects and uses personal data, in line with the Nigeria Data Protection Act 2023 (NDPA). This is our operational notice; it does not constitute a legal compliance certification.</p>
      <h2>What we collect</h2>
      <ul>
        <li>Account data: name, email, phone, password hash, location (state, LGA, city).</li>
        <li>Tutor verification data: identity document type and reference, qualification details and documents — stored privately, never shown publicly.</li>
        <li>Transaction data: bookings, payment references and status from Flutterwave. We never store full card numbers.</li>
        <li>Activity data: challenge attempts, scores, reviews, notifications, security logs (IP address, user agent).</li>
      </ul>
      <h2>Why we use it</h2>
      <ul>
        <li>To run the marketplace: matching, bookings, payments, payouts, refunds and support.</li>
        <li>To keep the platform safe: verification, fraud prevention, audit logs and dispute handling.</li>
        <li>To operate challenges, leaderboards and rewards. Leaderboards show display names and city/state only.</li>
      </ul>
      <h2>Sharing</h2>
      <p>Tutors and students see each other&apos;s display name and contact phone only for confirmed bookings. We share data with Flutterwave (payments), our hosting and database providers, and when required by law.</p>
      <h2>Retention and deletion</h2>
      <p>You can delete your account from Settings. Personal details are removed immediately; booking and financial records are retained for accounting and legal purposes (up to 7 years) in minimised form.</p>
      <h2>Your rights</h2>
      <p>You may request access, correction, deletion or restriction of your data by emailing privacy@tutorlink.ng. We respond within the timelines required by the NDPA.</p>
      <h2>Minors</h2>
      <p>Accounts are for adults. Where a guardian books for a learner under 18, we collect only the information needed to deliver the session and apply additional safeguarding review to reports involving minors.</p>
    </LegalPage>
  );
}
