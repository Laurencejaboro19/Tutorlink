import type { ReactNode } from "react";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-ink-900">{title}</h1>
      <p className="mt-1 text-sm text-ink-400">Last updated {updated}</p>
      <div className="tl-prose mt-8 space-y-6 text-[15px] leading-relaxed text-ink-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink-900 [&_li]:ml-5 [&_li]:list-disc">{children}</div>
    </article>
  );
}
