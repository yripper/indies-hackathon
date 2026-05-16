import type { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  sublabel,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  tone?: "neutral" | "danger" | "success";
}) {
  const valueColor =
    tone === "danger"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-zinc-900 dark:text-zinc-50";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className={`mt-2 font-mono text-3xl font-semibold tracking-tight ${valueColor}`}>
        {value}
      </div>
      {sublabel && (
        <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{sublabel}</div>
      )}
    </div>
  );
}
