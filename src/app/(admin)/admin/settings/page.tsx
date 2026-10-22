import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { listSettingsWithValues } from "@/server/admin";
import { When } from "../_components/table";
import { SettingForm } from "./setting-form";

export const metadata = { title: "Platform settings · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireAdmin(["super"]);
  const settings = await listSettingsWithValues();
  const groups = new Map<string, typeof settings>();
  for (const s of settings) {
    const g = s.key.split(".")[0];
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  return (
    <>
      <PageHeader title="Platform settings" description="Commercial policies and limits. Every change is audited with the previous and new value and takes effect within 30 seconds." />
      <Alert tone="warning" className="mb-6">
        Settings change behaviour for everyone immediately. Prices and commissions already snapshotted on bookings are never altered.
      </Alert>
      <div className="space-y-6">
        {[...groups.entries()].map(([group, items]) => (
          <Card key={group}>
            <CardHeader title={group.charAt(0).toUpperCase() + group.slice(1).replaceAll("_", " ")} description={`${items.length} setting${items.length === 1 ? "" : "s"}`} />
            <ul className="divide-y divide-ink-100">
              {items.map((s) => (
                <li key={s.key} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <code className="text-sm font-semibold text-ink-900">{s.key}</code>
                      <Badge tone="neutral">{s.type}</Badge>
                      {s.overridden ? <Badge tone="brand">Overridden</Badge> : <Badge tone="neutral">Default</Badge>}
                    </p>
                    <p className="mt-1 text-sm text-ink-600">{s.description}</p>
                    <p className="mt-1 text-xs text-ink-400">
                      Default: {JSON.stringify(s.defaultValue)}
                      {s.overridden && (
                        <>
                          {" "}
                          · changed <When d={s.updatedAt} />
                        </>
                      )}
                    </p>
                  </div>
                  <SettingForm setting={{ key: s.key, type: s.type, value: s.value, defaultValue: s.defaultValue }} />
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
