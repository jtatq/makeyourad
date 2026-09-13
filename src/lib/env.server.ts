export function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/**
 * Workspace preview vs deployed app.
 * - Sandbox live preview: neither VERCEL nor GROK_PROJECT_ID
 * - Grok publish: GROK_PROJECT_ID is set
 * - Custom Vercel (makeyourad.com): VERCEL is set, GROK_PROJECT_ID is not
 */
export function isWorkspacePreview(): boolean {
  if (env("VERCEL")) return false;
  return !env("GROK_PROJECT_ID");
}
