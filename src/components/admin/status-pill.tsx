import { STATUS_LABELS, type OrderStatus } from "@/lib/products";
import { cn } from "@/lib/utils";

const styles: Record<OrderStatus, string> = {
  paid: "bg-elevated text-fg",
  in_production: "bg-primary/15 text-primary",
  qc: "bg-ok/15 text-ok",
  delivered: "bg-ok text-fg",
  needs_attention: "bg-warn/15 text-warn",
  remake_requested: "bg-warn/15 text-warn",
  refunded: "bg-muted/20 text-muted",
};

export function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-sm px-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.12em]",
        styles[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function slaTone(createdAt: string, status: OrderStatus): "ok" | "warn" | "danger" | null {
  if (status === "delivered" || status === "refunded") return null;
  const hours = (Date.now() - new Date(createdAt).getTime()) / 36e5;
  if (hours >= 20) return "danger";
  if (hours >= 12) return "warn";
  return "ok";
}

export function hoursLabel(createdAt: string): string {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 36e5;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  return `${hours.toFixed(1)}h`;
}
