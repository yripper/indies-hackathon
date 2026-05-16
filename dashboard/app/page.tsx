import Link from "next/link";
import { getOverview, type OverviewResponse } from "@/lib/api";
import { KpiCard } from "@/components/kpi-card";
import { TierBar } from "@/components/tier-bar";
import { TierBadge } from "@/components/tier-badge";
import {
  formatDateTime,
  formatJid,
  formatLatency,
  formatPercent,
  formatRelative,
} from "@/lib/format";

export const dynamic = "force-dynamic";

function flaggedPercent(counts: OverviewResponse["tier_breakdown_24h"]): number {
  const total = counts.real + counts.uncertain + counts.fake;
  if (total === 0) return 0;
  return counts.fake / total;
}

export default async function OverviewPage() {
  let data: OverviewResponse | null = null;
  let error: string | null = null;
  try {
    data = await getOverview();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (!data) {
    return (
      <ApiError
        title="No se pudo cargar el overview"
        detail={error ?? "Verificá que el API esté corriendo en http://localhost:3000."}
      />
    );
  }

  const flaggedRate24h = flaggedPercent(data.tier_breakdown_24h);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Defensa en vivo &middot; familias chilenas protegidas contra deepfakes (audio + imagen)
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Análisis totales · 24h"
          value={data.totals.analyses_24h.toLocaleString()}
          sublabel={`${data.totals.analyses_7d.toLocaleString()} en los últimos 7 días`}
        />
        <KpiCard
          label="% flagged · 24h"
          value={formatPercent(flaggedRate24h)}
          tone={flaggedRate24h >= 0.3 ? "danger" : "neutral"}
          sublabel={`${data.tier_breakdown_24h.fake} marcados como generados por IA`}
        />
        <KpiCard
          label="Familias protegidas"
          value={data.totals.conversations_with_audio.toLocaleString()}
          sublabel={`${data.totals.analyses_all_time.toLocaleString()} análisis totales`}
        />
        <KpiCard
          label="Latencia detector"
          value={formatLatency(data.latency_ms.p50)}
          sublabel={`p95 ${formatLatency(data.latency_ms.p95)} · avg ${formatLatency(data.latency_ms.avg)}`}
        />
      </section>

      {/* Per-media-type breakdown cards */}
      <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Audios · 24h"
          value={(data.totals.audio_24h ?? 0).toLocaleString()}
          sublabel={`${(data.totals.audio_all_time ?? 0).toLocaleString()} totales`}
        />
        <KpiCard
          label="Imágenes · 24h"
          value={(data.totals.image_24h ?? 0).toLocaleString()}
          sublabel={`${(data.totals.image_all_time ?? 0).toLocaleString()} totales`}
        />
      </section>

      <section className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Veredicto · últimas 24 horas">
          <TierBar counts={data.tier_breakdown_24h} />
        </Panel>
        <Panel title="Veredicto · últimos 7 días">
          <TierBar counts={data.tier_breakdown_7d} />
        </Panel>
      </section>

      <section className="mt-8">
        <Panel title="Actividad reciente" subtitle="Últimos 20 análisis (audio + imagen)">
          {data.recent.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
              Sin actividad reciente. Enviá un audio o imagen al bot para empezar.
            </div>
          ) : (
            <RecentTable rows={data.recent} />
          )}
        </Panel>
      </section>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function MediaIcon({ type }: { type?: "audio" | "image" }) {
  if (type === "image") {
    return (
      <span
        className="inline-flex items-center rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
        title="Imagen"
      >
        IMG
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
      title="Audio"
    >
      AUD
    </span>
  );
}

function RecentTable({ rows }: { rows: OverviewResponse["recent"] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
          <tr>
            <th className="px-4 py-2.5">Tipo</th>
            <th className="px-4 py-2.5">Cuándo</th>
            <th className="px-4 py-2.5">Familia</th>
            <th className="px-4 py-2.5">Veredicto</th>
            <th className="px-4 py-2.5">Confianza IA</th>
            <th className="px-4 py-2.5">Duración</th>
            <th className="px-4 py-2.5">Detector</th>
            <th className="px-4 py-2.5">De</th>
            <th className="px-4 py-2.5">Latencia</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr
              key={r.id}
              className="bg-white transition hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-950"
            >
              <td className="px-4 py-3">
                <MediaIcon type={r.media_type} />
              </td>
              <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400" title={r.created_at}>
                {formatRelative(r.created_at)}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/conversations/${r.conversation_id}`}
                  className="font-mono text-xs text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200"
                >
                  {r.conversation_id.slice(0, 8)}…
                </Link>
              </td>
              <td className="px-4 py-3">
                <TierBadge tier={r.tier} size="sm" />
              </td>
              <td className="px-4 py-3 font-mono">{formatPercent(r.score, 1)}</td>
              <td className="px-4 py-3 font-mono text-zinc-600 dark:text-zinc-300">
                {r.duration_sec != null ? `${r.duration_sec}s` : <span className="text-zinc-400">—</span>}
              </td>
              <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300">
                {r.detector}
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                {r.from_name || <span className="text-zinc-400">—</span>}
              </td>
              <td className="px-4 py-3 font-mono text-zinc-500 dark:text-zinc-400">
                {formatLatency(r.latency_ms)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApiError({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-900/40 dark:bg-rose-950/30">
        <h2 className="text-base font-semibold text-rose-900 dark:text-rose-200">{title}</h2>
        <p className="mt-2 text-sm text-rose-800 dark:text-rose-300">{detail}</p>
        <p className="mt-3 text-xs text-rose-700/70 dark:text-rose-400/70">
          {`Datos solicitados a ${process.env.API_BASE_URL ?? "http://localhost:3000"} en `}
          {formatDateTime(new Date().toISOString())}.
        </p>
      </div>
    </div>
  );
}
