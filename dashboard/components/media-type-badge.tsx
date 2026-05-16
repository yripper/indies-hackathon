import type { MediaType } from "@/lib/api";

const SPECS: Record<
  MediaType,
  { label: string; icon: string; classes: string }
> = {
  audio: {
    label: "Audio",
    icon: "♫",
    classes:
      "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-400/30",
  },
  image: {
    label: "Imagen",
    icon: "▢",
    classes:
      "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20 dark:bg-fuchsia-950/40 dark:text-fuchsia-300 dark:ring-fuchsia-400/30",
  },
  video: {
    label: "Video",
    icon: "▶",
    classes:
      "bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-400/30",
  },
  document: {
    label: "Documento",
    icon: "📄",
    classes:
      "bg-zinc-100 text-zinc-700 ring-zinc-500/20 dark:bg-zinc-800/60 dark:text-zinc-200 dark:ring-zinc-400/30",
  },
};

export function MediaTypeBadge({
  type,
  size = "sm",
}: {
  type: MediaType;
  size?: "sm" | "md";
}) {
  const spec = SPECS[type];
  const sizeClasses =
    size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ring-1 ring-inset ${sizeClasses} ${spec.classes}`}
    >
      <span aria-hidden>{spec.icon}</span>
      {spec.label}
    </span>
  );
}
