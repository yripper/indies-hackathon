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
      ? "text-[#ef4444]"
      : tone === "success"
        ? "text-[#10b981]"
        : "text-[#f9fafb]";

  return (
    <div className="rounded-xl border border-[#1f2937] bg-[#111827] p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-[#6b7280]">
        {label}
      </div>
      <div className={`mt-2 font-mono text-3xl font-semibold tracking-tight ${valueColor}`}>
        {value}
      </div>
      {sublabel && (
        <div className="mt-1.5 text-xs text-[#9ca3af]">{sublabel}</div>
      )}
    </div>
  );
}
