import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

// Small shared building blocks. Touch targets are at least 56 px (min-h-14), text 18 px or more.

type Variant = "primary" | "secondary" | "outline";

const variantClass: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong",
  secondary: "bg-[#f3ebe8] text-ink hover:bg-brand-soft",
  outline: "border-2 border-brand bg-white text-brand-strong hover:bg-blush",
};

export function buttonClass(variant: Variant = "primary", extra = "") {
  return `inline-flex min-h-14 items-center justify-center gap-2 rounded-xl px-6 text-lg font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-plum disabled:cursor-not-allowed disabled:opacity-50 ${variantClass[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}

export const inputClass =
  "mt-2 block min-h-14 w-full rounded-xl border-2 border-field bg-white px-4 text-lg focus:border-brand focus:outline-none";

export function TextField({
  label,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-base font-semibold">{label}</span>
      <input className={inputClass} {...props} />
    </label>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border-2 border-line bg-white p-6 ${className}`}>{children}</section>;
}

export function Alert({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "warn" | "ok" }) {
  const cls = {
    danger: "bg-red-50 text-danger",
    warn: "bg-amber-50 text-warn",
    ok: "bg-green-50 text-ok",
  }[tone];
  return (
    <p role={tone === "danger" ? "alert" : "status"} className={`rounded-xl px-4 py-3 font-semibold ${cls}`}>
      {children}
    </p>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-base">
      {children}
    </span>
  );
}

export function Check({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-5 w-5 ${className}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function BackArrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export function Lock() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function Warn() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l9.5 17h-19L12 3z" />
      <path d="M12 10v4M12 17.5v.5" />
    </svg>
  );
}

export function Plus() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function Pencil() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    </svg>
  );
}
