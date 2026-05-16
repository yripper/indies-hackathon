import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getConversation,
  type ConversationDetailResponse,
  type MediaType,
} from "@/lib/api";
import { KpiCard } from "@/components/kpi-card";
import { TierBar } from "@/components/tier-bar";
import { TierBadge } from "@/components/tier-badge";
import { MediaTypeBadge } from "@/components/media-type-badge";
import { ModelChips } from "@/components/model-chips";
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatJid,
  formatLatency,
  formatPercent,
  formatRelative,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let data: ConversationDetailResponse | null = null;
  let error: string | null = null;

  try {
    data = await getConversation(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("404")) notFound();
    error = message;
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-900/40 dark:bg-rose-950/30">
          <h2 className="text-base font-semibold text-rose-900 dark:text-rose-200">
            No se pudo cargar la conversación
          </h2>
          <p className="mt-2 text-sm text-rose-800 dark:text-rose-300">{error}</p>
        </div>
      </div>
    );
  }

  const { conversation, stats, analyses } = data;
  const isGroup = conversation.customer_phone.endsWith("@g.us");

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">
      <Link
        href="/conversations"
        className="text-xs text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        ← Conversaciones
      </Link>

      <header className="mt-3 mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              {conversation.customer_name || (
                <span className="text-zinc-400 italic">Sin nombre</span>
              )}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                isGroup
                  ? "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-400/30"
                  : "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-400/30"
              }`}
            >
              {isGroup ? "Grupo" : "DM"}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {formatJid(conversation.customer_phone)}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            Creada {formatRelative(conversation.created_at)} · estado {conversation.status}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Archivos analizados"
          value={stats.analyses_total.toLocaleString()}
          sublabel={
            stats.first_analysis_at
              ? `Primero ${formatRelative(stats.first_analysis_at)}`
              : "—"
          }
        />
        <KpiCard
          label="Generados por IA"
          value={stats.tier_counts.fake.toLocaleString()}
          tone={stats.tier_counts.fake > 0 ? "danger" : "neutral"}
          sublabel={
            stats.analyses_total > 0
              ? `${formatPercent(stats.tier_counts.fake / stats.analyses_total)} del total`
              : "—"
          }
        />
        <KpiCard
          label="Reales"
          value={stats.tier_counts.real.toLocaleString()}
          tone={stats.tier_counts.real > 0 ? "success" : "neutral"}
          sublabel={`${stats.tier_counts.uncertain} en zona gris`}
        />
        <KpiCard
          label="Latencia promedio"
          value={formatLatency(stats.avg_latency_ms)}
          sublabel={
            stats.last_analysis_at
              ? `Último ${formatRelative(stats.last_analysis_at)}`
              : "—"
          }
        />
      </section>

      <section className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-5 text-sm font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
            Distribución de veredictos
          </h2>
          <TierBar counts={stats.tier_counts} />
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-5 text-sm font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
            Distribución por tipo de media
          </h2>
          <MediaTypeCountList counts={stats.media_type_counts} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
          Historial de análisis
        </h2>
        {analyses.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
            Esta familia todavía no envió ningún archivo para analizar.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {analyses.map((a) => (
              <AnalysisCard key={a.id} analysis={a} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MediaTypeCountList({
  counts,
}: {
  counts: ConversationDetailResponse["stats"]["media_type_counts"];
}) {
  const items: Array<{ kind: MediaType; label: string }> = [
    { kind: "audio", label: "Audios" },
    { kind: "image", label: "Imágenes" },
    { kind: "video", label: "Videos" },
    { kind: "document", label: "Documentos" },
  ];
  const total = items.reduce((acc, it) => acc + counts[it.kind], 0);
  if (total === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Sin análisis aún.</p>
    );
  }
  return (
    <dl className="grid grid-cols-2 gap-3">
      {items.map((it) => (
        <div
          key={it.kind}
          className="flex items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="flex items-center gap-2">
            <MediaTypeBadge type={it.kind} />
          </div>
          <span className="font-mono text-sm font-semibold tabular-nums">
            {counts[it.kind]}
          </span>
        </div>
      ))}
    </dl>
  );
}

function AnalysisCard({
  analysis,
}: {
  analysis: ConversationDetailResponse["analyses"][number];
}) {
  const showDuration = analysis.media_type === "audio" || analysis.media_type === "video";
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:shadow dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <MediaTypeBadge type={analysis.media_type} size="md" />
          <TierBadge tier={analysis.tier} />
          <div className="font-mono text-2xl font-bold tracking-tight">
            {formatPercent(analysis.score, 1)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-500 dark:text-zinc-400" title={analysis.created_at}>
            {formatRelative(analysis.created_at)}
          </div>
          <div className="font-mono text-[10px] text-zinc-400">
            {analysis.raw_status}
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        {showDuration && (
          <Detail label="Duración" value={formatDuration(analysis.duration_sec)} />
        )}
        {analysis.file_name && (
          <Detail label="Archivo" value={analysis.file_name} mono />
        )}
        <Detail label="Tamaño" value={formatBytes(analysis.bytes)} />
        <Detail label="Origen" value={analysis.source === "direct" ? "Reenvío" : "Reply-tag"} />
        <Detail label="De" value={analysis.from_name || "—"} />
        <Detail label="Detector" value={analysis.detector} />
        <Detail label="Latencia" value={formatLatency(analysis.latency_ms)} />
        <Detail label="Mimetype" value={analysis.mimetype} mono />
        <Detail
          label="Analizado"
          value={formatDateTime(analysis.created_at)}
        />
      </dl>

      {analysis.model_scores && analysis.model_scores.length > 0 && (
        <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Per-model breakdown
          </div>
          <ModelChips models={analysis.model_scores} />
        </div>
      )}
    </article>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-zinc-900 dark:text-zinc-100 ${mono ? "font-mono text-[11px]" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
