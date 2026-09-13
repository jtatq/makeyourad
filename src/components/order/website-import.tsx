import { Globe, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { categoryLabel } from "@/lib/categories";
import { US_STATES } from "@/lib/intake";
import { readBusinessWebsiteFn } from "@/lib/website.functions";
import { normalizeWebsiteUrl, type WebsiteAsset, type WebsiteProfile } from "@/lib/website-profile";

export type WebsiteApplyPayload = {
  url: string;
  profile: WebsiteProfile;
  assets: Array<WebsiteAsset & { kind: "logo" | "upload" }>;
};

export function WebsiteImport({
  initialUrl,
  onApply,
}: {
  initialUrl?: string;
  onApply: (payload: WebsiteApplyPayload) => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<WebsiteProfile | null>(null);
  const [canonical, setCanonical] = useState("");
  const [logo, setLogo] = useState<WebsiteAsset | null>(null);
  const [photos, setPhotos] = useState<WebsiteAsset[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [includeLogo, setIncludeLogo] = useState(true);
  const [applied, setApplied] = useState(false);
  const auto = useRef(false);

  async function read(raw: string) {
    setError("");
    setApplied(false);
    let href: string;
    try {
      href = normalizeWebsiteUrl(raw);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Paste a website.");
      return;
    }
    setBusy(true);
    setProfile(null);
    try {
      const res = await readBusinessWebsiteFn({ data: { url: href } });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCanonical(res.url);
      setUrl(res.url);
      setProfile(res.profile);
      setLogo(res.logo);
      setPhotos(res.photos);
      setIncludeLogo(Boolean(res.logo));
      setPicked(new Set(res.photos.map((_, i) => i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that website.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!initialUrl || auto.current) return;
    auto.current = true;
    setUrl(initialUrl);
    void read(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  function togglePhoto(i: number) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function apply() {
    if (!profile) return;
    const assets: WebsiteApplyPayload["assets"] = [];
    if (includeLogo && logo) assets.push({ ...logo, kind: "logo" });
    for (const i of [...picked].sort((a, b) => a - b)) {
      const photo = photos[i];
      if (photo) assets.push({ ...photo, kind: "upload" });
      if (assets.length >= 8) break;
    }
    onApply({ url: canonical || url, profile, assets });
    setApplied(true);
  }

  const selectedCount = (includeLogo && logo ? 1 : 0) + picked.size;

  return (
    <section className="panel p-5 sm:p-7">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-sm border border-primary text-primary">
          <Globe className="size-5" />
        </span>
        <div>
          <h2 className="font-display text-2xl">Start with the website</h2>
          <p className="mt-1 text-sm text-muted">
            We’ll pull the logo, photos, and what’s already on the site, then draft the ad from that. You can edit
            everything after.
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Label htmlFor="site-url" className="sr-only">
            Website
          </Label>
          <Input
            id="site-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void read(url);
              }
            }}
            placeholder="https://your-business.com"
            inputMode="url"
            autoComplete="url"
            disabled={busy}
          />
        </div>
        <Button type="button" disabled={busy || !url.trim()} className="sm:w-40" onClick={() => void read(url)}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Reading
            </>
          ) : (
            "Read the site"
          )}
        </Button>
      </div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {busy ? (
        <p className="mt-3 text-sm text-muted">Reading the site, pulling the logo and what they actually say.</p>
      ) : null}

      {profile ? (
        <div className="mt-6 rounded-lg bg-bg p-4 shadow-[var(--shadow-border)] sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {logo ? (
              <label className="flex shrink-0 cursor-pointer flex-col items-center gap-2">
                <span className="flex size-24 items-center justify-center overflow-hidden rounded-md bg-surface p-2 shadow-[var(--shadow-border)]">
                  <img src={logo.dataUrl} alt="" className="max-h-full max-w-full object-contain" />
                </span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={includeLogo}
                    onChange={(e) => setIncludeLogo(e.target.checked)}
                  />
                  Logo
                </span>
              </label>
            ) : (
              <div className="flex size-24 items-center justify-center rounded-md bg-elevated text-center text-xs text-muted">
                No logo found
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-display text-2xl leading-tight">{profile.businessName}</p>
              <p className="mt-1 text-sm text-muted">
                {categoryLabel(profile.category)}
                {profile.city ? ` · ${profile.city}${profile.state ? `, ${profile.state}` : ""}` : ""}
                {profile.phone ? ` · ${profile.phone}` : ""}
              </p>
              {profile.tagline ? <p className="mt-3 text-sm">{profile.tagline}</p> : null}
              {profile.services.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {profile.services.slice(0, 6).map((s) => (
                    <li key={s} className="rounded-sm bg-elevated px-3 py-1 text-xs text-fg">
                      {s}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {photos.length > 0 ? (
            <div className="mt-5">
              <p className="eyebrow mb-2">Photos from the site</p>
              <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {photos.map((p, i) => {
                  const on = picked.has(i);
                  return (
                    <li key={`${p.filename}-${i}`}>
                      <button
                        type="button"
                        onClick={() => togglePhoto(i)}
                        className={`relative block w-full overflow-hidden rounded-md ${
                          on ? "ring-2 ring-primary" : "opacity-50"
                        }`}
                      >
                        <img
                          src={p.dataUrl}
                          alt=""
                          className="aspect-square w-full object-cover outline outline-1 -outline-offset-1 outline-fg/10"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">No extra photos on the homepage. You can add them below.</p>
          )}

          {profile.state && !(US_STATES as readonly string[]).includes(profile.state) ? (
            <p className="mt-3 text-xs text-muted">We’ll need you to pick the state on the form.</p>
          ) : null}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted">
              {selectedCount} image{selectedCount === 1 ? "" : "s"} selected
              {selectedCount < 3 ? " · a couple more photos make a stronger ad" : ""}.
            </p>
            <Button type="button" onClick={apply} disabled={busy}>
              {applied ? "Applied to the form" : "Use this for the ad"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">No website? Skip this and fill in the details below.</p>
      )}
    </section>
  );
}
