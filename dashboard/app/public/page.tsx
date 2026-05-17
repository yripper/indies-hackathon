import Link from 'next/link';
import { GlobeWrapper } from '@/components/globe-client';

export const dynamic = 'force-dynamic';

const MOCK_CASES = [
  { id: '1', tier: 'fake', country: 'México', summary: 'Video manipulado de candidato político mostrando declaraciones falsas', keywords: ['política', 'deepfake', 'elecciones'], score: 0.92, created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
  { id: '2', tier: 'uncertain', country: 'Colombia', summary: 'Audio deepfake de periodista conocido difundiendo noticias falsas', keywords: ['audio', 'periodismo', 'manipulación'], score: 0.67, created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() },
  { id: '3', tier: 'real', country: 'Chile', summary: 'Imagen verificada de evento real con metadata válida y fuentes confiables', keywords: ['verificado', 'evento real'], score: 0.95, created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
  { id: '4', tier: 'fake', country: 'Argentina', summary: 'Fotografía antigua presentada como actual para desinformar sobre protestasso', keywords: ['imagen', 'desinformación', 'manipulación'], score: 0.88, created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
  { id: '5', tier: 'fake', country: 'Brasil', summary: 'Video con audio reemplazado para hacer creer que funcionario dijo algo que nunca dijo', keywords: ['video', 'audio fake', 'política'], score: 0.91, created_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString() },
  { id: '6', tier: 'uncertain', country: 'Perú', summary: 'Captura de pantalla editada de noticia real con contexto diferente', keywords: ['texto', 'manipulación', 'contexto'], score: 0.55, created_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() },
];

const MOCK_STATS = {
  cases_24h: 127,
  cases_7d: 843,
  darkweb_total: 23,
  top_keyword: 'elecciones',
  keywords_count: 156,
};

const GLOBE_POINTS = [
  { latitude: 19.4326, longitude: -99.1332, name: 'Ciudad de México', tier: 'fake' as const, count: 5 },
  { latitude: -34.6037, longitude: -58.3816, name: 'Buenos Aires', tier: 'fake' as const, count: 3 },
  { latitude: -23.5505, longitude: -46.6333, name: 'São Paulo', tier: 'fake' as const, count: 4 },
  { latitude: 4.7110, longitude: -74.0721, name: 'Bogotá', tier: 'uncertain' as const, count: 2 },
  { latitude: -12.0464, longitude: -77.0428, name: 'Lima', tier: 'fake' as const, count: 3 },
  { latitude: -33.4489, longitude: -70.6693, name: 'Santiago', tier: 'real' as const, count: 2 },
  { latitude: 10.4806, longitude: -66.9036, name: 'Caracas', tier: 'fake' as const, count: 4 },
  { latitude: -0.1807, longitude: -78.4678, name: 'Quito', tier: 'uncertain' as const, count: 1 },
  { latitude: 14.6349, longitude: -90.5069, name: 'Guatemala', tier: 'fake' as const, count: 2 },
  { latitude: 38.9072, longitude: -77.0369, name: 'Washington DC', tier: 'fake' as const, count: 6 },
  { latitude: 40.4168, longitude: -3.7038, name: 'Madrid', tier: 'uncertain' as const, count: 2 },
];

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));

  if (hours < 1) return 'Hace minutos';
  if (hours < 24) return `Hace ${hours} horas`;
  const days = Math.floor(hours / 24);
  return `Hace ${days} días`;
}

export default function PublicLandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950">
      <header className="border-b border-slate-800/50 backdrop-blur-sm bg-slate-950/50">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <span className="text-xl font-bold text-white">V</span>
            </div>
            <span className="text-xl font-bold text-white tracking-tight">VERITAS</span>
          </div>
          <nav className="flex gap-6 text-sm font-medium">
            <Link href="/public/trends" className="text-cyan-400 hover:text-cyan-300 transition">Tendencias</Link>
            <Link href="/public/cases" className="text-slate-300 hover:text-white transition">Casos</Link>
            <Link href="/public/subscribe" className="text-slate-300 hover:text-white transition">Suscribirse</Link>
            <Link href="/public/press" className="text-slate-300 hover:text-white transition">Prensa</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-sm font-medium mb-6">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            Monitoreo activo 24/7
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-white mb-4 tracking-tight">
            Radar de <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Desinformación</span>
          </h1>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10">
            Plataforma de monitoreo global para detectar deepfakes, noticias falsas y campañas de desinformación en tiempo real.
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href="/public/trends"
              className="px-8 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white rounded-xl font-semibold shadow-lg shadow-blue-500/25 transition"
            >
              Ver Tendencias
            </Link>
            <Link
              href="/public/cases"
              className="px-8 py-3 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700 text-white rounded-xl font-semibold transition"
            >
              Explorar Casos
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-16">
          <div className="rounded-3xl overflow-hidden border border-slate-700/50 bg-slate-900/30 backdrop-blur-sm">
            <div className="p-4 border-b border-slate-800/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-white font-semibold">Globo de Desinformación</h2>
                <span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-400">{MOCK_STATS.cases_24h} casos hoy</span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Fake</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Uncertain</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Real</span>
              </div>
            </div>
            <div className="flex justify-center p-6 bg-gradient-to-b from-slate-900/50 to-slate-950/50">
              <GlobeWrapper points={GLOBE_POINTS} width={550} height={550} />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-16">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700/50">
              <div className="text-3xl font-bold text-white mb-1">{MOCK_STATS.cases_24h}</div>
              <div className="text-sm text-slate-400">Casos detectados hoy</div>
            </div>
            <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700/50">
              <div className="text-3xl font-bold text-white mb-1">{MOCK_STATS.cases_7d}</div>
              <div className="text-sm text-slate-400">Casos últimos 7 días</div>
            </div>
            <div className="p-6 rounded-2xl bg-gradient-to-br from-red-500/10 to-slate-900/50 border border-red-500/20">
              <div className="text-3xl font-bold text-red-400 mb-1">{MOCK_STATS.darkweb_total}</div>
              <div className="text-sm text-slate-400">Campañas Dark Web</div>
            </div>
            <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700/50">
              <div className="text-3xl font-bold text-cyan-400 mb-1">{MOCK_STATS.top_keyword}</div>
              <div className="text-sm text-slate-400">Keyword más usado</div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-16">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">Casos Recientes</h2>
            <Link href="/public/cases" className="text-sm text-cyan-400 hover:text-cyan-300">Ver todos →</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {MOCK_CASES.map((c) => (
              <div
                key={c.id}
                className="group p-5 rounded-2xl bg-slate-800/30 border border-slate-700/50 hover:border-cyan-500/50 transition-all hover:shadow-lg hover:shadow-cyan-500/5"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    c.tier === 'fake' ? 'bg-red-500/20 text-red-400' :
                    c.tier === 'uncertain' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-green-500/20 text-green-400'
                  }`}>
                    {c.tier.toUpperCase()}
                  </span>
                  <span className="text-xs text-slate-500">{formatTimeAgo(c.created_at)}</span>
                </div>
                <p className="text-sm text-slate-300 mb-3 line-clamp-2">{c.summary}</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {c.keywords.slice(0, 3).map((kw) => (
                    <span key={kw} className="px-2 py-0.5 rounded bg-slate-700/50 text-xs text-slate-400">
                      {kw}
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">{c.country}</span>
                  <span className="text-sm font-mono text-slate-300">{Math.round(c.score * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 pb-20 text-center">
          <div className="p-8 rounded-3xl bg-gradient-to-r from-blue-600/20 to-cyan-600/20 border border-blue-500/30">
            <h2 className="text-2xl font-bold text-white mb-2">Mantente Protegido</h2>
            <p className="text-slate-400 mb-6">Suscríbete para recibir alertas sobre nuevas campañas de desinformación en tu región</p>
            <Link
              href="/public/subscribe"
              className="inline-block px-8 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold rounded-xl transition"
            >
              Suscribirse Gratis
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800/50">
        <div className="mx-auto max-w-6xl px-6 py-8 flex items-center justify-between text-sm text-slate-500">
          <span>VERITAS © 2026 · Plataforma Anti-Desinformación</span>
          <span>hack@latam 2026</span>
        </div>
      </footer>
    </div>
  );
}