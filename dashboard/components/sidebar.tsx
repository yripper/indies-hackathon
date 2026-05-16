import Link from "next/link";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/conversations", label: "Conversations" },
];

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950 lg:flex lg:flex-col">
      <Link href="/" className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-sm font-bold text-white dark:bg-white dark:text-zinc-900">
          V
        </span>
        <div>
          <div className="text-sm font-semibold leading-tight">Veritas</div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Audio defense
          </div>
        </div>
      </Link>

      <nav className="mt-8 flex flex-col gap-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto pt-6 text-[10px] text-zinc-400">
        hack@latam 2026 · DEF/ACC
      </div>
    </aside>
  );
}
