import { cn } from "@/lib/utils";

/** Stacked MYA. M and A are equal halves; Y is the shared spine. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 36" className={cn("h-9 w-auto", className)} aria-hidden="true">
      <g
        fill="none"
        className="stroke-primary"
        strokeWidth="2.5"
        strokeLinejoin="miter"
        strokeMiterlimit="2.2"
        strokeLinecap="square"
      >
        {/* M — two peaks, outer stems */}
        <path d="M5 16.5V3.2L16 15.4 27 3.2V16.5" />
        {/* Y — M's valley continues into A's peak */}
        <path d="M16 15.4V20.6" />
        {/* A — same stems, one peak, crossbar */}
        <path d="M16 19.8 5 25.4V33.2" />
        <path d="M16 19.8 27 25.4V33.2" />
        <path d="M9.4 28.8h13.2" />
      </g>
    </svg>
  );
}
