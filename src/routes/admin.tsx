import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Mark } from "@/components/layout/site-chrome";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { adminLogin, adminSession } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  loader: async () => {
    const session = await adminSession();
    return { session };
  },
  component: AdminLayout,
});

function AdminLayout() {
  const { session } = Route.useLoaderData();
  if (!session.ok) {
    return <Login previewHint={session.previewHint} />;
  }
  return <Outlet />;
}

function Login({ previewHint }: { previewHint: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState(previewHint ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adminLogin({ data: { password } });
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={onSubmit} className="panel w-full max-w-sm p-7">
        <div className="flex items-center gap-2">
          <Mark className="h-7" />
          <span className="font-display text-xl">Operator</span>
        </div>
        <p className="mt-3 text-sm text-muted">Queue password. No user accounts.</p>
        <div className="mt-6">
          <Label htmlFor="pw">Password</Label>
          <Input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {previewHint ? (
          <p className="mt-2 text-xs text-muted">Preview password is prefilled.</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <Button className="mt-6 w-full" disabled={busy} type="submit">
          {busy ? "Checking…" : "Open the queue"}
        </Button>
      </form>
    </div>
  );
}
