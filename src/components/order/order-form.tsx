import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { WebsiteImport } from "@/components/order/website-import";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { CATEGORIES } from "@/lib/categories";
import { fileToDataUrl } from "@/lib/compress-image";
import { checkoutInputSchema, US_STATES } from "@/lib/intake";
import { startCheckout } from "@/lib/checkout.functions";
import {
  MASCOT_CENTS,
  PLATFORM_LABELS,
  PLATFORMS,
  PRODUCTS,
  TONE_HELP,
  TONE_LABELS,
  TONES,
  priceCentsFor,
  type Platform,
  type ProductId,
  type Tone,
} from "@/lib/products";
import { formatUsd } from "@/lib/utils";
import { factsFromProfile, type WebsiteFacts } from "@/lib/website-profile";

type Asset = { filename: string; mime: string; dataUrl: string; kind?: "upload" | "logo" };

function draftKey(productId: ProductId) {
  return `mya:order:${productId}`;
}

export function OrderForm({ productId, initialSite }: { productId: ProductId; initialSite?: string }) {
  const product = PRODUCTS[productId];
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("hvac");
  const [city, setCity] = useState("");
  const [state, setState] = useState("AZ");
  const [website, setWebsite] = useState(initialSite ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState<Tone>("trustworthy");
  const [platforms, setPlatforms] = useState<Platform[]>(["instagram", "facebook"]);
  const [mascot, setMascot] = useState(false);
  const [mascotDescription, setMascotDescription] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [websiteProfile, setWebsiteProfile] = useState<WebsiteFacts | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey(productId));
      if (raw) {
        const d = JSON.parse(raw) as Record<string, unknown>;
        if (typeof d.businessName === "string") setBusinessName(d.businessName);
        if (typeof d.category === "string") setCategory(d.category);
        if (typeof d.city === "string") setCity(d.city);
        if (typeof d.state === "string") setState(d.state);
        if (!initialSite && typeof d.website === "string") setWebsite(d.website);
        if (typeof d.phone === "string") setPhone(d.phone);
        if (typeof d.email === "string") setEmail(d.email);
        if (typeof d.brief === "string") setBrief(d.brief);
        if (typeof d.tone === "string" && (TONES as readonly string[]).includes(d.tone)) {
          setTone(d.tone as Tone);
        }
        if (Array.isArray(d.platforms)) {
          setPlatforms(d.platforms.filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p)));
        }
        if (typeof d.mascot === "boolean") setMascot(d.mascot);
        if (typeof d.mascotDescription === "string") setMascotDescription(d.mascotDescription);
        if (d.websiteProfile && typeof d.websiteProfile === "object") {
          setWebsiteProfile(d.websiteProfile as WebsiteFacts);
        }
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [productId, initialSite]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(
        draftKey(productId),
        JSON.stringify({
          businessName,
          category,
          city,
          state,
          website,
          phone,
          email,
          brief,
          tone,
          platforms,
          mascot,
          mascotDescription,
          websiteProfile,
        }),
      );
    } catch {
      /* quota */
    }
  }, [
    hydrated,
    productId,
    businessName,
    category,
    city,
    state,
    website,
    phone,
    email,
    brief,
    tone,
    platforms,
    mascot,
    mascotDescription,
    websiteProfile,
  ]);

  const total = useMemo(() => priceCentsFor(productId, mascot), [productId, mascot]);

  function togglePlatform(p: Platform) {
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  async function onFiles(files: FileList | null) {
    if (!files) return;
    setError("");
    const next = [...assets];
    for (const file of Array.from(files)) {
      if (next.length >= 8) break;
      if (!file.type.startsWith("image/")) {
        setError("Please upload photos or a logo (images only).");
        continue;
      }
      next.push({ ...(await fileToDataUrl(file)), kind: "upload" });
    }
    setAssets(next.slice(0, 8));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const payload = {
      product: productId,
      mascot,
      mascotDescription: mascot ? mascotDescription : undefined,
      businessName,
      category,
      city,
      state,
      website: website || undefined,
      phone,
      email,
      brief,
      tone,
      platforms,
      assets,
      websiteProfile,
    };
    const parsed = checkoutInputSchema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setError(first?.message ?? "Please check the form.");
      return;
    }
    setBusy(true);
    try {
      const res = await startCheckout({ data: parsed.data });
      try {
        sessionStorage.removeItem(draftKey(productId));
      } catch {
        /* ignore */
      }
      if (res.mode === "stripe") {
        window.location.href = res.url;
        return;
      }
      await navigate({ to: "/pay/$checkoutId", params: { checkoutId: res.checkoutId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-10">
        <WebsiteImport
          initialUrl={initialSite}
          onApply={({ url, profile, assets: pulled }) => {
            setWebsite(url);
            setBusinessName(profile.businessName);
            setCategory(profile.category);
            if (profile.city) setCity(profile.city);
            if ((US_STATES as readonly string[]).includes(profile.state)) setState(profile.state);
            if (profile.phone) setPhone(profile.phone);
            if (profile.email && !email) setEmail(profile.email);
            if (profile.brief) setBrief(profile.brief);
            setTone(profile.tone);
            setWebsiteProfile(factsFromProfile(profile));
            setAssets(pulled.slice(0, 8));
            setError("");
          }}
        />

        <section className="panel p-5 sm:p-7">
          <h2 className="font-display text-2xl">The business</h2>
          <p className="mt-1 text-sm text-muted">This goes on the end card, so spell it as you want it shown.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="biz">Business name</Label>
              <Input id="biz" required value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cat">Category</Label>
              <NativeSelect id="cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="web">Website or social link</Label>
              <Input
                id="web"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://"
              />
            </div>
            <div>
              <Label htmlFor="city">City</Label>
              <Input id="city" required value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="state">State</Label>
              <NativeSelect id="state" value={state} onChange={(e) => setState(e.target.value)}>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" required value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="email">Email for delivery</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
          </div>
        </section>

        <section className="panel p-5 sm:p-7">
          <h2 className="font-display text-2xl">What they say</h2>
          <div className="mt-6">
            <Label htmlFor="brief">Script</Label>
            <p className="mt-1 text-sm text-muted">
              Exact words on camera. We say this copy — we do not rewrite it. Paste the 20-second script, or label both
              as 20 second: and 40 second:.
            </p>
            <Textarea
              id="brief"
              required
              rows={8}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={`20 second: Massage, facials, nails — all in one relaxing Heber City location. Book a service or build your own spa package.\n\n40 second: Sometimes you don't need another errand. You need a few hours where nobody needs anything from you. …`}
            />
          </div>
          <fieldset className="mt-6">
            <legend className="eyebrow mb-3">Tone</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TONES.map((t) => (
                <label
                  key={t}
                  className={`flex cursor-pointer flex-col rounded-md border px-4 py-3 ${
                    tone === t ? "border-primary bg-elevated" : "border-border bg-bg"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="radio"
                      className="accent-primary"
                      name="tone"
                      checked={tone === t}
                      onChange={() => setTone(t)}
                    />
                    {TONE_LABELS[t]}
                  </span>
                  <span className="mt-1 pl-6 text-xs text-muted">{TONE_HELP[t]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-6">
            <legend className="eyebrow mb-3">Where it will run</legend>
            <p className="mb-3 text-xs text-muted">This only sets which size we prioritize. You still get all three.</p>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const on = platforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    className={`h-11 rounded-sm px-4 text-sm ${
                      on ? "bg-primary text-primary-fg" : "bg-bg text-fg shadow-[var(--shadow-border)]"
                    }`}
                  >
                    {PLATFORM_LABELS[p]}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </section>

        <section className="panel p-5 sm:p-7">
          <h2 className="font-display text-2xl">Photos and logo</h2>
          <p className="mt-1 text-sm text-muted">
            {websiteProfile
              ? "Pulled from the website. Add more if you have a truck, team, or job photos."
              : "At least one image. Storefront, truck, team, jobs, logo — 3 to 8 is better."}
          </p>
          <label className="mt-5 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-bg px-4 py-8 text-center">
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => void onFiles(e.target.files)}
            />
            <span className="text-sm font-medium">Add photos</span>
            <span className="mt-1 text-xs text-muted">{assets.length} of 8 selected</span>
          </label>
          {assets.length > 0 ? (
            <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {assets.map((a, i) => (
                <li key={`${a.filename}-${i}`} className="relative">
                  <img
                    src={a.dataUrl}
                    alt=""
                    className={`aspect-square w-full rounded-md outline outline-1 -outline-offset-1 outline-fg/10 ${
                      a.kind === "logo" ? "object-contain bg-elevated p-2" : "object-cover"
                    }`}
                  />
                  {a.kind === "logo" ? (
                    <span className="absolute left-1 top-1 rounded-sm bg-primary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-fg">
                      Logo
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded-sm bg-bg/80 px-2 py-0.5 text-[11px] text-fg"
                    onClick={() => setAssets(assets.filter((_, idx) => idx !== i))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="panel p-5 sm:p-7">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-primary"
              checked={mascot}
              onChange={(e) => setMascot(e.target.checked)}
            />
            <span>
              <span className="block font-medium">Add a mascot character · {formatUsd(MASCOT_CENTS)}</span>
              <span className="mt-1 block text-sm text-muted">
                A recurring character as its own extra video, delivered beside the 20s or 40s ad.
              </span>
            </span>
          </label>
          {mascot ? (
            <div className="mt-4">
              <Label htmlFor="mascot">One-line description</Label>
              <Input
                id="mascot"
                value={mascotDescription}
                onChange={(e) => setMascotDescription(e.target.value)}
                placeholder="A small terracotta roof-tile with kind eyes"
                required={mascot}
              />
            </div>
          ) : null}
        </section>
      </div>

      <aside className="panel h-fit p-6 lg:sticky lg:top-24">
        <p className="eyebrow">Order</p>
        <h2 className="mt-2 font-display text-3xl">{product.shortName}</h2>
        <p className="mt-2 text-sm text-muted">{product.blurb}</p>
        <dl className="mt-6 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt>{product.name}</dt>
            <dd className="tabular-nums">{formatUsd(product.priceCents)}</dd>
          </div>
          {mascot ? (
            <div className="flex justify-between gap-4">
              <dt>Mascot</dt>
              <dd className="tabular-nums">{formatUsd(MASCOT_CENTS)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t border-border pt-2 text-base font-medium">
            <dt>Total</dt>
            <dd className="tabular-nums text-primary">{formatUsd(total)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-muted">Delivered in 24 hours to your email. You own the finished ad.</p>
        {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy} className="mt-6 w-full" size="lg">
          {busy ? "Starting checkout…" : `Pay ${formatUsd(total)}`}
        </Button>
        <p className="mt-3 text-center text-xs text-subtle">
          One-time. No subscription.{" "}
          <Link to="/" className="underline">
            See all prices
          </Link>
        </p>
      </aside>
    </form>
  );
}
