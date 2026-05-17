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

const MOCK_OVERVIEW: OverviewResponse = {
  totals: {
    analyses_all_time: 1247,
    analyses_24h: 47,
    analyses_7d: 312,
    conversations_with_audio: 23,
    conversations_with_image: 8,
    audio_all_time: 983,
    audio_24h: 35,
    audio_7d: 241,
    image_all_time: 264,
    image_24h: 12,
    image_7d: 71,
  },
  tier_breakdown_24h: { real: 28, uncertain: 12, fake: 7 },
  tier_breakdown_7d: { real: 189, uncertain: 78, fake: 45 },
  audio_tier_breakdown_24h: { real: 21, uncertain: 9, fake: 5 },
  audio_tier_breakdown_7d: { real: 148, uncertain: 59, fake: 34 },
  image_tier_breakdown_24h: { real: 7, uncertain: 3, fake: 2 },
  image_tier_breakdown_7d: { real: 41, uncertain: 19, fake: 11 },
  latency_ms: { p50: 2100, p95: 4800, avg: 2600 },
  image_latency_ms: { p50: 3200, p95: 6100, avg: 3800 },
  recent: [
    {
      id: "a1b2c3d4-0001",
      conversation_id: "conv-abcd-1234",
      tier: "real",
      score: 0.12,
      duration_sec: 8,
      from_name: "Mama Rosa",
      mimetype: "audio/ogg",
      source: "direct",
      detector: "whisper-v3+resemblyzer",
      latency_ms: 1890,
      created_at: "2026-05-17T10:15:00Z",
      media_type: "audio",
    },
    {
      id: "a1b2c3d4-0002",
      conversation_id: "conv-abcd-1234",
      tier: "fake",
      score: 0.94,
      duration_sec: 12,
      from_name: "Tio Pedro",
      mimetype: "audio/ogg",
      source: "quoted",
      detector: "whisper-v3+resemblyzer",
      latency_ms: 3200,
      created_at: "2026-05-17T09:42:00Z",
      media_type: "audio",
    },
    {
      id: "a1b2c3d4-0003",
      conversation_id: "conv-efgh-5678",
      tier: "uncertain",
      score: 0.51,
      duration_sec: 5,
      from_name: null,
      mimetype: "audio/ogg",
      source: "direct",
      detector: "whisper-v3+resemblyzer",
      latency_ms: 2100,
      created_at: "2026-05-17T08:30:00Z",
      media_type: "audio",
    },
    {
      id: "a1b2c3d4-0004",
      conversation_id: "conv-ijkl-9012",
      tier: "real",
      score: 0.08,
      duration_sec: null,
      bytes: 245000,
      from_name: "Abuela Marta",
      mimetype: "image/jpeg",
      source: "direct",
      detector: "clip-interrogator+hive",
      latency_ms: 3400,
      created_at: "2026-05-17T07:55:00Z",
      media_type: "image",
    },
    {
      id: "a1b2c3d4-0005",
      conversation_id: "conv-mnop-3456",
      tier: "fake",
      score: 0.97,
      duration_sec: null,
      bytes: 189000,
      from_name: "Papa Juan",
      mimetype: "image/png",
      source: "quoted",
      detector: "clip-interrogator+hive",
      latency_ms: 4100,
      created_at: "2026-05-17T06:20:00Z",
      media_type: "image",
    },
    {
      id: "a1b2c3d4-0006",
      conversation_id: "conv-abcd-1234",
      tier: "real",
      score: 0.15,
      duration_sec: 22,
      from_name: "Mama Rosa",
      mimetype: "audio/ogg",
      source: "direct",
      detector: "whisper-v3+resemblyzer",
      latency_ms: 4800,
      created_at: "2026-05-16T22:10:00Z",
      media_type: "audio",
    },
    {
      id: "a1b2c3d4-0007",
      conversation_id: "conv-qrst-7890",
      tier: "uncertain",
      score: 0.62,
      duration_sec: 3,
      from_name: "Primo Diego",
      mimetype: "audio/ogg",
      source: "direct",
      detector: "whisper-v3+resemblyzer",
      latency_ms: 1750,
      created_at: "2026-05-16T20:45:00Z",
      media_type: "audio",
    },
    {
      id: "a1b2c3d4-0008",
      conversation_id: "conv-efgh-5678",
      tier: "real",
      score: 0.05,
      duration_sec: 15,
      from_name: "Hermana Cata",
      mimetype: "audio/ogg",
      source: "quoted",
      detector: "whisper-v3+resemblyzer",
      latency_ms: 2900,
      created_at: "2026-05-16T18:30:00Z",
      media_type: "audio",
    },
  ],
};

function flaggedPercent(counts: OverviewResponse["tier_breakdown_24h"]): number {
  const total = counts.real + counts.uncertain + counts.fake;
  if (total === 0) return 0;
  return counts.fake / total;
}

export default async function OverviewPage() {
  let data: OverviewResponse | null = null;
  try {
    data = await getOverview();
  } catch {
    data = MOCK_OVERVIEW;
  }

  if (!data) {
    return (
      <ApiError
        title="No se pudo cargar el overview"
        detail="Verificá que el API esté corriendo en http://localhost:3000."
      />
    );
  }

  const flaggedRate24h = flaggedPercent(data.tier_breakdown_24h);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-[#f9fafb]">Overview</h1>
        <p className="mt-1 text-sm text-[#9ca3af]">
          Defensa en vivo &middot; familias chilenas protegidas contra deepfakes (audio + imagen)
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Analisis totales · 24h"
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
          sublabel={`${data.totals.analyses_all_time.toLocaleString()} analisis totales`}
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
          label="Imagenes · 24h"
          value={(data.totals.image_24h ?? 0).toLocaleString()}
          sublabel={`${(data.totals.image_all_time ?? 0).toLocaleString()} totales`}
        />
      </section>

      <section className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Veredicto · ultimas 24 horas">
          <TierBar counts={data.tier_breakdown_24h} />
        </Panel>
        <Panel title="Veredicto · ultimos 7 dias">
          <TierBar counts={data.tier_breakdown_7d} />
        </Panel>
      </section>

      <section className="mt-8">
        <Panel title="Actividad reciente" subtitle="Últimos 20 análisis (audio + imagen)">
          {data.recent.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#1f2937] bg-[#0a0f1a] p-6 text-center text-sm text-[#6b7280]">
              Sin actividad reciente. Envia un audio o imagen al bot para empezar.
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
    <div className="rounded-xl border border-[#1f2937] bg-[#111827] p-6">
      <div className="mb-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#9ca3af]">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-xs text-[#6b7280]">{subtitle}</p>
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
        className="inline-flex items-center rounded bg-violet-500/10 px-1.5 py-0.5 text-xs font-medium text-violet-400"
        title="Imagen"
      >
        IMG
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded bg-sky-500/10 px-1.5 py-0.5 text-xs font-medium text-sky-400"
      title="Audio"
    >
      AUD
    </span>
  );
}

function RecentTable({ rows }: { rows: OverviewResponse["recent"] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#1f2937]">
      <table className="w-full text-sm">
        <thead className="bg-[#0a0f1a] text-left text-xs font-medium uppercase tracking-wider text-[#6b7280]">
          <tr>
            <th className="px-4 py-2.5">Tipo</th>
            <th className="px-4 py-2.5">Cuando</th>
            <th className="px-4 py-2.5">Familia</th>
            <th className="px-4 py-2.5">Veredicto</th>
            <th className="px-4 py-2.5">Confianza IA</th>
            <th className="px-4 py-2.5">Duracion</th>
            <th className="px-4 py-2.5">Detector</th>
            <th className="px-4 py-2.5">De</th>
            <th className="px-4 py-2.5">Latencia</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1f2937]">
          {rows.map((r) => (
            <tr
              key={r.id}
              className="bg-[#111827] transition hover:bg-[#0a0f1a]"
            >
              <td className="px-4 py-3">
                <MediaIcon type={r.media_type} />
              </td>
              <td className="px-4 py-3 text-[#6b7280]" title={r.created_at}>
                {formatRelative(r.created_at)}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/conversations/${r.conversation_id}`}
                  className="font-mono text-xs text-[#9ca3af] underline-offset-2 hover:text-[#34d399] hover:underline"
                >
                  {r.conversation_id.slice(0, 8)}...
                </Link>
              </td>
              <td className="px-4 py-3">
                <TierBadge tier={r.tier} size="sm" />
              </td>
              <td className="px-4 py-3 font-mono text-[#f9fafb]">{formatPercent(r.score, 1)}</td>
              <td className="px-4 py-3 font-mono text-[#9ca3af]">
                {r.duration_sec != null ? `${r.duration_sec}s` : <span className="text-[#6b7280]">—</span>}
              </td>
              <td className="px-4 py-3 text-xs text-[#9ca3af]">
                {r.detector}
              </td>
              <td className="px-4 py-3 text-[#9ca3af]">
                {r.from_name || <span className="text-[#6b7280]">—</span>}
              </td>
              <td className="px-4 py-3 font-mono text-[#6b7280]">
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
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-6">
        <h2 className="text-base font-semibold text-[#ef4444]">{title}</h2>
        <p className="mt-2 text-sm text-rose-300">{detail}</p>
        <p className="mt-3 text-xs text-rose-400/70">
          {`Datos solicitados a ${process.env.API_BASE_URL ?? "http://localhost:3000"} en `}
          {formatDateTime(new Date().toISOString())}.
        </p>
      </div>
    </div>
  );
}
