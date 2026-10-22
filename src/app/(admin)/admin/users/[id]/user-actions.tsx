"use client";

import { Field, Input, Select, Textarea } from "@/components/ui";
import { addUserRoleAction, adjustCreditAction, reverseCreditAction, revokeSessionsAction, setAdminRoleAction, suspendUserAction, unsuspendUserAction } from "@/server/admin-actions";
import { AdminForm, FieldError } from "../../_components/forms";

type Props = { userId: string; status: string; adminRole: string | null; isStudent: boolean; isTutor: boolean; viewerRole: "super" | "moderator" | "finance"; isSelf: boolean };

export function ModerationActions({ userId, status, viewerRole, isSelf }: Props) {
  const canMod = viewerRole === "super" || viewerRole === "moderator";
  if (!canMod) return <p className="text-sm text-ink-500">Suspension and session controls are available to moderators and super admins.</p>;
  return (
    <div className="space-y-6">
      {status === "suspended" ? (
        <AdminForm action={unsuspendUserAction} hidden={{ userId }} submitLabel="Reinstate account" variant="secondary">
          <Field label="Note (optional)" name="note">
            <Input id="note" name="note" maxLength={2000} />
          </Field>
        </AdminForm>
      ) : isSelf ? (
        <p className="text-sm text-ink-500">You cannot suspend your own account.</p>
      ) : (
        <AdminForm action={suspendUserAction} hidden={{ userId }} submitLabel="Suspend account" variant="danger" confirm="I understand this signs the user out everywhere, blocks sign-in and unlists any tutor profile.">
          <Field label="Reason" name="reason" required>
            <Textarea id="reason" name="reason" maxLength={2000} required />
            <FieldError name="reason" />
          </Field>
        </AdminForm>
      )}
      <AdminForm action={revokeSessionsAction} hidden={{ userId }} submitLabel="Sign out of all devices" variant="outline" confirm="I understand all active sessions for this user will be deleted." />
    </div>
  );
}

export function RoleActions({ userId, adminRole, isStudent, isTutor, viewerRole, isSelf }: Props) {
  if (viewerRole !== "super") return <p className="text-sm text-ink-500">Only super admins can change roles.</p>;
  return (
    <div className="space-y-6">
      {isSelf ? (
        <p className="text-sm text-ink-500">You cannot change your own admin role. Ask another super admin.</p>
      ) : (
        <AdminForm action={setAdminRoleAction} hidden={{ userId }} submitLabel="Update admin role" confirm="I understand this changes what this person can do across the platform.">
          <Field label="Admin role" name="adminRole" help="Super: everything. Moderator: users, verification, challenges, reports, bookings. Finance: payments, refunds, payouts, rewards, subscriptions, credits.">
            <Select id="adminRole" name="adminRole" defaultValue={adminRole ?? "none"}>
              <option value="none">No admin access</option>
              <option value="moderator">Moderator</option>
              <option value="finance">Finance</option>
              <option value="super">Super admin</option>
            </Select>
            <FieldError name="adminRole" />
          </Field>
        </AdminForm>
      )}
      {(!isStudent || !isTutor) && (
        <AdminForm action={addUserRoleAction} hidden={{ userId }} submitLabel="Add role" variant="outline">
          <Field label="Add platform role" name="role">
            <Select id="role" name="role" defaultValue={!isStudent ? "student" : "tutor"}>
              {!isStudent && <option value="student">Student</option>}
              {!isTutor && <option value="tutor">Tutor (creates an empty tutor profile)</option>}
            </Select>
          </Field>
        </AdminForm>
      )}
    </div>
  );
}

export function CreditActions({ userId, viewerRole }: { userId: string; viewerRole: string }) {
  if (viewerRole !== "super" && viewerRole !== "finance") return <p className="text-sm text-ink-500">Credit adjustments are a finance action.</p>;
  return (
    <AdminForm action={adjustCreditAction} hidden={{ userId }} submitLabel="Issue credit" confirm="I understand this adds redeemable credit to the user's balance and is recorded in the audit log.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (NGN)" name="amountNgn" required>
          <Input id="amountNgn" name="amountNgn" inputMode="decimal" placeholder="500" required />
          <FieldError name="amountNgn" />
        </Field>
        <Field label="Reason" name="reason" required>
          <Input id="reason" name="reason" maxLength={2000} required placeholder="Goodwill for cancelled session" />
          <FieldError name="reason" />
        </Field>
      </div>
    </AdminForm>
  );
}

export function ReverseCreditButton({ entryId }: { entryId: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold text-danger-600 hover:underline">Reverse</summary>
      <div className="mt-2 w-72 max-w-full">
        <AdminForm action={reverseCreditAction} hidden={{ entryId }} submitLabel="Reverse credit" variant="danger" confirm="I understand this deducts the credit from the user's balance.">
          <Field label="Reason" name="reason" required>
            <Input id={`reason-${entryId}`} name="reason" maxLength={2000} required />
            <FieldError name="reason" />
          </Field>
        </AdminForm>
      </div>
    </details>
  );
}
