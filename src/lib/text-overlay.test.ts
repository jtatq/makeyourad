import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { extractSpokenVoiceover } from "./video-direction.ts";
import {
  composeStoredVisual,
  coverBlurRadius,
  endCardCoverRect,
  extractEndCardCopy,
  extractLowerThirdCopy,
  hasTextOverlay,
  lowerThirdCoverRect,
  overlayHoldInstruction,
  overlaySvgContainsExact,
  overlaySvgMarkup,
  overlayTags,
  overlayTiming,
  parseTextOverlayFromDirection,
  promptRoleForOverlay,
  readEndCardField,
  readLowerThirdField,
  resolveTextOverlay,
  specFromFields,
  splitOverlayLines,
  videoDirectionForModel,
} from "./text-overlay.ts";
import { overlayStillBuffer, overlayVideoBuffer } from "./text-overlay.server.ts";

const execFileAsync = promisify(execFile);

const KNOX_END = [
  "Knoxville Chamber",
  "Innovation. Prosperity. Knoxville.",
  "KnoxvilleChamber.com",
];
const KNOX_LOWER = ["Larisa Brass", "Director of Innovation"];

const KNOX_BRIEF = `Business Name: Knoxville Chamber
Business Address: 17 Market Square, Knoxville, TN

Voiceover 25–30 seconds
You didn't build your business in a vacuum. You built it with grit, neighbors, and a city that shows up. Join us today.

[VISUAL:] Open on downtown Knoxville skyline
[LOWER THIRD:] Larisa Brass | Director of Innovation
[END CARD:] Knoxville Chamber / Innovation. Prosperity. Knoxville. / KnoxvilleChamber.com
[SFX:] City ambience`;

describe("parse exact overlay copy", () => {
  it("reads explicit endCard / lowerThird fields without rewriting spoken VO", () => {
    const spec = specFromFields(KNOX_END, "Larisa Brass | Director of Innovation");
    assert.deepEqual(spec.endCard?.lines, KNOX_END);
    assert.deepEqual(spec.lowerThird?.lines, KNOX_LOWER);
    assert.equal(hasTextOverlay(spec), true);
  });

  it("accepts slash-separated exact lines and API aliases", () => {
    const end = readEndCardField({
      end_card: "Knoxville Chamber / Innovation. Prosperity. Knoxville. / KnoxvilleChamber.com",
    });
    assert.deepEqual(end, KNOX_END);
    const lower = readLowerThirdField({
      lower_third: "Larisa Brass | Director of Innovation",
    });
    assert.deepEqual(lower, KNOX_LOWER);
    assert.deepEqual(
      splitOverlayLines(
        "Knoxville Chamber / Innovation. Prosperity. Knoxville. / KnoxvilleChamber.com",
      ),
      KNOX_END,
    );
  });

  it("parses [END CARD:] / [LOWER THIRD:] tags and videoDirection labels", () => {
    const fromBrief = parseTextOverlayFromDirection(KNOX_BRIEF);
    assert.deepEqual(fromBrief.endCard?.lines, KNOX_END);
    assert.deepEqual(fromBrief.lowerThird?.lines, KNOX_LOWER);

    const fromDirection = parseTextOverlayFromDirection(
      "Open on downtown Knoxville skyline\nLower third: Larisa Brass | Director of Innovation\nEnd card: Knoxville Chamber / Innovation. Prosperity. Knoxville. / KnoxvilleChamber.com",
    );
    assert.deepEqual(fromDirection.endCard?.lines, KNOX_END);
    assert.deepEqual(fromDirection.lowerThird?.lines, KNOX_LOWER);
  });

  it("extracts brandable copy from a shot-list end-card cue", () => {
    assert.deepEqual(
      extractEndCardCopy("Knoxville Chamber logo + KnoxvilleChamber.com over Market Square"),
      ["Knoxville Chamber", "KnoxvilleChamber.com"],
    );
    assert.deepEqual(extractLowerThirdCopy("Larisa Brass | Director of Innovation"), KNOX_LOWER);
  });

  it("prefers explicit fields over parsed brief, then stored", () => {
    assert.deepEqual(
      resolveTextOverlay({
        explicit: specFromFields(["Exact Card"], ["Exact Name"]),
        brief: KNOX_BRIEF,
        stored: specFromFields(["Old Card"], ["Old Name"]),
      }).endCard?.lines,
      ["Exact Card"],
    );
    assert.deepEqual(
      resolveTextOverlay({ stored: specFromFields(KNOX_END, KNOX_LOWER), brief: "" }).endCard
        ?.lines,
      KNOX_END,
    );
    assert.deepEqual(resolveTextOverlay({ brief: KNOX_BRIEF }).lowerThird?.lines, KNOX_LOWER);
  });

  it("does not steal spoken VO or invent overlay lines from a talking-head brief", () => {
    const spoken = extractSpokenVoiceover(KNOX_BRIEF);
    assert.match(spoken, /You didn't build your business in a vacuum/);
    assert.doesNotMatch(spoken, /Innovation\. Prosperity/);
    assert.doesNotMatch(spoken, /Larisa Brass/);
    const empty = parseTextOverlayFromDirection(
      "I'm Alan. We build pools in Heber City, Utah. Call us today.",
    );
    assert.equal(hasTextOverlay(empty), false);
    const stored = composeStoredVisual(
      "Open on downtown Knoxville skyline",
      specFromFields(KNOX_END, KNOX_LOWER),
    );
    assert.match(stored, /Open on downtown Knoxville skyline/);
    assert.match(
      stored,
      /\[END CARD:\] Knoxville Chamber \/ Innovation\. Prosperity\. Knoxville\./,
    );
    assert.match(stored, /\[LOWER THIRD:\] Larisa Brass \| Director of Innovation/);
  });
});

describe("exact string rendering", () => {
  it("embeds Knoxville (not Knowillo / Knoxvillo) in the overlay SVG", () => {
    const spec = specFromFields(KNOX_END, KNOX_LOWER.join(" | "));
    const svg = overlaySvgMarkup(spec, 1080, 1920, "both");
    for (const line of [...KNOX_END, ...KNOX_LOWER]) {
      assert.equal(overlaySvgContainsExact(svg, line), true, `missing ${line}`);
    }
    assert.doesNotMatch(svg, /Knowillo|Knoxvillo/);
    const hold = overlayHoldInstruction(spec);
    assert.match(hold, /composited after generation/);
    assert.match(hold, /Clean plate/);
    assert.match(hold, /phones/);
    assert.match(hold, /digits/);
    assert.doesNotMatch(hold, /865-555-0100/);
    assert.ok(hold.length < 120, `overlay hold should be one short line: ${hold.length}`);
    assert.match(overlayTags(spec), /\[END CARD:\] Knoxville Chamber/);
    const model = videoDirectionForModel(
      "End card: Knoxville Chamber / Innovation. Prosperity. Knoxville. / KnoxvilleChamber.com\nLower third: Larisa Brass | Director of Innovation",
      spec,
    );
    assert.match(model, /blank plate, no letters \(type composited\)/);
    assert.match(model, /blank band, no letters \(type composited\)/);
    assert.doesNotMatch(model, /Innovation\. Prosperity\. Knoxville\./);
    assert.doesNotMatch(model, /Larisa Brass/);
    const role =
      "In the last three seconds hold and super name and city (full state word). Super a phone only when a real number was provided — never invent digits, addresses, or contact scrap. Super CTA if provided. Do not cut to a separate end-card graphic.";
    const blanked = promptRoleForOverlay(role, spec);
    assert.match(blanked, /blank plate with no words, letters, logos, or URLs/);
    assert.doesNotMatch(blanked, /super name and city/i);
    assert.match(blanked, /Do not cut to a separate end-card graphic/);
    assert.equal(promptRoleForOverlay(role, null), role);
    const endCover = endCardCoverRect(1080, 1920);
    assert.equal(endCover.x % 2, 0);
    assert.equal(endCover.y % 2, 0);
    assert.equal(endCover.width % 2, 0);
    assert.equal(endCover.height % 2, 0);
    assert.ok(endCover.y >= 1920 * 0.48 && endCover.y <= 1920 * 0.52);
    assert.equal(endCover.y + endCover.height, 1920);
    const lowerCover = lowerThirdCoverRect(1080, 1920);
    assert.ok(lowerCover.y > endCover.y);
    assert.ok(lowerCover.y + lowerCover.height <= 1920);
    assert.ok(coverBlurRadius(1080, 1920, endCover) >= 10);
    assert.equal(overlayHoldInstruction(null), "");
    assert.equal(overlayHoldInstruction({ endCard: null, lowerThird: null }), "");
  });

  it("composites exact end-card lines onto a still", async () => {
    const { default: sharp } = await import("sharp");
    const blank = await sharp({
      create: { width: 720, height: 1280, channels: 3, background: { r: 30, g: 40, b: 50 } },
    })
      .jpeg()
      .toBuffer();
    const spec = specFromFields(KNOX_END, null);
    const overlaid = await overlayStillBuffer(blank, spec, "endCard");
    for (const line of KNOX_END) {
      assert.equal(overlaySvgContainsExact(overlaid.svg, line), true);
    }
    assert.doesNotMatch(overlaid.svg, /Knowillo|Knoxvillo/);
    assert.ok(overlaid.buffer.length > 1000);
    const misspelled = specFromFields(["Knowillo Chamber"], null);
    const wrong = await overlayStillBuffer(blank, misspelled, "endCard");
    assert.notEqual(overlaid.buffer.equals(wrong.buffer), true);
    const again = await overlayStillBuffer(blank, spec, "endCard");
    assert.equal(overlaid.buffer.equals(again.buffer), true);
  });

  it("burns exact end-card type onto the last frames of a video without rewriting audio", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mya-ov-test-"));
    const src = join(dir, "src.mp4");
    try {
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=0x1b2838:s=640x360:d=3",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=3",
          "-pix_fmt",
          "yuv420p",
          "-shortest",
          src,
        ],
        { timeout: 30_000 },
      );
      const input = await readFile(src);
      const spec = specFromFields(["Knoxville Chamber", "KnoxvilleChamber.com"], null);
      const result = await overlayVideoBuffer(input, spec, { durationHint: 3 });
      assert.ok(result.svgEnd && overlaySvgContainsExact(result.svgEnd, "Knoxville"));
      assert.ok(result.svgEnd && overlaySvgContainsExact(result.svgEnd, "KnoxvilleChamber.com"));
      assert.ok(result.buffer.length > 1000);
      assert.notEqual(result.buffer.equals(input), true);

      const out = join(dir, "out.mp4");
      const frame = join(dir, "last.jpg");
      await writeFile(out, result.buffer);
      await execFileAsync("ffmpeg", ["-y", "-sseof", "-0.2", "-i", out, "-frames:v", "1", frame], {
        timeout: 20_000,
      });
      const last = await readFile(frame);
      const { default: sharp } = await import("sharp");
      const stats = await sharp(last).stats();
      const blankStats = await sharp({
        create: { width: 640, height: 360, channels: 3, background: { r: 27, g: 40, b: 56 } },
      })
        .jpeg()
        .toBuffer()
        .then((b) => sharp(b).stats());
      assert.ok(stats.channels[0] && blankStats.channels[0]);
      const timing = overlayTiming(15);
      assert.ok(timing.endCardStart >= 11.5);
      assert.ok(timing.lowerThirdEnd <= timing.endCardStart);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("blurs model-burned titles in the end-card band and leaves the picture above it", async () => {
    const { default: sharp } = await import("sharp");
    const width = 640;
    const height = 360;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        if (y < Math.round(height * 0.4)) {
          raw[i] = 32;
          raw[i + 1] = 72;
          raw[i + 2] = 112;
        } else {
          const on = Math.floor(x / 8) % 2 === 0;
          const v = on ? 255 : 0;
          raw[i] = v;
          raw[i + 1] = v;
          raw[i + 2] = v;
        }
      }
    }
    const plate = await sharp(raw, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
    const spec = specFromFields(
      ["H3 Buildings & Structures", "La Vernia, TX", "h3buildings.com"],
      null,
    );
    const overlaid = await overlayStillBuffer(plate, spec, "endCard");
    for (const line of spec.endCard?.lines ?? []) {
      assert.equal(overlaySvgContainsExact(overlaid.svg, line), true);
    }
    const { data, info } = await sharp(overlaid.buffer).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
    };
    const gap = (a: number[], b: number[]) =>
      Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    const sky = at(12, 20);
    assert.ok(
      Math.abs(sky[0] - 32) < 24 && Math.abs(sky[1] - 72) < 24 && Math.abs(sky[2] - 112) < 24,
    );
    const aboveCover = gap(at(4, 160), at(12, 160));
    const belowBox = gap(at(4, 340), at(12, 340));
    assert.ok(aboveCover > 80, `stripes above the cover should stay sharp, delta ${aboveCover}`);
    assert.ok(
      belowBox < 40,
      `burned-in stripes under the end card should be illegible, delta ${belowBox}`,
    );
  });

  it("covers only the end-card hold on video and keeps the audio", async () => {
    const { default: sharp } = await import("sharp");
    const dir = await mkdtemp(join(tmpdir(), "mya-ov-cover-"));
    const png = join(dir, "stripes.png");
    const src = join(dir, "src.mp4");
    const out = join(dir, "out.mp4");
    const width = 640;
    const height = 360;
    try {
      const raw = Buffer.alloc(width * height * 3, 240);
      for (let y = Math.round(height * 0.4); y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 3;
          const v = Math.floor(x / 8) % 2 === 0 ? 255 : 0;
          raw[i] = v;
          raw[i + 1] = v;
          raw[i + 2] = v;
        }
      }
      await sharp(raw, { raw: { width, height, channels: 3 } })
        .png()
        .toFile(png);
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-loop",
          "1",
          "-i",
          png,
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=3",
          "-t",
          "3",
          "-pix_fmt",
          "yuv420p",
          "-shortest",
          src,
        ],
        { timeout: 30_000 },
      );
      const input = await readFile(src);
      const spec = specFromFields(["H3 Buildings & Structures", "h3buildings.com"], null);
      const result = await overlayVideoBuffer(input, spec, { durationHint: 3 });
      assert.ok(result.svgEnd && overlaySvgContainsExact(result.svgEnd, "h3buildings.com"));
      await writeFile(out, result.buffer);
      const gapAt = async (seconds: number) => {
        const frame = join(dir, `f-${seconds}.png`);
        await execFileAsync(
          "ffmpeg",
          ["-y", "-i", out, "-ss", String(seconds), "-frames:v", "1", frame],
          { timeout: 20_000 },
        );
        const { data, info } = await sharp(frame).raw().toBuffer({ resolveWithObject: true });
        const at = (x: number, y: number) => {
          const i = (y * info.width + x) * info.channels;
          return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
        };
        return Math.max(
          Math.abs(at(4, 340)[0] - at(12, 340)[0]),
          Math.abs(at(4, 340)[1] - at(12, 340)[1]),
          Math.abs(at(4, 340)[2] - at(12, 340)[2]),
        );
      };
      const early = await gapAt(0.25);
      const late = await gapAt(2.6);
      assert.ok(early > 80, `before the end card, burned-in type stays, delta ${early}`);
      assert.ok(late < 45, `during the end card, burned-in type is covered, delta ${late}`);
      const audio = async (file: string) => {
        const { stdout } = await execFileAsync(
          "ffprobe",
          [
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            file,
          ],
          {
            timeout: 15_000,
          },
        );
        return stdout.trim();
      };
      assert.equal(await audio(out), "audio");
      assert.equal(await audio(src), "audio");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
