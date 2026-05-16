import type { ModelScore } from "@/lib/api";

// Renders per-detector model scores as a horizontal chip strip. Each chip
// shows the model name + its individual confidence. "ANALYZING" models that
// didn't finish in time render with an em-dash and muted color.
export function ModelChips({ models }: { models: ModelScore[] | null }) {
  if (!models || models.length === 0) {
    return <span className="text-xs text-zinc-500">no model data</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {models.map((m) => {
        const isFake = m.score != null && m.score >= 0.8;
        const isReal = m.score != null && m.score < 0.4;
        const tone = isFake
          ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
          : isReal
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
            : m.score != null
              ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              : "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";
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
