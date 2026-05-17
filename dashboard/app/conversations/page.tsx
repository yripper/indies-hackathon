import Link from "next/link";
import { getConversations, type ConversationsListResponse } from "@/lib/api";
import { formatJid, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

const MOCK_CONVERSATIONS: ConversationsListResponse = {
  conversations: [
    {
      id: "conv-abcd-1234",
      customer_phone: "56912345678@s.whatsapp.net",
      customer_name: "Familia Rodriguez",
      status: "active",
      created_at: "2026-05-10T14:00:00Z",
      updated_at: "2026-05-17T10:15:00Z",
      analyses_total: 34,
      tier_counts: { real: 21, uncertain: 8, fake: 5 },
      first_analysis_at: "2026-05-10T14:05:00Z",
      last_analysis_at: "2026-05-17T10:15:00Z",
    },
    {
      id: "conv-efgh-5678",
      customer_phone: "56987654321@s.whatsapp.net",
      customer_name: "Grupo Abuelos",
      status: "active",
      created_at: "2026-05-12T09:30:00Z",
      updated_at: "2026-05-17T08:30:00Z",
      analyses_total: 18,
      tier_counts: { real: 12, uncertain: 4, fake: 2 },
      first_analysis_at: "2026-05-12T09:35:00Z",
      last_analysis_at: "2026-05-17T08:30:00Z",
    },
    {
      id: "conv-ijkl-9012",
      customer_phone: "56911223344@s.whatsapp.net",
      customer_name: "Mama Marta",
      status: "active",
      created_at: "2026-05-14T16:20:00Z",
      updated_at: "2026-05-17T07:55:00Z",
      analyses_total: 7,
      tier_counts: { real: 5, uncertain: 1, fake: 1 },
      first_analysis_at: "2026-05-14T16:25:00Z",
      last_analysis_at: "2026-05-17T07:55:00Z",
    },
    {
      id: "conv-mnop-3456",
      customer_phone: "56955667788@s.whatsapp.net",
      customer_name: null,
      status: "active",
      created_at: "2026-05-15T11:00:00Z",
      updated_at: "2026-05-17T06:20:00Z",
      analyses_total: 4,
      tier_counts: { real: 1, uncertain: 1, fake: 2 },
      first_analysis_at: "2026-05-15T11:05:00Z",
      last_analysis_at: "2026-05-17T06:20:00Z",
    },
    {
      id: "conv-qrst-7890",
      customer_phone: "120363409150968129@g.us",
      customer_name: "Familia Extendida",
      status: "active",
      created_at: "2026-05-13T08:00:00Z",
      updated_at: "2026-05-16T20:45:00Z",
      analyses_total: 12,
      tier_counts: { real: 8, uncertain: 3, fake: 1 },
      first_analysis_at: "2026-05-13T08:10:00Z",
      last_analysis_at: "2026-05-16T20:45:00Z",
    },
  ],
};

export default async function ConversationsPage() {
  let data: ConversationsListResponse | null = null;
  try {
    data = await getConversations();
  } catch {
    data = MOCK_CONVERSATIONS;
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-6">
          <h2 className="text-base font-semibold text-[#ef4444]">
            No se pudo cargar la lista de conversaciones
          </h2>
          <p className="mt-2 text-sm text-rose-300">
            Verificá que el API esté corriendo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-[#f9fafb]">Conversations</h1>
        <p className="mt-1 text-sm text-[#9ca3af]">
          Familias y grupos conectados al agente. Clic para ver el historial completo.
        </p>
      </header>

      {data.conversations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#1f2937] bg-[#111827] p-12 text-center">
          <p className="text-sm text-[#9ca3af]">
            Sin conversaciones todavía.
          </p>
          <p className="mt-1 text-xs text-[#6b7280]">
            Vincula tu WhatsApp con <code className="font-mono text-[#34d399]">POST /v1/wa/connect</code> y envia un audio para empezar.
          </p>
        </div>
      ) : (
        <ConversationsTable rows={data.conversations} />
      )}
    </div>
  );
}

function ConversationsTable({
  rows,
}: {
  rows: ConversationsListResponse["conversations"];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#1f2937] bg-[#111827]">
      <table className="w-full text-sm">
        <thead className="border-b border-[#1f2937] bg-[#0a0f1a] text-left text-xs font-medium uppercase tracking-wider text-[#6b7280]">
          <tr>
            <th className="px-4 py-3">Familia</th>
            <th className="px-4 py-3">JID</th>
            <th className="px-4 py-3 text-right">Audios</th>
            <th className="px-4 py-3">Veredicto</th>
            <th className="px-4 py-3">Ultima actividad</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1f2937]">
          {rows.map((c) => {
            const total = c.analyses_total;
            return (
              <tr
                key={c.id}
                className="transition hover:bg-[#0a0f1a]"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/conversations/${c.id}`}
                    className="font-medium text-[#f9fafb] hover:text-[#34d399] hover:underline"
                  >
                    {c.customer_name || (
                      <span className="text-[#6b7280] italic">Sin nombre</span>
                    )}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[#9ca3af]">
                  {formatJid(c.customer_phone)}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-[#f9fafb]">
                  {total}
                </td>
                <td className="px-4 py-3">
                  {total === 0 ? (
                    <span className="text-xs text-[#6b7280]">—</span>
                  ) : (
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <PillDot color="emerald" count={c.tier_counts.real} title="real" />
                      <PillDot
                        color="amber"
                        count={c.tier_counts.uncertain}
                        title="zona gris"
                      />
                      <PillDot color="rose" count={c.tier_counts.fake} title="generado por IA" />
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-[#6b7280]">
                  {formatRelative(c.last_analysis_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PillDot({
  color,
  count,
  title,
}: {
  color: "emerald" | "amber" | "rose";
  count: number;
  title: string;
}) {
  const dot =
    color === "emerald"
      ? "bg-[#10b981]"
      : color === "amber"
        ? "bg-[#fbbf24]"
        : "bg-[#ef4444]";
  return (
    <span
      className="inline-flex items-center gap-1 text-[#9ca3af]"
      title={title}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {count}
    </span>
  );
}
