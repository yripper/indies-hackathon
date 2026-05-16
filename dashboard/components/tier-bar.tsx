import type { TierCounts } from "@/lib/api";

// Horizontal stacked bar showing tier distribution. Renders as three colored
// segments proportional to the counts. Used on the overview + conversation
// detail pages.
export function TierBar({
  counts,
  showLegend = true,
}: {
  counts: TierCounts;
  showLegend?: boolean;
}) {
  const total = counts.real + counts.uncertain + counts.fake;
  const safe = total === 0 ? 1 : total;

  const segments = [
    {
      key: "fake" as const,
      count: counts.fake,
      pct: (counts.fake / safe) * 100,
      bar: "bg-rose-500 dark:bg-rose-400",
      dot: "bg-rose-500 dark:bg-rose-400",
      label: "Generado por IA",
    },
    {
      key: "uncertain" as const,
      count: counts.uncertain,
      pct: (counts.uncertain / safe) * 100,
      bar: "bg-amber-400 dark:bg-amber-300",
      dot: "bg-amber-400 dark:bg-amber-300",
      label: "Zona gris",
    },
    {
      key: "real" as const,
      count: counts.real,
      pct: (counts.real / safe) * 100,
      bar: "bg-emerald-500 dark:bg-emerald-400",
      dot: "bg-emerald-500 dark:bg-emerald-400",
      label: "Real",
    },
  ];

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        {total === 0 ? null : (
          <>
            {segments.map((s) =>
              s.count === 0 ? null : (
                <div
                  key={s.key}
                  className={`h-full ${s.bar}`}
                  style={{ width: `${s.pct}%` }}
                  title={`${s.label}: ${s.count}`}
                />
              ),
            )}
          </>
        )}
      </div>
      {showLegend && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          {segments.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${s.dot}`} />
              <span className="text-zinc-600 dark:text-zinc-300">{s.label}</span>
              <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">
                {s.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
