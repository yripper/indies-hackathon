"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Overview", icon: ChartIcon },
  { href: "/conversations", label: "Conversations", icon: ChatIcon },
  { href: "/public", label: "Hub Publico", icon: GlobeIcon },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r border-[#1f2937] bg-[#030712] p-6 lg:flex lg:flex-col">
      <Link href="/" className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#10b981] text-sm font-bold text-[#030712]">
          V
        </span>
        <div>
          <div className="font-mono text-sm font-bold tracking-wider text-[#f9fafb]">
            VERO
          </div>
          <div className="text-[10px] uppercase tracking-widest text-[#6b7280]">
            Anti-fraude por IA
          </div>
        </div>
      </Link>

      <nav className="mt-10 flex flex-col gap-1">
        {NAV.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                isActive
                  ? "bg-[#065f46]/30 text-[#34d399] font-medium"
                  : "text-[#9ca3af] hover:bg-[#111827] hover:text-[#f9fafb]"
              }`}
            >
              <item.icon active={isActive} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-6">
        <div className="rounded-lg border border-[#1f2937] bg-[#0a0f1a] px-3 py-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[#6b7280]">
            Status
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#10b981] animate-pulse" />
            <span className="text-xs text-[#9ca3af]">Agente activo</span>
          </div>
        </div>
        <div className="mt-4 text-[10px] text-[#6b7280]">
          hack@latam 2026 · DEF/ACC
        </div>
      </div>
    </aside>
  );
}

function ChartIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`h-4 w-4 ${active ? "text-[#34d399]" : "text-[#6b7280]"}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
      />
    </svg>
  );
}

function ChatIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`h-4 w-4 ${active ? "text-[#34d399]" : "text-[#6b7280]"}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
      />
    </svg>
  );
}

function GlobeIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`h-4 w-4 ${active ? "text-[#34d399]" : "text-[#6b7280]"}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
      />
    </svg>
  );
}
