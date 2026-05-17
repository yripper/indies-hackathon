'use client';

import { useState } from 'react';
import Link from 'next/link';

const TOPICS = [
  'Deepfakes en política',
  'Desinformación sanitaria',
  'Fraudes financieros',
  'Manipulación de imágenes',
  'Audio deepfake',
  'Campañas coordinadas',
  'Noticias falsas internacionales',
  'Contenido generado por IA',
];

export default function SubscribePage() {
  const [email, setEmail] = useState('');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [frequency, setFrequency] = useState('daily');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const toggleTopic = (topic: string) => {
    setSelectedTopics(prev =>
      prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setStatus('loading');
    setTimeout(() => {
      setStatus('success');
      setMessage('¡Suscrito! Revisa tu email para confirmar tu suscripción.');
    }, 1000);
  };

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
            <Link href="/public/subscribe" className="text-emerald-400">Suscribirse</Link>
            <Link href="/public/press" className="text-[#9ca3af] hover:text-[#f9fafb] transition">Prensa</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-6 py-16">
        {status === 'success' ? (
          <div className="text-center">
            <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 mb-6">
              <span className="text-4xl text-emerald-400">✓</span>
            </div>
            <h2 className="text-3xl font-bold text-[#f9fafb] mb-4">¡Suscrito!</h2>
            <p className="text-[#9ca3af] mb-8">
              {message}
            </p>
            <Link
              href="/public"
              className="inline-block px-6 py-3 bg-[#111827] hover:bg-[#1f2937] border border-[#1f2937] text-[#f9fafb] rounded-xl font-medium transition"
            >
              Volver al inicio
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-[#f9fafb] mb-2">Suscríbete a VERITAS</h1>
              <p className="text-[#9ca3af]">
                Recibe alertas sobre nuevas campañas de desinformación detectadas en tiempo real.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-[#9ca3af] mb-2">
                  Email
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-[#111827] border border-[#1f2937] text-[#f9fafb] placeholder-[#6b7280] focus:outline-none focus:border-emerald-500 transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#9ca3af] mb-3">
                  Tópicos de interés
                </label>
                <div className="flex flex-wrap gap-2">
                  {TOPICS.map((topic) => (
                    <button
                      key={topic}
                      type="button"
                      onClick={() => toggleTopic(topic)}
                      className={`px-3 py-1.5 rounded-full text-sm transition ${
                        selectedTopics.includes(topic)
                          ? 'bg-emerald-600 text-white'
                          : 'bg-[#111827] text-[#9ca3af] hover:bg-[#1f2937] border border-[#1f2937]'
                      }`}
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="frequency" className="block text-sm font-medium text-[#9ca3af] mb-2">
                  Frecuencia de alertas
                </label>
                <select
                  id="frequency"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[#111827] border border-[#1f2937] text-[#f9fafb] focus:outline-none focus:border-emerald-500"
                >
                  <option value="realtime">En tiempo real</option>
                  <option value="daily">Diario (resumen diario)</option>
                  <option value="weekly">Semanal (resumen semanal)</option>
                </select>
              </div>

              {status === 'error' && (
                <div className="p-4 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-sm">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 text-white font-semibold transition shadow-lg shadow-emerald-500/25"
              >
                {status === 'loading' ? 'Suscribiendo...' : 'Suscribirse Gratis'}
              </button>
            </form>

            <p className="text-center text-xs text-[#6b7280] mt-6">
              Al suscribirte aceptas recibir emails de VERITAS. Puedes darte de baja en cualquier momento.
              No compartimos tu email con terceros.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
