import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Mark } from "@/components/layout/mark";

export { Mark };

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/92 backdrop-blur-md">
      <div className="h-0.5 bg-primary" />
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-3 text-fg">
          <Mark />
          <span className="font-display text-[1.05rem] font-bold tracking-tight">MakeYourAd</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-muted md:flex">
          <a href="/#pricing" className="hover:text-fg">
            Prices
          </a>
          <a href="/#examples" className="hover:text-fg">
            Examples
          </a>
          <a href="/#faq" className="hover:text-fg">
            FAQ
          </a>
        </nav>
        {!compact ? (
          <Button asChild size="sm">
            <Link to="/order/$product" params={{ product: "video-20" }}>
              Order an ad
            </Link>
          </Button>
        ) : (
          <span className="eyebrow">Delivered in 24 hours</span>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div>
          <div className="flex items-center gap-3">
            <Mark className="h-7" />
            <span className="font-display text-base font-bold tracking-tight">MakeYourAd</span>
          </div>
          <p className="mt-2 max-w-sm text-sm text-muted">
            Your ad, made for you. Delivered in 24 hours. You own the finished files.
          </p>
          <p className="mt-3 text-xs text-subtle">Geotarget · Hyperlocal video advertising</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          <Link to="/terms" className="hover:text-fg">
            Terms
          </Link>
          <Link to="/privacy" className="hover:text-fg">
            Privacy
          </Link>
          <Link to="/admin" className="hover:text-fg">
            Operator
          </Link>
          <a href="mailto:hello@makeyourad.com" className="hover:text-fg">
            hello@makeyourad.com
          </a>
        </div>
      </div>
    </footer>
  );
}
