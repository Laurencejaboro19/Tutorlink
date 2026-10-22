import { getSettings } from "@/lib/settings";
import { LegalPage } from "../legal-page";

export const metadata = { title: "How rewards work" };

export default async function RewardsPage() {
  const s = await getSettings(["leaderboard.cycle_days", "leaderboard.top_n", "leaderboard.reward_ngn", "leaderboard.min_attempts_for_eligibility", "leaderboard.cash_min_paid_session_ngn", "referral.student_verified_ngn", "referral.student_first_session_ngn", "referral.tutor_paid_upgrade_ngn", "referral.tutor_five_sessions_ngn", "credits.max_redeem_pct_of_booking"]);
  return (
    <LegalPage title="How rewards work" updated="October 2026">
      <h2>Daily challenges and points</h2>
      <p>Each published challenge awards points per correct answer. Answers are checked on our servers; correct answers are never sent to your browser before you submit. Only your best submitted attempt per challenge counts.</p>
      <h2>Leaderboard cycles</h2>
      <p>
        Leaderboards run in {s["leaderboard.cycle_days"]}-day cycles and are ranked by points, then by number of correct answers, then by the shorter total time, then by who submitted first (deterministic tie-breaking). You need at least {s["leaderboard.min_attempts_for_eligibility"]} submitted attempts in a cycle to be eligible for rewards. Historical cycles are kept forever.
      </p>
      <h2>Student rewards</h2>
      <p>
        At the end of each cycle the top {s["leaderboard.top_n"]} eligible students on the nationwide board each receive a reward worth ₦{Number(s["leaderboard.reward_ngn"]).toLocaleString()}.
      </p>
      <ul>
        <li>
          <strong>Cash</strong> — if you completed at least one paid tutoring session of ₦{Number(s["leaderboard.cash_min_paid_session_ngn"]).toLocaleString()} or more during the cycle and have verified bank details. Cash rewards are reviewed by the finance team before payout and paid through Flutterwave transfers.
        </li>
        <li>
          <strong>Platform credit</strong> — for all other eligible winners. Credits can cover up to {s["credits.max_redeem_pct_of_booking"]}% of a booking and are not withdrawable.
        </li>
      </ul>
      <p>Rewards are capped by the cycle budget, distributed once per cycle, and reversed if fraud is found.</p>
      <h2>Tutor engagement rewards</h2>
      <p>Tutors who create challenges are scored on unique participants, completion rate and repeat participation — not raw attempts. Each cycle, the top qualifying Free-plan tutor receives one month of Premium and the top qualifying Premium tutor receives one month of Premium+. Premium+ tutors are recognised on the leaderboard but receive no additional plan reward.</p>
      <h2>Referrals</h2>
      <ul>
        <li>Student referral: ₦{s["referral.student_verified_ngn"]} when your friend verifies their email and completes setup; ₦{s["referral.student_first_session_ngn"]} more after their first qualifying paid session.</li>
        <li>Tutor referral: ₦{Number(s["referral.tutor_paid_upgrade_ngn"]).toLocaleString()} when the tutor pays for Premium or Premium+; ₦{Number(s["referral.tutor_five_sessions_ngn"]).toLocaleString()} more after five qualifying paid sessions.</li>
      </ul>
      <p>Self-referrals, duplicate accounts and sessions created to game referrals are rejected and may lead to suspension.</p>
    </LegalPage>
  );
}
