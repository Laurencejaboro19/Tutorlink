import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ---------------- Button ---------------- */

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variantClass: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300",
  secondary: "bg-teal-500 text-white hover:bg-teal-600 active:bg-teal-700 disabled:bg-teal-200",
  outline: "border border-ink-200 bg-white text-ink-900 hover:border-ink-300 hover:bg-ink-50 disabled:text-ink-400",
  ghost: "text-ink-700 hover:bg-ink-100 disabled:text-ink-400",
  danger: "bg-danger-600 text-white hover:bg-red-800 disabled:bg-red-300",
};
const sizeClass: Record<Size, string> = {
  sm: "h-9 px-3 text-sm rounded-[var(--radius-sm)]",
  md: "h-11 px-4 text-[15px] rounded-[var(--radius-md)]",
  lg: "h-12 px-6 text-base rounded-[var(--radius-md)]",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-colors select-none disabled:cursor-not-allowed",
    variantClass[variant],
    sizeClass[size],
    extra,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  loading,
  children,
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={rest.disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-90" />
    </svg>
  );
}

/* ---------------- Form fields ---------------- */

export function Field({
  label,
  name,
  help,
  error,
  children,
  required,
}: {
  label: string;
  name: string;
  help?: string;
  error?: string[] | string;
  children: ReactNode;
  required?: boolean;
}) {
  const err = Array.isArray(error) ? error[0] : error;
  return (
    <div>
      <label htmlFor={name} className="tl-label">
        {label}
        {required && <span className="text-danger-600"> *</span>}
      </label>
      {children}
      {err ? (
        <p className="tl-error" id={`${name}-error`} role="alert">
          {err}
        </p>
      ) : help ? (
        <p className="tl-help" id={`${name}-help`}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, invalid, ...rest }: ComponentProps<"input"> & { invalid?: boolean }) {
  return <input className={cn("tl-input", className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Textarea({ className, invalid, ...rest }: ComponentProps<"textarea"> & { invalid?: boolean }) {
  return <textarea className={cn("tl-input min-h-[120px]", className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({ className, invalid, children, ...rest }: ComponentProps<"select"> & { invalid?: boolean }) {
  return (
    <select className={cn("tl-input", className)} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({ label, className, ...rest }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("flex items-start gap-3 text-sm text-ink-700 cursor-pointer", className)}>
      <input type="checkbox" className="mt-0.5 h-5 w-5 rounded border-ink-300 accent-brand-600" {...rest} />
      <span>{label}</span>
    </label>
  );
}

/* ---------------- Surfaces ---------------- */

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cn("tl-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
      <div>
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, action, eyebrow }: { title: ReactNode; description?: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-teal-600">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-ink-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ---------------- Status indicators (never colour-only) ---------------- */

export type Tone = "neutral" | "brand" | "teal" | "success" | "warning" | "danger" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  brand: "bg-brand-50 text-brand-700",
  teal: "bg-teal-50 text-teal-700",
  success: "bg-success-100 text-success-600",
  warning: "bg-warning-100 text-warning-600",
  danger: "bg-danger-100 text-danger-600",
  info: "bg-info-100 text-info-600",
};

export function Badge({ tone = "neutral", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", toneClass[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Alert({ tone = "info", title, children, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const border: Record<Tone, string> = {
    neutral: "border-ink-200",
    brand: "border-brand-200",
    teal: "border-teal-200",
    success: "border-green-200",
    warning: "border-amber-200",
    danger: "border-red-200",
    info: "border-brand-200",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-[var(--radius-md)] border px-4 py-3 text-sm", toneClass[tone], border[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-1" : ""}>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-ink-200 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-ink-300">{icon}</div>}
      <h3 className="text-base font-semibold text-ink-900">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[var(--radius-sm)] bg-ink-100", className)} aria-hidden="true" />;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="tl-card px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold text-ink-900", tone === "teal" && "text-teal-600", tone === "brand" && "text-brand-600")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function Pagination({ page, pageCount, hrefFor }: { page: number; pageCount: number; hrefFor: (p: number) => string }) {
  if (pageCount <= 1) return null;
  return (
    <nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
      <span className="text-sm text-ink-500">
        Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={buttonClass("outline", "sm")} href={hrefFor(page - 1)} rel="prev">
            Previous
          </Link>
        ) : (
          <span className={buttonClass("outline", "sm", "opacity-50")}>Previous</span>
        )}
        {page < pageCount ? (
          <Link className={buttonClass("outline", "sm")} href={hrefFor(page + 1)} rel="next">
            Next
          </Link>
        ) : (
          <span className={buttonClass("outline", "sm", "opacity-50")}>Next</span>
        )}
      </div>
    </nav>
  );
}

export function Avatar({ name, src, size = 40, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} className={cn("rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700", className)}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.38) }}
    >
      {initials || "?"}
    </span>
  );
}

export function Logo({ size = 36, withWordmark = true, className }: { size?: number; withWordmark?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-512.png" alt="" width={Math.round(size * 1.39)} height={size} style={{ height: size, width: "auto" }} />
      {withWordmark && (
        <span className="font-display text-lg font-bold tracking-tight">
          <span className="text-brand-600">Tutor</span>
          <span className="text-teal-500">Link</span>
        </span>
      )}
    </span>
  );
}

export function StarRating({ value, count, size = 14 }: { value: number; count?: number; size?: number }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className="inline-flex items-center gap-1 text-sm text-ink-700" aria-label={`${value.toFixed(1)} out of 5 stars${count !== undefined ? `, ${count} reviews` : ""}`}>
      <span className="inline-flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <svg key={i} width={size} height={size} viewBox="0 0 20 20" className={i <= rounded ? "fill-amber-400" : "fill-ink-200"}>
            <path d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L10 14.9l-5.3 2.8 1.1-5.9L1.5 7.7l5.9-.8z" />
          </svg>
        ))}
      </span>
      <span className="font-medium">{value > 0 ? value.toFixed(1) : "New"}</span>
      {count !== undefined && count > 0 && <span className="text-ink-400">({count})</span>}
    </span>
  );
}

export function Divider({ label }: { label?: string }) {
  return (
    <div className="my-4 flex items-center gap-3 text-xs text-ink-400">
      <span className="h-px flex-1 bg-ink-100" />
      {label && <span>{label}</span>}
      <span className="h-px flex-1 bg-ink-100" />
    </div>
  );
}
