import Link from "next/link";
import { buttonClass } from "@/components/ui";

export function PaymentsNav({ active }: { active: "payments" | "refunds" | "payouts" }) {
  const items = [
    { key: "payments", href: "/admin/payments", label: "Payments & reconciliation" },
    { key: "refunds", href: "/admin/payments/refunds", label: "Refunds" },
    { key: "payouts", href: "/admin/payments/payouts", label: "Payouts" },
  ] as const;
  return (
    <nav className="mb-4 flex flex-wrap gap-2" aria-label="Payments sections">
      {items.map((i) => (
        <Link key={i.key} href={i.href} className={buttonClass(i.key === active ? "primary" : "outline", "sm")} aria-current={i.key === active ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
