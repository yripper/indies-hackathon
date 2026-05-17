import type { Tier } from "@/lib/api";

const STYLES: Record<Tier, string> = {
  real: "bg-emerald-500/10 text-[#34d399] ring-emerald-500/20",
  uncertain: "bg-amber-500/10 text-[#fbbf24] ring-amber-500/20",
  fake: "bg-rose-500/10 text-[#ef4444] ring-rose-500/20",
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
