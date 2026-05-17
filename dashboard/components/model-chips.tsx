import type { ModelScore } from "@/lib/api";

// Renders per-detector model scores as a horizontal chip strip. Each chip
// shows the model name + its individual confidence. "ANALYZING" models that
// didn't finish in time render with an em-dash and muted color.
export function ModelChips({ models }: { models: ModelScore[] | null }) {
  if (!models || models.length === 0) {
    return <span className="text-xs text-[#6b7280]">no model data</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {models.map((m) => {
        const isFake = m.score != null && m.score >= 0.8;
        const isReal = m.score != null && m.score < 0.4;
        const tone = isFake
          ? "border-rose-500/20 bg-rose-500/10 text-[#ef4444]"
          : isReal
            ? "border-emerald-500/20 bg-emerald-500/10 text-[#34d399]"
            : m.score != null
              ? "border-amber-500/20 bg-amber-500/10 text-[#fbbf24]"
              : "border-[#1f2937] bg-[#0a0f1a] text-[#6b7280]";
        const score = m.score == null ? "—" : `${Math.round(m.score * 100)}%`;
        return (
          <span
            key={m.name}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] ${tone}`}
            title={`${m.name} · ${m.status}`}
          >
            <span className="font-medium">{m.name.replace(/^rd-/, "").replace(/-aud$/, "")}</span>
            <span className="font-bold">{score}</span>
          </span>
        );
      })}
    </div>
  );
}
