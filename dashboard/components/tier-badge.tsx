import type { Tier } from "@/lib/api";

const STYLES: Record<Tier, string> = {
  real: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/30",
  uncertain:
    "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-400/30",
  fake: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-400/30",
};

const LABELS: Record<Tier, string> = {
  real: "Real",
  uncertain: "Zona gris",
  fake: "Generado por IA",
};

export function TierBadge({ tier, size = "md" }: { tier: Tier; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm";
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ring-1 ring-inset ${STYLES[tier]} ${sizeClass}`}
    >
      {LABELS[tier]}
    </span>
  );
}
