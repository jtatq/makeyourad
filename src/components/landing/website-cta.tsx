import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function WebsiteCta() {
  return (
    <form action="/order/video-20" method="get" className="mt-8 max-w-xl">
      <Label htmlFor="hero-site">Business website</Label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id="hero-site"
          name="site"
          placeholder="https://your-business.com"
          inputMode="url"
          autoComplete="url"
          className="bg-surface"
        />
        <Button type="submit" size="lg" className="sm:w-44">
          Make my ad
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted">We’ll use the logo and what’s on the site. You can edit everything after.</p>
    </form>
  );
}
