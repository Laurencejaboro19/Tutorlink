"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { LocationPicker } from "@/components/location-picker";
import { Card, CardHeader, Field, Input } from "@/components/ui";
import { changePasswordAction, deleteAccountAction } from "@/server/auth-actions";
import { updateContactAction } from "@/server/account-actions";
import { setLocationAction, setRoleAction } from "@/server/onboarding-actions";

export function AccountForms({
  states,
  user,
  locationText,
}: {
  states: { id: number; name: string }[];
  user: { displayName: string | null; phone: string | null; stateId: number | null; lgaId: number | null; cityId: number | null; isStudent: boolean; isTutor: boolean };
  locationText: string;
}) {
  return (
    <>
      <Card>
        <CardHeader title="Contact details" />
        <ActionForm action={updateContactAction} className="space-y-4 px-5 pb-5" submitLabel="Save changes" successMessage="Saved.">
          <Field label="Display name" name="displayName" required>
            <Input id="displayName" name="displayName" defaultValue={user.displayName ?? ""} maxLength={60} required />
            <FieldError name="displayName" />
          </Field>
          <Field label="Phone number" name="phone" required>
            <Input id="phone" name="phone" type="tel" defaultValue={user.phone ?? ""} required />
            <FieldError name="phone" />
          </Field>
        </ActionForm>
      </Card>
      <Card>
        <CardHeader title="Location" description={locationText ? `Currently: ${locationText}` : "Not set"} />
        <ActionForm action={setLocationAction} className="px-5 pb-5" submitLabel="Update location" successMessage="Location updated.">
          <LocationPicker states={states} initial={user} />
        </ActionForm>
      </Card>
      {(!user.isStudent || !user.isTutor) && (
        <Card>
          <CardHeader title="Add a role" description={user.isTutor ? "Also want to learn? Add the student role." : "Want to teach? Add the tutor role and complete verification."} />
          <ActionForm action={setRoleAction} className="px-5 pb-5" submitLabel={user.isTutor ? "Add student role" : "Add tutor role"} submitVariant="outline">
            <input type="hidden" name="role" value={user.isTutor ? "student" : "tutor"} />
          </ActionForm>
        </Card>
      )}
      <Card>
        <CardHeader title="Change password" />
        <ActionForm action={changePasswordAction} className="space-y-4 px-5 pb-5" submitLabel="Change password" submitVariant="outline" resetOnSuccess>
          <Field label="Current password" name="current" required>
            <Input id="current" name="current" type="password" autoComplete="current-password" required />
            <FieldError name="current" />
          </Field>
          <Field label="New password" name="password" required>
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
            <FieldError name="password" />
          </Field>
        </ActionForm>
      </Card>
      <Card className="border-red-200">
        <CardHeader title="Delete account" description="Personal details are removed; booking and payment records are kept for legal and accounting reasons (NDPA retention)." />
        <ActionForm action={deleteAccountAction} className="space-y-4 px-5 pb-5" submitLabel="Delete my account" submitVariant="danger">
          <Field label="Confirm with your password" name="password" required>
            <Input id="delete-password" name="password" type="password" autoComplete="current-password" required />
          </Field>
        </ActionForm>
      </Card>
    </>
  );
}
