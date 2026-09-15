import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { parseAudiencePaste, parseSummary } from "@/lib/briefing";

type Props = {
  mode: "create" | "apply";
  busy: boolean;
  onSubmit: (raw: string) => Promise<void>;
};

export function AudienceProfilePaste({ mode, busy, onSubmit }: Props) {
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  function peek() {
    setError("");
    const parsed = parseAudiencePaste(raw);
    const summary = parseSummary(parsed);
    if (!summary) {
      setPreview("");
      setError("Couldn’t read that. Paste PAGE_3 JSON or the full GPT briefing.");
      return;
    }
    setPreview(summary);
  }

  return (
    <section className="panel p-5">
      <h2 className="font-display text-xl">Audience profile</h2>
      <p className="mt-1 text-sm text-muted">
        Paste the GPT briefing. We use the Voiceover (25–30s) script and business info only. Geofences, Smith’s,
        income, and PAGE_3 targeting never go in the ad.
      </p>
      <div className="mt-4">
        <Label htmlFor="audience-profile">Paste</Label>
        <Textarea
          id="audience-profile"
          rows={8}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setPreview("");
          }}
          placeholder={`{\n  "PAGE_3_IN_MARKET_AUDIENCE": "Full-Service Day Spa",\n  "PAGE_3_LANDING_PAGE_URL": "https://agoodspaday.com/"\n}`}
          className="font-mono text-xs"
        />
      </div>
      {preview ? <p className="mt-2 text-sm text-muted">{preview}</p> : null}
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy || raw.trim().length < 20} onClick={peek}>
          Preview parse
        </Button>
        <Button
          type="button"
          disabled={busy || raw.trim().length < 20}
          onClick={() => void onSubmit(raw)}
        >
          {mode === "create" ? "Create jobs" : "Apply to this order"}
        </Button>
      </div>
    </section>
  );
}
