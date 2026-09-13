/** HTTP headers (Content-Disposition) only accept bytes 0–255. iPhone names use U+202F. */
export function safeFilename(name: string, fallback = "file"): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const ascii = base
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/["<>|:*?\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (ascii || fallback).slice(0, 180);
}

export function safeMime(mime: string, fallback = "application/octet-stream"): string {
  const t = mime.trim();
  if (/^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*$/.test(t)) return t;
  return fallback;
}

export function contentDisposition(filename: string): string {
  const ascii = safeFilename(filename).replace(/[^\x20-\x7E]/g, "_");
  return `inline; filename="${ascii}"`;
}
