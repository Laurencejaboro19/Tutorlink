import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, buttonClass, Pagination } from "@/components/ui";
import { formatDateTime } from "@/lib/time";
import { humanize, toneFor } from "./labels";

/** Horizontal-scroll wrapper so wide admin tables stay usable on phones. */
export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`tl-card overflow-hidden ${className ?? ""}`}>
      <div className="-mx-px overflow-x-auto">
        <table className="tl-table min-w-[640px] whitespace-nowrap">{children}</table>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  return <Badge tone={toneFor(status)}>{humanize(status)}</Badge>;
}

export function When({ d }: { d: Date | null | undefined }) {
  if (!d) return <span className="text-ink-400">—</span>;
  return (
    <time dateTime={d.toISOString()} className="text-ink-600">
      {formatDateTime(d)}
    </time>
  );
}

/** GET filter bar: every control must have a name; the page reads searchParams. */
export function FilterBar({ action, children, reset }: { action: string; children: ReactNode; reset?: string }) {
  return (
    <form method="get" action={action} className="tl-card mb-4 flex flex-wrap items-end gap-3 px-4 py-3">
      {children}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass("primary", "sm")}>
          Apply
        </button>
        <Link href={reset ?? action} className={buttonClass("ghost", "sm")}>
          Reset
        </Link>
      </div>
    </form>
  );
}

export function FilterField({ label, name, children }: { label: string; name: string; children: ReactNode }) {
  return (
    <label className="flex min-w-[140px] flex-col gap-1 text-xs font-medium text-ink-600" htmlFor={`f-${name}`}>
      {label}
      {children}
    </label>
  );
}

export function FilterInput({ name, value, placeholder, type = "text" }: { name: string; value?: string; placeholder?: string; type?: string }) {
  return <input id={`f-${name}`} name={name} type={type} defaultValue={value ?? ""} placeholder={placeholder} className="tl-input !min-h-[40px] !py-1.5 text-sm" />;
}

export function FilterSelect({ name, value, options, allLabel = "All" }: { name: string; value?: string; options: { value: string; label: string }[]; allLabel?: string }) {
  return (
    <select id={`f-${name}`} name={name} defaultValue={value ?? ""} className="tl-input !min-h-[40px] !py-1.5 text-sm">
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function enumOptions(values: readonly string[]) {
  return values.map((v) => ({ value: v, label: humanize(v) }));
}

/** Collapsed JSON viewer for payloads and audit diffs. */
export function JsonDetails({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return <span className="text-ink-400">—</span>;
  return (
    <details className="group">
      <summary className="cursor-pointer select-none text-xs font-semibold text-brand-600 hover:underline">{label}</summary>
      <pre className="mt-2 max-h-80 max-w-[80vw] overflow-auto rounded-[var(--radius-sm)] bg-ink-50 p-3 text-xs text-ink-700 whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function DL({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{it.label}</dt>
          <dd className="mt-0.5 break-words text-ink-900">{it.value ?? <span className="text-ink-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ResultCount({ total, page, pageCount }: { total: number; page: number; pageCount: number }) {
  return (
    <p className="mb-2 text-xs text-ink-500">
      {total.toLocaleString()} result{total === 1 ? "" : "s"} · page {page} of {pageCount}
    </p>
  );
}

/** Builds the href for a page while keeping the current filters. */
export function pageHref(base: string, params: Record<string, string | undefined>) {
  return (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${base}?${sp.toString()}`;
  };
}

export function AdminPagination({ base, params, page, pageCount }: { base: string; params: Record<string, string | undefined>; page: number; pageCount: number }) {
  return <Pagination page={page} pageCount={pageCount} hrefFor={pageHref(base, params)} />;
}

/** Normalises Next's searchParams record into string values. */
export function str(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return typeof v === "string" ? v.trim() : undefined;
}

export function pageNum(sp: Record<string, string | string[] | undefined>) {
  const n = Number(str(sp, "page") ?? "1");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export function AuditTrail({ rows }: { rows: { entry: { id: string; action: string; actorRole: string | null; before: unknown; after: unknown; createdAt: Date }; actorEmail: string | null }[] }) {
  if (!rows.length) return <p className="px-5 pb-5 text-sm text-ink-500">No audit entries yet.</p>;
  return (
    <ul className="divide-y divide-ink-100">
      {rows.map(({ entry, actorEmail }) => (
        <li key={entry.id} className="px-5 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-ink-900">{entry.action}</span>
            <When d={entry.createdAt} />
          </div>
          <p className="mt-0.5 text-xs text-ink-500">
            by {actorEmail ?? "system"}
            {entry.actorRole ? ` (${entry.actorRole})` : ""}
          </p>
          {entry.before || entry.after ? (
            <div className="mt-1">
              <JsonDetails label="Details" value={{ before: entry.before ?? undefined, after: entry.after ?? undefined }} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
