import Link from "next/link";
import { notFound } from "next/navigation";
import { getConversation, type ConversationDetailResponse } from "@/lib/api";
import { KpiCard } from "@/components/kpi-card";
import { TierBar } from "@/components/tier-bar";
import { TierBadge } from "@/components/tier-badge";
import { ModelChips } from "@/components/model-chips";
import {
  formatBytes,
  formatDateTime,
  formatJid,
  formatLatency,
  formatPercent,
  formatRelative,
} from "@/lib/format";

export const dynamic = "force-dynamic";

const MOCK_CONVERSATION: ConversationDetailResponse = {
  conversation: {
    id: "conv-abcd-1234",
    customer_phone: "56912345678@s.whatsapp.net",
    customer_name: "Familia Rodriguez",
    status: "active",
    created_at: "2026-05-10T14:00:00Z",
    updated_at: "2026-05-17T10:15:00Z",
  },
  stats: {
    analyses_total: 34,
    tier_counts: { real: 21, uncertain: 8, fake: 5 },
    first_analysis_at: "2026-05-10T14:05:00Z",
    last_analysis_at: "2026-05-17T10:15:00Z",
    avg_latency_ms: 2450,
  },
  analyses: [
    {
      id: "analysis-001",
      tier: "real",
      score: 0.12,
      raw_status: "completed",
      duration_sec: 8,
      bytes: 64000,
      mimetype: "audio/ogg",
      source: "direct",
      from_name: "Mama Rosa",
      detector: "whisper-v3+resemblyzer",
      model_scores: [
        { name: "resemblyzer", status: "completed", score: 0.08 },
        { name: "wavlm-tdnn", status: "completed", score: 0.15 },
      ],
      latency_ms: 1890,
      agent_run_id: null,
      created_at: "2026-05-17T10:15:00Z",
      media_type: "audio",
    },
    {
      id: "analysis-002",
      tier: "fake",
      score: 0.94,
      raw_status: "completed",
      duration_sec: 12,
      bytes: 96000,
      mimetype: "audio/ogg",
      source: "quoted",
      from_name: "Tio Pedro",
      detector: "whisper-v3+resemblyzer",
      model_scores: [
        { name: "resemblyzer", status: "completed", score: 0.91 },
        { name: "wavlm-tdnn", status: "completed", score: 0.97 },
      ],
      latency_ms: 3200,
      agent_run_id: null,
      created_at: "2026-05-17T09:42:00Z",
      media_type: "audio",
    },
    {
      id: "analysis-003",
      tier: "uncertain",
      score: 0.51,
      raw_status: "completed",
      duration_sec: 5,
      bytes: 40000,
      mimetype: "audio/ogg",
      source: "direct",
      from_name: null,
      detector: "whisper-v3+resemblyzer",
      model_scores: [
        { name: "resemblyzer", status: "completed", score: 0.48 },
        { name: "wavlm-tdnn", status: "completed", score: 0.54 },
      ],
      latency_ms: 2100,
      agent_run_id: null,
      created_at: "2026-05-16T22:10:00Z",
      media_type: "audio",
    },
    {
      id: "analysis-004",
      tier: "real",
      score: 0.08,
      raw_status: "completed",
      duration_sec: null,
      bytes: 245000,
      mimetype: "image/jpeg",
      source: "direct",
      from_name: "Abuela Marta",
      detector: "clip-interrogator+hive",
      model_scores: [
        { name: "hive-moderation", status: "completed", score: 0.05 },
        { name: "clip-interrogator", status: "completed", score: 0.11 },
      ],
      latency_ms: 3400,
      agent_run_id: null,
      created_at: "2026-05-16T18:30:00Z",
      media_type: "image",
    },
  ],
};

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let data: ConversationDetailResponse | null = null;

  try {
    data = await getConversation(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("404")) notFound();
    // Fallback to mock data for demo
    data = MOCK_CONVERSATION;
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-6">
          <h2 className="text-base font-semibold text-[#ef4444]">
            No se pudo cargar la conversación
          </h2>
          <p className="mt-2 text-sm text-rose-300">Error desconocido.</p>
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
        className="text-xs text-[#6b7280] transition hover:text-[#34d399]"
      >
        ← Conversaciones
      </Link>

      <header className="mt-3 mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-[#f9fafb]">
              {conversation.customer_name || (
                <span className="text-[#6b7280] italic">Sin nombre</span>
              )}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                isGroup
                  ? "bg-violet-500/10 text-violet-400 ring-violet-500/20"
                  : "bg-sky-500/10 text-sky-400 ring-sky-500/20"
              }`}
            >
              {isGroup ? "Grupo" : "DM"}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-[#6b7280]">
            {formatJid(conversation.customer_phone)}
          </p>
          <p className="mt-0.5 text-xs text-[#6b7280]">
            Creada {formatRelative(conversation.created_at)} · estado {conversation.status}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Audios analizados"
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
              ? `Ultimo ${formatRelative(stats.last_analysis_at)}`
              : "—"
          }
        />
      </section>

      <section className="mt-8 rounded-xl border border-[#1f2937] bg-[#111827] p-6">
        <h2 className="mb-5 text-sm font-semibold uppercase tracking-wider text-[#9ca3af]">
          Distribucion de veredictos
        </h2>
        <TierBar counts={stats.tier_counts} />
      </section>

      <section className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#9ca3af]">
          Historial de analisis
        </h2>
        {analyses.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#1f2937] bg-[#111827] p-8 text-center text-sm text-[#6b7280]">
            Esta familia todavía no envió ningún audio para analizar.
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

function AnalysisCard({
  analysis,
}: {
  analysis: ConversationDetailResponse["analyses"][number];
}) {
  return (
    <article className="rounded-xl border border-[#1f2937] bg-[#111827] p-5 transition hover:border-[#34d399]/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <TierBadge tier={analysis.tier} />
          <div className="font-mono text-2xl font-bold tracking-tight text-[#f9fafb]">
            {formatPercent(analysis.score, 1)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-[#6b7280]" title={analysis.created_at}>
            {formatRelative(analysis.created_at)}
          </div>
          <div className="font-mono text-[10px] text-[#6b7280]">
            {analysis.raw_status}
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <Detail label="Duracion" value={analysis.duration_sec != null ? `${analysis.duration_sec}s` : "—"} />
        <Detail label="Tamano" value={formatBytes(analysis.bytes)} />
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
        <div className="mt-4 border-t border-[#1f2937] pt-4">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[#6b7280]">
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
      <dt className="text-[10px] uppercase tracking-wider text-[#6b7280]">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-[#9ca3af] ${mono ? "font-mono text-[11px]" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
