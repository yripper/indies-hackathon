'use client';

import { useState } from 'react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const MOCK_CASES = [
  { id: '1', tier: 'fake', mediaType: 'video', country: 'México', summary: 'Video manipulado de candidato político mostrando declaraciones falsas que nunca hizo. El audio fue reemplazado usando tecnología deepfake para hacer creer que apoya cierta ideología.', keywords: ['política', 'deepfake', 'elecciones', 'audio falso'], score: 0.92, created_at: '2026-05-17T02:30:00Z', sources: ['https://factcheck.org/mexico/2026/05/16', 'https://verificacion.mx/noticia-123'] },
  { id: '2', tier: 'uncertain', mediaType: 'audio', country: 'Colombia', summary: 'Audio deepfake de periodista conocido difundiendo noticias falsas sobre supuesto escándalo gubernal. La voz suena muy similar pero hay inconsistencias en el ritmo del habla.', keywords: ['audio', 'periodismo', 'manipulación', 'voz falsa'], score: 0.67, created_at: '2026-05-17T00:15:00Z', sources: ['https://lfpp.org.co/2026/05/17'] },
  { id: '3', tier: 'real', mediaType: 'image', country: 'Chile', summary: 'Imagen verificada de evento real con metadata válida y fuentes confiables. La foto fue tomada por periodista acreditado durante manifestación en Santiago.', keywords: ['verificado', 'evento real', 'manifestación'], score: 0.95, created_at: '2026-05-16T18:00:00Z', sources: ['https://elmostrador.cl/2026/05/16'] },
  { id: '4', tier: 'fake', mediaType: 'image', country: 'Argentina', summary: 'Fotografía antigua de 2019 presentada fraudulentamente como actual para desinformar sobre протесты recientes. Se verificó la fecha original mediante EXIF y fuentes archivísticas.', keywords: ['imagen', 'desinformación', 'manipulación', 'foto antigua'], score: 0.88, created_at: '2026-05-16T14:30:00Z', sources: [] },
  { id: '5', tier: 'fake', mediaType: 'video', country: 'Brasil', summary: 'Video con audio reemplazado para hacer creer que funcionario dijo algo que nunca dijo durante conferencia de prensa. Se comparó con el video original.', keywords: ['video', 'audio fake', 'política', 'conferencia'], score: 0.91, created_at: '2026-05-16T10:00:00Z', sources: ['https://aosfato.org/verificacao/2026/05/16'] },
  { id: '6', tier: 'uncertain', mediaType: 'text', country: 'Perú', summary: 'Captura de pantalla editada de noticia real con contexto diferente agregado. El titular original fue modificado para cambiar el significado.', keywords: ['texto', 'manipulación', 'contexto', 'captura editada'], score: 0.55, created_at: '2026-05-16T08:45:00Z', sources: ['https://verificador.larepublica.pe/2026/05/16'] },
  { id: '7', tier: 'fake', mediaType: 'image', country: 'Venezuela', summary: 'Imagen generada por IA mostrando evento que nunca ocurrió. Se detectaron inconsistencias en las manos y fondos de la imagen.', keywords: ['IA', 'generada', 'evento falso', 'deepfake'], score: 0.94, created_at: '2026-05-15T22:00:00Z', sources: [] },
  { id: '8', tier: 'real', mediaType: 'audio', country: 'Ecuador', summary: 'Audio original de rueda de prensaverificado mediante análisis forense. No se detectó manipulación en la señal de audio.', keywords: ['verificado', 'rueda de prensa', 'audio original'], score: 0.98, created_at: '2026-05-15T16:30:00Z', sources: ['https://eltelegrafo.com.ec/2026/05/15'] },
  { id: '9', tier: 'uncertain', mediaType: 'video', country: 'Guatemala', summary: 'Video con posible edición menor pero contexto general verificado. Los cambios no alteran el mensaje fundamental del video.', keywords: ['video', 'edición menor', 'contexto verificado'], score: 0.62, created_at: '2026-05-15T12:00:00Z', sources: [] },
];

function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
      tier === 'fake' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
      tier === 'uncertain' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
      'bg-green-500/20 text-green-400 border border-green-500/30'
    }`}>
      {tier}
    </span>
  );
}

function MediaIcon({ type }: { type: string }) {
  if (type === 'video') return <span className="text-rose-400">🎬</span>;
  if (type === 'audio') return <span className="text-emerald-400">🎙️</span>;
  if (type === 'image') return <span className="text-violet-400">🖼️</span>;
  return <span className="text-[#9ca3af]">📄</span>;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CasesPage() {
  const [tierFilter, setTierFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  const filtered = MOCK_CASES.filter(c => {
    if (tierFilter && c.tier !== tierFilter) return false;
    if (typeFilter && c.mediaType !== typeFilter) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#030712]">
      <header className="border-b border-[#1f2937] backdrop-blur-sm bg-[#030712]/80">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <Link href="/public" className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <span className="text-xl font-bold text-white">V</span>
            </div>
            <span className="text-xl font-bold text-[#f9fafb] tracking-tight">VERITAS</span>
          </Link>
          <nav className="flex gap-6 text-sm font-medium">
            <Link href="/public/trends" className="text-[#9ca3af] hover:text-[#f9fafb] transition">Tendencias</Link>
            <Link href="/public/cases" className="text-emerald-400">Casos</Link>
            <Link href="/public/subscribe" className="text-[#9ca3af] hover:text-[#f9fafb] transition">Suscribirse</Link>
            <Link href="/public/press" className="text-[#9ca3af] hover:text-[#f9fafb] transition">Prensa</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#f9fafb] mb-2">Casos Verificados</h1>
          <p className="text-[#9ca3af]">{MOCK_CASES.length} casos analizados · Última actualización hace 2 horas</p>
        </div>

        <div className="flex gap-4 mb-6">
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="px-4 py-2.5 rounded-xl bg-[#111827] border border-[#1f2937] text-[#f9fafb] text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="">Todos los veredictos</option>
            <option value="fake">Fake</option>
            <option value="uncertain">Uncertain</option>
            <option value="real">Real</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-4 py-2.5 rounded-xl bg-[#111827] border border-[#1f2937] text-[#f9fafb] text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="">Todos los tipos</option>
            <option value="image">Imágenes</option>
            <option value="video">Videos</option>
            <option value="audio">Audio</option>
            <option value="text">Texto</option>
          </select>
          {(tierFilter || typeFilter) && (
            <button
              onClick={() => { setTierFilter(''); setTypeFilter(''); }}
              className="px-4 py-2.5 rounded-xl bg-[#111827] border border-[#1f2937] text-[#6b7280] text-sm hover:text-[#f9fafb] transition"
            >
              Limpiar filtros
            </button>
          )}
        </div>

        <div className="space-y-4">
          {filtered.length === 0 && (
            <div className="text-center py-16 text-[#6b7280]">
              No hay casos que coincidan con los filtros seleccionados
            </div>
          )}
          {filtered.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl border border-[#1f2937] bg-[#0a0f1a] p-6 hover:border-emerald-500/30 transition"
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <MediaIcon type={c.mediaType} />
                  <TierBadge tier={c.tier} />
                  <span className="text-sm text-[#6b7280]">{c.country}</span>
                  <span className="text-xs text-[#6b7280]">•</span>
                  <span className="text-xs text-[#6b7280]">{formatDate(c.created_at)}</span>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-[#f9fafb]">{Math.round(c.score * 100)}%</div>
                  <div className="text-xs text-[#6b7280]">confianza</div>
                </div>
              </div>

              <p className="text-[#9ca3af] mb-4 leading-relaxed">{c.summary}</p>

              <div className="flex flex-wrap gap-2 mb-4">
                {c.keywords.map((kw) => (
                  <span
                    key={kw}
                    className="px-2.5 py-1 rounded-lg bg-[#111827] text-[#6b7280] text-xs"
                  >
                    {kw}
                  </span>
                ))}
              </div>

              {c.sources.length > 0 && (
                <div className="pt-4 border-t border-[#1f2937]">
                  <div className="text-xs text-[#6b7280] mb-2 font-medium">Fuentes verificadas:</div>
                  <div className="space-y-1">
                    {c.sources.map((s, i) => (
                      <a
                        key={i}
                        href={s}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-emerald-400 hover:text-emerald-300 truncate"
                      >
                        {s}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
