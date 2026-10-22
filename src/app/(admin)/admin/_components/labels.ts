import type { Tone } from "@/components/ui";

/** Human label for any snake_case status/enum value. */
export function humanize(v: string | null | undefined) {
  if (!v) return "—";
  const s = v.replaceAll("_", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const TONES: Record<string, Tone> = {
  // generic
  active: "success",
  verified: "success",
  published: "success",
  completed: "success",
  successful: "success",
  paid: "success",
  credited: "success",
  resolved: "success",
  confirmed: "teal",
  approved: "teal",
  initiated: "info",
  processing: "info",
  payout_initiated: "info",
  investigating: "info",
  in_review: "warning",
  pending: "warning",
  pending_review: "warning",
  pending_payment: "warning",
  requested: "warning",
  needs_info: "warning",
  open: "warning",
  past_due: "warning",
  disputed: "warning",
  hold: "neutral",
  draft: "neutral",
  not_submitted: "neutral",
  unpublished: "neutral",
  archived: "neutral",
  expired: "neutral",
  dismissed: "neutral",
  hidden: "neutral",
  cancelled: "neutral",
  cancelled_by_student: "neutral",
  cancelled_by_tutor: "danger",
  no_show_student: "danger",
  no_show_tutor: "danger",
  suspended: "danger",
  deleted: "danger",
  rejected: "danger",
  failed: "danger",
  refunded: "danger",
  partially_refunded: "warning",
  reversed: "danger",
  error: "danger",
  duplicate: "neutral",
  ignored: "neutral",
  unknown_reference: "warning",
};

export function toneFor(status: string | null | undefined): Tone {
  return (status && TONES[status]) || "neutral";
}

export const ROLE_TONE: Record<string, Tone> = { super: "danger", moderator: "brand", finance: "teal" };

export function shortId(id: string | null | undefined) {
  return id ? id.slice(0, 8) : "—";
}
