import type { InputHTMLAttributes, LabelHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-sm border border-border bg-transparent text-fg placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, "h-12 px-3.5 text-[15px]", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, "min-h-32 px-3.5 py-3 text-[15px] leading-relaxed", className)} {...props} />;
}

export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, "h-12 px-3.5 text-[15px] bg-surface", className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-subtle mb-1.5", className)}
      {...props}
    />
  );
}
