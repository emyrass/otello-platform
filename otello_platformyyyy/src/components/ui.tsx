import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn.ts";
import type { Availability, LeaseStatus } from "../lib/types.ts";

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title === "otello" ? "otello" : `${title} · otello`;
  }, [title]);
}

export function Button({
  variant = "solid",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "line" | "ghost" }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-full px-4 py-2 text-[13px] tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        variant === "solid" && "bg-ink text-ivory hover:bg-ink/85",
        variant === "line" && "border border-ink/20 bg-transparent hover:border-ink",
        variant === "ghost" && "bg-transparent hover:bg-ink/5",
        className,
      )}
      {...props}
    />
  );
}

const fieldClass = "w-full border-b border-ink/20 bg-transparent px-0 py-2 text-[15px] outline-none placeholder:text-mute focus:border-ink";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldClass, props.className)} />;
}

export function NumberInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...props} className={cn(fieldClass, props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldClass, "min-h-24 resize-y", props.className)} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(fieldClass, "cursor-pointer", props.className)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.16em] text-mute">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-char">{hint}</span> : null}
    </label>
  );
}

export function Pill({
  active,
  children,
  onClick,
  disabled,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[12px] tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-35",
        active ? "border-ink bg-ink text-ivory" : "border-ink/15 text-char hover:border-ink/40",
      )}
    >
      {children}
    </button>
  );
}

const STATUS_DOT: Record<LeaseStatus, string> = {
  requested: "bg-ochre",
  approved: "bg-slate",
  active: "bg-moss",
  expired: "bg-mute",
  exhausted: "bg-clay",
  revoked: "bg-wine",
  rejected: "bg-wine",
};

export function StatusMark({ status, label }: { status: LeaseStatus; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em]">
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
      {label}
    </span>
  );
}

const AVAILABILITY_DOT: Record<Availability, string> = {
  available: "bg-moss",
  limited: "bg-ochre",
  unavailable: "bg-mute",
};

export function AvailabilityMark({ availability, label }: { availability: Availability; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em]">
      <span className={cn("h-1.5 w-1.5 rounded-full", AVAILABILITY_DOT[availability])} />
      {label}
    </span>
  );
}

export function PageHeader({ kicker, title, lede }: { kicker: string; title: string; lede: string }) {
  return (
    <header className="grid items-end gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.7fr)] md:gap-12">
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-char">{kicker}</p>
        <h1 className="mt-3 max-w-4xl font-serif text-[clamp(3.1rem,6.4vw,5.7rem)] leading-[0.9] tracking-[-0.04em]">{title}</h1>
      </div>
      <p className="max-w-sm text-[15px] leading-relaxed text-char md:justify-self-end">{lede}</p>
    </header>
  );
}

export function SectionTitle({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="font-serif text-3xl tracking-[-0.03em]">{title}</h2>
      {meta ? <p className="min-w-0 max-w-full break-words text-[11px] uppercase tracking-[0.16em] text-mute">{meta}</p> : null}
    </div>
  );
}

export function FeaturePanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="relative">
      <div aria-hidden className="absolute -left-2 top-7 hidden h-[84%] w-[70%] rounded-[2rem] bg-mist/90 md:block" />
      <div aria-hidden className="absolute left-7 top-2 hidden h-[90%] w-[74%] rounded-[2rem] border border-ink/10 bg-cream/45 md:block" />
      <div className={cn("relative rounded-[1.7rem] border border-ink/10 bg-cream/80 px-6 py-8 md:rounded-[2rem] md:px-12 md:py-11", className)}>
        {children}
      </div>
    </div>
  );
}

export function Meter({ label, value, total }: { label: string; value: number; total: number }) {
  const ratio = total <= 0 ? 0 : Math.min(1, value / total);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 text-[11px] uppercase tracking-[0.14em] text-mute">
        <span>{label}</span>
        <span>{Math.round(ratio * 100)}%</span>
      </div>
      <div className="mt-2 h-px bg-ink/15">
        <div className="h-px bg-ink" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function ErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm text-wine">
      {errors.map((error) => (
        <li key={error}>{error}</li>
      ))}
    </ul>
  );
}
