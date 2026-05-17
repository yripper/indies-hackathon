'use client';

import Link from 'next/link';

export default function PressPage() {
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
            <Link href="/public/cases" className="text-[#9ca3af] hover:text-[#f9fafb] transition">Casos</Link>
            <Link href="/public/subscribe" className="text-[#9ca3af] hover:text-[#f9fafb] transition">Suscribirse</Link>
            <Link href="/public/press" className="text-emerald-400">Prensa</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold text-[#f9fafb] mb-4">Press Kit</h1>
          <p className="text-[#9ca3af] max-w-xl mx-auto">
            Recursos para medios de comunicación que quieran usar VERITAS en sus publicaciones.
          </p>
        </div>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-[#f9fafb] mb-6">Logo</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="group p-10 rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-400 flex items-center justify-center hover:scale-105 transition cursor-pointer">
              <span className="text-5xl font-bold text-white">V</span>
            </div>
            <div className="group p-10 rounded-2xl bg-[#111827] border border-[#1f2937] flex items-center justify-center hover:scale-105 transition cursor-pointer">
              <span className="text-5xl font-bold text-[#f9fafb]">V</span>
            </div>
            <div className="group p-10 rounded-2xl bg-white flex items-center justify-center hover:scale-105 transition cursor-pointer">
              <span className="text-5xl font-bold text-[#030712]">V</span>
            </div>
          </div>
          <p className="text-sm text-[#6b7280] mt-3">Click para descargar · PNG 512x512</p>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-[#f9fafb] mb-6">Badges de Verificación</h2>
          <p className="text-[#9ca3af] mb-6">
            Usa estos badges para indicar que tu contenido ha sido verificado o analizado por VERITAS.
          </p>

          <div className="space-y-4">
            <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-green-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-green-500/20">
                  <span className="text-2xl font-bold text-white">✓</span>
                </div>
                <div>
                  <div className="font-semibold text-[#f9fafb] text-lg">Verificado Real</div>
                  <div className="text-sm text-[#9ca3af]">Para contenido auténtico verificado por VERITAS</div>
                </div>
              </div>
              <div className="bg-[#030712] rounded-xl p-4 font-mono text-xs text-[#9ca3af] overflow-x-auto">
                {`<a href="https://veritas.pub/case/{id}" target="_blank" rel="noopener">
  <img src="https://veritas.pub/badge/real.png" alt="Verificado por VERITAS" width="120" height="40" />
</a>`}
              </div>
            </div>

            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-red-600 to-orange-500 flex items-center justify-center shadow-lg shadow-red-500/20">
                  <span className="text-2xl font-bold text-white">✗</span>
                </div>
                <div>
                  <div className="font-semibold text-[#f9fafb] text-lg">Detectado Fake</div>
                  <div className="text-sm text-[#9ca3af]">Para contenido identificado como desinformación</div>
                </div>
              </div>
              <div className="bg-[#030712] rounded-xl p-4 font-mono text-xs text-[#9ca3af] overflow-x-auto">
                {`<a href="https://veritas.pub/case/{id}" target="_blank" rel="noopener">
  <img src="https://veritas.pub/badge/fake.png" alt="Detectado por VERITAS" width="120" height="40" />
</a>`}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-400 flex items-center justify-center shadow-lg shadow-amber-500/20">
                  <span className="text-2xl font-bold text-white">?</span>
                </div>
                <div>
                  <div className="font-semibold text-[#f9fafb] text-lg">No Verificado</div>
                  <div className="text-sm text-[#9ca3af]">Para contenido pendiente de verificación</div>
                </div>
              </div>
              <div className="bg-[#030712] rounded-xl p-4 font-mono text-xs text-[#9ca3af] overflow-x-auto">
                {`<a href="https://veritas.pub/case/{id}" target="_blank" rel="noopener">
  <img src="https://veritas.pub/badge/uncertain.png" alt="Pendiente de verificar" width="120" height="40" />
</a>`}
              </div>
            </div>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-[#f9fafb] mb-6">API para Medios</h2>
          <p className="text-[#9ca3af] mb-4">
            Accede a nuestra API REST para integrar datos de verificación en tus aplicaciones y flujos de trabajo.
          </p>

          <div className="bg-[#0a0f1a] rounded-2xl border border-[#1f2937] overflow-hidden">
            <div className="flex border-b border-[#1f2937]">
              <button className="px-4 py-2 text-sm text-emerald-400 border-b-2 border-emerald-400">REST API</button>
              <button className="px-4 py-2 text-sm text-[#6b7280] hover:text-[#f9fafb] transition">Webhooks</button>
              <button className="px-4 py-2 text-sm text-[#6b7280] hover:text-[#f9fafb] transition">SDK</button>
            </div>
            <div className="p-6">
              <pre className="text-sm text-[#9ca3af] overflow-x-auto font-mono leading-relaxed">{`# Autenticación
GET https://api.veritas.pub/v1/public/stats
Authorization: Bearer YOUR_API_KEY

# Obtener casos verificados
GET https://api.veritas.pub/v1/public/cases?tier=fake&limit=50

# Ver tendencias actuales
GET https://api.veritas.pub/v1/public/trends

# Verificar URL específica
POST https://api.veritas.pub/v1/verify
Content-Type: application/json
{"url": "https://example.com/news"}`}</pre>
            </div>
          </div>

          <div className="mt-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <p className="text-sm text-emerald-300">
              <strong>Rate Limit:</strong> 100 requests/minuto para usuarios autenticados.
              ¿Necesitas más? Contacta <a href="mailto:press@veritas.pub" className="underline">press@veritas.pub</a>
            </p>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-[#f9fafb] mb-6">Estadísticas</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-6 rounded-2xl bg-[#111827] border border-[#1f2937] text-center">
              <div className="text-4xl font-bold text-[#f9fafb] mb-1">1,582</div>
              <div className="text-sm text-[#9ca3af]">Casos verificados</div>
            </div>
            <div className="p-6 rounded-2xl bg-[#111827] border border-[#1f2937] text-center">
              <div className="text-4xl font-bold text-red-400 mb-1">892</div>
              <div className="text-sm text-[#9ca3af]">Deepfakes detectados</div>
            </div>
            <div className="p-6 rounded-2xl bg-[#111827] border border-[#1f2937] text-center">
              <div className="text-4xl font-bold text-emerald-400 mb-1">23</div>
              <div className="text-sm text-[#9ca3af]">Países monitoreados</div>
            </div>
          </div>
        </section>

        <section className="p-8 rounded-2xl bg-gradient-to-r from-emerald-600/20 to-emerald-500/10 border border-emerald-500/30 text-center">
          <h2 className="text-2xl font-semibold text-[#f9fafb] mb-2">Contacto de Prensa</h2>
          <p className="text-[#9ca3af] mb-4">
            Para entrevistas, datos estadísticos, o colaboración con medios.
          </p>
          <a
            href="mailto:press@veritas.pub"
            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition"
          >
            press@veritas.pub
          </a>
        </section>
      </main>
    </div>
  );
}
