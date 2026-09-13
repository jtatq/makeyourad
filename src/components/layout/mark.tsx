import { cn } from "@/lib/utils";

/** Interconnected MYA ligature — M's right peak is Y's left arm, Y's right peak is A's apex. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 78 32"
      className={cn("h-8 w-auto", className)}
      aria-hidden="true"
    >
      <g
        fill="none"
        className="stroke-primary"
        strokeWidth="5"
        strokeLinejoin="miter"
        strokeMiterlimit="2.4"
        strokeLinecap="square"
      >
        <path d="M5 27.2V5.6L15.6 24.2 26.2 5.6V27.2" />
        <path d="M26.2 5.6 37.2 17.6 48.2 5.6" />
        <path d="M37.2 17.6V27.2" />
        <path d="M48.2 5.6 41.4 27.2" />
        <path d="M48.2 5.6 63 27.2" />
        <path d="M44.2 17.2H58.4" />
      </g>
    </svg>
  );
}
