import { Play } from "lucide-react";
import { useState } from "react";

const EXAMPLES = [
  {
    src: "/examples/hvac.jpg",
    title: "Desert Air HVAC",
    meta: "40s · Mesa, AZ · 9:16",
    ratio: "9/16",
  },
  {
    src: "/examples/roofing.jpg",
    title: "Northside Roofing",
    meta: "20s · Fresno, CA · 1:1",
    ratio: "1/1",
  },
  {
    src: "/examples/dental.jpg",
    title: "Willow Dental",
    meta: "40s · Queen Creek, AZ · 16:9",
    ratio: "16/9",
  },
] as const;

export function ExampleAds() {
  const [open, setOpen] = useState<(typeof EXAMPLES)[number] | null>(null);
  return (
    <>
      <div className="grid gap-5 md:grid-cols-3">
        {EXAMPLES.map((ex) => (
          <button key={ex.src} type="button" onClick={() => setOpen(ex)} className="group text-left">
            <div
              className="relative overflow-hidden rounded-lg bg-elevated shadow-[var(--shadow-border)]"
              style={{ aspectRatio: ex.ratio }}
            >
              <img
                src={ex.src}
                alt=""
                className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-fg/10"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-bg/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <span className="flex size-14 items-center justify-center rounded-sm bg-primary text-primary-fg">
                  <Play className="ml-0.5 size-6" fill="currentColor" />
                </span>
              </span>
            </div>
            <p className="mt-3 font-medium">{ex.title}</p>
            <p className="text-sm text-muted">{ex.meta}</p>
          </button>
        ))}
      </div>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 p-4"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
          aria-label={open.title}
        >
          <div className="max-h-[90vh] max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <img src={open.src} alt={open.title} className="max-h-[80vh] w-auto rounded-lg object-contain" />
            <p className="mt-3 text-center text-sm text-fg">
              {open.title} · {open.meta}. Finished ads arrive as MP4 (video) or PNG (static).
            </p>
            <button type="button" className="mx-auto mt-3 block text-sm text-muted underline" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
