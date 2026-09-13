import { useState, type FormEvent } from "react";
import { addToWaitlist } from "@/lib/checkout.functions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { formatUsd } from "@/lib/utils";
import { AVATAR_CENTS } from "@/lib/products";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [ack, setAck] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "dup" | "err">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!ack) {
      setError("Please confirm you own your likeness.");
      return;
    }
    setStatus("saving");
    try {
      const res = await addToWaitlist({ data: { email, name, city, likenessAck: true as const } });
      setStatus(res.already ? "dup" : "ok");
    } catch (err) {
      setStatus("err");
      setError(err instanceof Error ? err.message : "Could not join");
    }
  }

  if (status === "ok" || status === "dup") {
    return (
      <p className="text-[15px] leading-relaxed text-fg">
        {status === "dup"
          ? "You're already on the list. We'll write when Avatar opens."
          : "You're on the list. We'll write when Avatar is ready — you keep your likeness, and grant us a license to generate with it."}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Avatar is {formatUsd(AVATAR_CENTS)} when it opens. Waitlist only for now — no charge.
        You own your likeness. You grant us a license to generate ads with it. We never claim we own it.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="wl-name">Name</Label>
          <Input id="wl-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div>
          <Label htmlFor="wl-city">City</Label>
          <Input id="wl-city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="wl-email">Email</Label>
        <Input
          id="wl-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <label htmlFor="wl-ack" className="flex items-start gap-3 text-sm text-muted">
        <input
          id="wl-ack"
          type="checkbox"
          className="mt-1 size-4 accent-primary"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        <span>
          I own my likeness and grant MakeYourAd a license to generate ads with it. I keep ownership of my
          likeness.
        </span>
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" disabled={status === "saving"} className="sm:self-start">
        {status === "saving" ? "Saving…" : "Join the Avatar waitlist"}
      </Button>
    </form>
  );
}
