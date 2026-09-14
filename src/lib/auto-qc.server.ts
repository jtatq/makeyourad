import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type QcCheck = {
  id: string;
  ok: boolean;
  hard: boolean;
  label: string;
  detail: string;
};

export type AutoQcResult = {
  status: "pass" | "fail" | "warn";
  checks: QcCheck[];
  ranAt: string;
};

type Probe = {
  duration: number | null;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  size: number | null;
};

function check(id: string, ok: boolean, hard: boolean, label: string, detail: string): QcCheck {
  return { id, ok, hard, label, detail };
}

function cityHint(city: string): string {
  const key = city.trim().toLowerCase();
  const hints: Record<string, string> = {
    "heber city": "HEE-ber City",
    heber: "HEE-ber",
    mesa: "MAY-suh",
    "casa grande": "CAH-sah GRAHN-day",
    "queen creek": "Queen Creek",
    "san tan valley": "San Tan Valley",
  };
  return hints[key] || city;
}

export function pronunciationNote(city: string, state: string): string {
  return `Pronounce the city clearly as ${cityHint(city)}, ${state}.`;
}

async function probeMedia(url: string): Promise<Probe | null> {
  const empty: Probe = { duration: null, hasAudio: false, width: null, height: null, size: null };
  let dir = "";
  try {
    dir = await mkdtemp(join(tmpdir(), "mya-qc-"));
    const dest = join(dir, "clip.bin");
    if (url.startsWith("data:")) {
      const comma = url.indexOf(",");
      const b64 = comma >= 0 ? url.slice(comma + 1) : "";
      await writeFile(dest, Buffer.from(b64, "base64"));
    } else {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) return { ...empty, size: 0 };
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(dest, buf);
    }
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", dest],
      { timeout: 15000 },
    );
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string; size?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };
    const streams = parsed.streams ?? [];
    const video = streams.find((s) => s.codec_type === "video");
    const dur = parsed.format?.duration ? Number(parsed.format.duration) : null;
    const size = parsed.format?.size ? Number(parsed.format.size) : null;
    return {
      duration: Number.isFinite(dur) ? dur : null,
      hasAudio: streams.some((s) => s.codec_type === "audio"),
      width: video?.width ?? null,
      height: video?.height ?? null,
      size: Number.isFinite(size) ? size : null,
    };
  } catch {
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

type Vision = {
  personFacingCamera: boolean;
  businessNameVisible: boolean;
  cityVisible: boolean;
  phoneVisible: boolean;
  watermarkOrUi: boolean;
  wrongBusiness: boolean;
  notes: string;
};

async function visionStill(
  imageUrl: string,
  order: { business_name: string; city: string; state: string; phone: string },
  slotLabel: string,
): Promise<Vision | null> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key || !imageUrl) return null;
  const payload = {
    model: "grok-4.5",
    temperature: 0,
    max_tokens: 400,
    messages: [
      {
        role: "system",
        content:
          "You QC one advertisement still. Reply JSON only, no markdown. Booleans must be true only if clearly true.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `Slot: ${slotLabel}`,
              `Business name: ${order.business_name}`,
              `City: ${order.city}, ${order.state}`,
              `Phone: ${order.phone}`,
              `JSON keys: personFacingCamera, businessNameVisible, cityVisible, phoneVisible, watermarkOrUi, wrongBusiness, notes`,
            ].join("\n"),
          },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  };
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = body.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as Partial<Vision>;
    return {
      personFacingCamera: Boolean(parsed.personFacingCamera),
      businessNameVisible: Boolean(parsed.businessNameVisible),
      cityVisible: Boolean(parsed.cityVisible),
      phoneVisible: Boolean(parsed.phoneVisible),
      watermarkOrUi: Boolean(parsed.watermarkOrUi),
      wrongBusiness: Boolean(parsed.wrongBusiness),
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 240) : "",
    };
  } catch {
    return null;
  }
}

export async function inspectClip(opts: {
  slot: {
    id: string;
    label: string;
    duration: number | null;
    targetSeconds?: number | null;
    stillUrl?: string;
    videoUrl?: string;
  };
  order: { business_name: string; city: string; state: string; phone: string };
}): Promise<AutoQcResult> {
  const { slot, order } = opts;
  const checks: QcCheck[] = [];
  const mediaUrl = slot.videoUrl || slot.stillUrl || "";
  const talking = slot.id === "hook" || slot.id.startsWith("body");
  const end = slot.id === "end_card" || slot.id === "static";

  checks.push(
    check(
      "file",
      Boolean(mediaUrl),
      true,
      "File exists",
      mediaUrl ? "Clip file is present." : "No still or video on this slot.",
    ),
  );

  let probe: Probe | null = null;
  if (mediaUrl) probe = await probeMedia(mediaUrl);

  if (probe?.size != null) {
    const ok = probe.size > 8000;
    checks.push(check("size", ok, true, "File size", ok ? `${Math.round(probe.size / 1024)} KB` : "File is too small — likely corrupt."));
  }

  const target = slot.targetSeconds || slot.duration;
  if (slot.videoUrl && target && probe?.duration != null) {
    const ratio = probe.duration / target;
    const ok = ratio >= 0.7 && ratio <= 1.35;
    const hard = ratio < 0.45 || ratio > 1.8;
    checks.push(
      check(
        "duration",
        ok,
        hard,
        "Duration",
        `${probe.duration.toFixed(1)}s vs ${target}s target.`,
      ),
    );
  }

  if (slot.videoUrl && talking && probe) {
    checks.push(
      check(
        "audio",
        probe.hasAudio,
        true,
        "Spoken audio",
        probe.hasAudio ? "Audio track present." : "No audio track — talking clip needs VO.",
      ),
    );
  }

  if (probe?.width && probe?.height) {
    const portrait = probe.height >= probe.width;
    const wantPortrait = true;
    checks.push(
      check(
        "frame",
        portrait === wantPortrait,
        false,
        "Frame",
        `${probe.width}×${probe.height}.`,
      ),
    );
  }

  const still = slot.stillUrl || "";
  if (still) {
    const vis = await visionStill(still, order, slot.label);
    if (vis) {
      if (talking) {
        checks.push(
          check(
            "talent",
            vis.personFacingCamera,
            false,
            "On-camera person",
            vis.personFacingCamera ? "Person facing camera." : vis.notes || "No talking-head in the still.",
          ),
        );
      }
      if (end) {
        const copyOk = vis.businessNameVisible && vis.cityVisible;
        checks.push(
          check(
            "end-copy",
            copyOk,
            true,
            "Name and city on screen",
            copyOk
              ? `Name${vis.phoneVisible ? " and phone" : ""} readable.`
              : `Missing on-screen type. ${vis.notes}`.trim(),
          ),
        );
        checks.push(
          check(
            "phone",
            vis.phoneVisible,
            false,
            "Phone on screen",
            vis.phoneVisible ? order.phone : "Phone not clearly readable.",
          ),
        );
      }
      checks.push(
        check(
          "identity",
          !vis.wrongBusiness,
          true,
          "Right business",
          vis.wrongBusiness ? vis.notes || "Looks like a different company." : "Matches this business.",
        ),
      );
      checks.push(
        check(
          "clean",
          !vis.watermarkOrUi,
          false,
          "No watermark / UI",
          vis.watermarkOrUi ? vis.notes || "Watermark or UI chrome visible." : "Clean frame.",
        ),
      );
    }
  }

  const hardFail = checks.some((c) => c.hard && !c.ok);
  const softFail = checks.some((c) => !c.hard && !c.ok);
  const status: AutoQcResult["status"] = hardFail ? "fail" : softFail ? "warn" : "pass";
  return { status, checks, ranAt: new Date().toISOString() };
}
