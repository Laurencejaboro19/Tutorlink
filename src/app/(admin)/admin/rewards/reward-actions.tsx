"use client";

import { Input } from "@/components/ui";
import {
  approveStudentRewardAction,
  approveTutorRewardAction,
  distributeRewardsAction,
  finalizeCycleAction,
  markRewardFailedAction,
  markRewardPaidAction,
  rejectStudentRewardAction,
  rejectTutorRewardAction,
  setCycleBudgetAction,
} from "@/server/admin-actions";
import { AdminForm, FieldError } from "../_components/forms";

const small = "!min-h-[40px] text-sm";

export function StudentRewardActions({ rewardId, status, kind }: { rewardId: string; status: string; kind: string }) {
  return (
    <div className="flex flex-col gap-3">
      {status === "pending_review" && <AdminForm action={approveStudentRewardAction} hidden={{ rewardId }} submitLabel="Approve" variant="secondary" inline />}
      {kind === "cash" && (status === "approved" || status === "payout_initiated") && (
        <>
          <AdminForm action={markRewardPaidAction} hidden={{ rewardId }} submitLabel="Mark paid" inline confirm="I have made or confirmed the transfer.">
            <Input name="payoutRef" placeholder="Payout / transfer reference" aria-label="Payout reference" required className={small} />
            <FieldError name="payoutRef" />
          </AdminForm>
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-danger-600 hover:underline">Mark failed…</summary>
            <AdminForm action={markRewardFailedAction} hidden={{ rewardId }} submitLabel="Mark failed" variant="danger" inline className="mt-2 flex flex-col gap-2">
              <Input name="note" placeholder="Reason" aria-label="Failure reason" required className={small} />
              <FieldError name="note" />
            </AdminForm>
          </details>
        </>
      )}
      {(status === "pending_review" || status === "approved" || status === "failed" || status === "credited") && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-danger-600 hover:underline">{status === "credited" ? "Reverse…" : "Reject…"}</summary>
          <AdminForm action={rejectStudentRewardAction} hidden={{ rewardId }} submitLabel={status === "credited" ? "Reverse credit" : "Reject"} variant="danger" inline className="mt-2 flex flex-col gap-2" confirm="I understand the student is notified and, if credited, the credit is reversed.">
            <Input name="note" placeholder="Reason sent to student" aria-label="Rejection reason" required className={small} />
            <FieldError name="note" />
          </AdminForm>
        </details>
      )}
    </div>
  );
}

export function TutorRewardActions({ rewardId, status }: { rewardId: string; status: string }) {
  if (status !== "pending_review") return null;
  return (
    <div className="flex flex-col gap-3">
      <AdminForm action={approveTutorRewardAction} hidden={{ rewardId }} submitLabel="Approve (grant month)" variant="secondary" inline />
      <details>
        <summary className="cursor-pointer text-xs font-semibold text-danger-600 hover:underline">Reject…</summary>
        <AdminForm action={rejectTutorRewardAction} hidden={{ rewardId }} submitLabel="Reject" variant="danger" inline className="mt-2 flex flex-col gap-2">
          <Input name="note" placeholder="Reason sent to tutor" aria-label="Rejection reason" required className={small} />
          <FieldError name="note" />
        </AdminForm>
      </details>
    </div>
  );
}

export function CycleActions({ cycleId, status, ended, budgetNgn }: { cycleId: string; status: string; ended: boolean; budgetNgn: string }) {
  return (
    <div className="flex flex-col gap-3">
      {status === "open" && ended && <AdminForm action={finalizeCycleAction} hidden={{ cycleId }} submitLabel="Finalize" variant="secondary" inline confirm="I understand standings are frozen for this cycle." />}
      {status === "open" && !ended && <span className="text-xs text-ink-400">Still running</span>}
      {status === "finalized" && <AdminForm action={distributeRewardsAction} hidden={{ cycleId }} submitLabel="Distribute rewards" inline confirm="I understand reward rows are created for review (nothing is paid yet)." />}
      {status !== "rewarded" && (
        <AdminForm action={setCycleBudgetAction} hidden={{ cycleId }} submitLabel="Save budget" variant="outline" inline>
          <Input name="budgetNgn" defaultValue={budgetNgn} inputMode="decimal" aria-label="Budget (NGN)" className={small} />
          <FieldError name="budgetNgn" />
        </AdminForm>
      )}
    </div>
  );
}
