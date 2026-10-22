import type { Tone } from "@/components/ui";

export type PaymentStatus = "initiated" | "successful" | "failed" | "cancelled" | "refunded" | "partially_refunded";

/** Human label + badge tone for payments.status (never colour-only). */
export function paymentStatusLabel(s: PaymentStatus): { label: string; tone: Tone } {
  switch (s) {
    case "initiated":
      return { label: "Not completed", tone: "warning" };
    case "successful":
      return { label: "Paid", tone: "success" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "refunded":
      return { label: "Refunded", tone: "info" };
    case "partially_refunded":
      return { label: "Partly refunded", tone: "info" };
  }
}
