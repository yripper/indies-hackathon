import Link from "next/link";
import { getConversations, type ConversationsListResponse } from "@/lib/api";
import { formatJid, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
  let data: ConversationsListResponse | null = null;
  let error: string | null = null;
  try {
    data = await getConversations();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-900/40 dark:bg-rose-950/30">
          <h2 className="text-base font-semibold text-rose-900 dark:text-rose-200">
            No se pudo cargar la lista de conversaciones
          </h2>
          <p className="mt-2 text-sm text-rose-800 dark:text-rose-300">
            {error ?? "Verificá que el API esté corriendo."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Conversations</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Familias y grupos conectados al agente. Clic para ver el historial completo.
        </p>
      </header>

      {data.conversations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Sin conversaciones todavía.
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Vinculá tu WhatsApp con <code>POST /v1/wa/connect</code> y enviá un audio para empezar.
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
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          <tr>
            <th className="px-4 py-3">Familia</th>
            <th className="px-4 py-3">JID</th>
            <th className="px-4 py-3 text-right">Audios</th>
            <th className="px-4 py-3">Veredicto</th>
            <th className="px-4 py-3">Última actividad</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((c) => {
            const total = c.analyses_total;
            return (
              <tr
                key={c.id}
                className="transition hover:bg-zinc-50 dark:hover:bg-zinc-950"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/conversations/${c.id}`}
                    className="font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                  >
                    {c.customer_name || (
                      <span className="text-zinc-400 italic">Sin nombre</span>
                    )}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                  {formatJid(c.customer_phone)}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold">
                  {total}
                </td>
                <td className="px-4 py-3">
                  {total === 0 ? (
                    <span className="text-xs text-zinc-400">—</span>
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
                <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
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
      ? "bg-emerald-500 dark:bg-emerald-400"
      : color === "amber"
        ? "bg-amber-400 dark:bg-amber-300"
        : "bg-rose-500 dark:bg-rose-400";
  return (
    <span
      className="inline-flex items-center gap-1 text-zinc-700 dark:text-zinc-300"
      title={title}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {count}
    </span>
  );
}
