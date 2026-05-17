import Link from 'next/link';
import { GlobeWrapper } from '@/components/globe-client';

export const dynamic = 'force-dynamic';

const GLOBE_POINTS = [
  { latitude: 19.4326, longitude: -99.1332, name: 'México', tier: 'fake' as const, count: 8 },
  { latitude: -34.6037, longitude: -58.3816, name: 'Argentina', tier: 'fake' as const, count: 5 },
  { latitude: -23.5505, longitude: -46.6333, name: 'Brasil', tier: 'fake' as const, count: 7 },
  { latitude: 4.7110, longitude: -74.0721, name: 'Colombia', tier: 'uncertain' as const, count: 3 },
  { latitude: -12.0464, longitude: -77.0428, name: 'Perú', tier: 'fake' as const, count: 4 },
  { latitude: -33.4489, longitude: -70.6693, name: 'Chile', tier: 'real' as const, count: 2 },
  { latitude: 10.4806, longitude: -66.9036, name: 'Venezuela', tier: 'fake' as const, count: 6 },
  { latitude: 14.6349, longitude: -90.5069, name: 'Guatemala', tier: 'uncertain' as const, count: 2 },
  { latitude: 38.9072, longitude: -77.0369, name: 'USA', tier: 'fake' as const, count: 9 },
  { latitude: 40.4168, longitude: -3.7038, name: 'España', tier: 'uncertain' as const, count: 3 },
];

const KEYWORDS = [
  { keyword: 'elecciones', count: 234 },
  { keyword: 'deepfake', count: 189 },
  { keyword: 'vacunas', count: 156 },
  { keyword: 'fraude electoral', count: 143 },
  { keyword: 'audio manipulado', count: 127 },
  { keyword: 'noticia falsa', count: 112 },
  { keyword: 'contenido IA', count: 98 },
  { keyword: 'manipulación', count: 87 },
  { keyword: 'propaganda', count: 76 },
  { keyword: 'bots', count: 65 },
];

const COUNTRIES = [
  { country: 'México', count: 156 },
  { country: 'Brasil', count: 134 },
  { country: 'Argentina', count: 98 },
  { country: 'Colombia', count: 76 },
  { country: 'Venezuela', count: 65 },
  { country: 'Perú', count: 54 },
  { country: 'Chile', count: 43 },
  { country: 'USA', count: 38 },
];

const DARKWEB_TOPICS = [
  'elecciones 2026', 'campaña coordinado', 'cuenta falsa', 'video deepfake',
  'audio clone', 'noticia inventada', 'manipulación foto', 'contenido IA',
  'phishing', 'fraude crypto',
];

const TIER_STATS = [
  { tier: 'fake', count: 892, color: 'red' },
  { tier: 'uncertain', count: 234, color: 'amber' },
  { tier: 'real', count: 456, color: 'green' },
];

export default function TrendsPage() {
  const maxKeywordCount = KEYWORDS[0]?.count || 1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950">
      <header className="border-b border-slate-800/50 backdrop-blur-sm bg-slate-950/50">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <Link href="/public" className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <span className="text-xl font-bold text-white">V</span>
            </div>
            <span className="text-xl font-bold text-white tracking-tight">VERITAS</span>
          </Link>
          <nav className="flex gap-6 text-sm font-medium">
            <Link href="/public/trends" className="text-cyan-400">Tendencias</Link>
            <Link href="/public/cases" className="text-slate-300 hover:text-white transition">Casos</Link>
            <Link href="/public/subscribe" className="text-slate-300 hover:text-white transition">Suscribirse</Link>
            <Link href="/public/press" className="text-slate-300 hover:text-white transition">Prensa</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Tendencias de Desinformación</h1>
          <p className="text-slate-400">Monitoreo global en tiempo real · Datos actualizados cada hora</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/30 backdrop-blur-sm overflow-hidden">
            <div className="p-4 border-b border-slate-800/50">
              <h2 className="text-white font-semibold">Distribución Global</h2>
            </div>
            <div className="p-6 flex justify-center">
              <GlobeWrapper points={GLOBE_POINTS} width={450} height={450} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-700/50 bg-slate-900/30 backdrop-blur-sm p-4">
              <h3 className="text-white font-semibold mb-4">Top Keywords</h3>
              <div className="space-y-3">
                {KEYWORDS.map((kw, i) => (
                  <div key={kw.keyword} className="flex items-center gap-3">
                    <span className="w-5 text-xs text-slate-500 text-right">{i + 1}</span>
                    <div className="flex-1 bg-slate-800/50 rounded-full h-3 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all"
                        style={{ width: `${(kw.count / maxKeywordCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm text-white w-36 truncate">{kw.keyword}</span>
                    <span className="text-xs text-slate-500 w-12 text-right">{kw.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-700/50 bg-slate-900/30 backdrop-blur-sm p-4">
              <h3 className="text-white font-semibold mb-4">Por País</h3>
              <div className="space-y-2">
                {COUNTRIES.map((c) => (
                  <div key={c.country} className="flex items-center justify-between py-1.5 border-b border-slate-800/50 last:border-0">
                    <span className="text-sm text-white">{c.country}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-24 bg-slate-800/50 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
                          style={{ width: `${(c.count / COUNTRIES[0].count) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm text-slate-400 w-12 text-right">{c.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/50 bg-slate-900/30 backdrop-blur-sm p-6 mb-8">
          <h3 className="text-white font-semibold mb-4">Casos por Veredicto</h3>
          <div className="grid grid-cols-3 gap-4">
            {TIER_STATS.map((t) => (
              <div key={t.tier} className={`rounded-xl p-5 text-center ${
                t.color === 'red' ? 'bg-red-500/10 border border-red-500/30' :
                t.color === 'amber' ? 'bg-amber-500/10 border border-amber-500/30' :
                'bg-green-500/10 border border-green-500/30'
              }`}>
                <div className={`text-sm font-medium mb-1 ${
                  t.color === 'red' ? 'text-red-400' :
                  t.color === 'amber' ? 'text-amber-400' :
                  'text-green-400'
                }`}>
                  {t.tier.toUpperCase()}
                </div>
                <div className="text-4xl font-bold text-white">{t.count.toLocaleString()}</div>
                <div className="text-xs text-slate-500 mt-1">casos detectados</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/50 bg-slate-900/30 backdrop-blur-sm p-6">
          <h3 className="text-white font-semibold mb-4">Topics Dark Web</h3>
          <div className="flex flex-wrap gap-2">
            {DARKWEB_TOPICS.map((topic) => (
              <span
                key={topic}
                className="px-4 py-1.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-sm hover:bg-red-500/20 transition cursor-pointer"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}