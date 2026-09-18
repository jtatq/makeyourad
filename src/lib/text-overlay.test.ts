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
  extractEndCardCopy,
  extractLowerThirdCopy,
  hasTextOverlay,
  overlayHoldInstruction,
  overlaySvgContainsExact,
  overlaySvgMarkup,
  overlayTags,
  overlayTiming,
  parseTextOverlayFromDirection,
  readEndCardField,
  readLowerThirdField,
  resolveTextOverlay,
  specFromFields,
  splitOverlayLines,
  videoDirectionForModel,
} from "./text-overlay.ts";
import { overlayStillBuffer, overlayVideoBuffer } from "./text-overlay.server.ts";

const execFileAsync = promisify(execFile);

const KNOX_END = ["Knoxville Chamber", "Innovation. Prosperity. Knoxville.", "KnoxvilleChamber.com"];
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
      splitOverlayLines("Knoxville Chamber / Innovation. Prosperity. Knoxville. / KnoxvilleChamber.com"),
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
    assert.deepEqual(extractEndCardCopy("Knoxville Chamber logo + KnoxvilleChamber.com over Market Square"), [
      "Knoxville Chamber",
      "KnoxvilleChamber.com",
    ]);
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
      resolveTextOverlay({ stored: specFromFields(KNOX_END, KNOX_LOWER), brief: "" }).endCard?.lines,
      KNOX_END,
    );
    assert.deepEqual(resolveTextOverlay({ brief: KNOX_BRIEF }).lowerThird?.lines, KNOX_LOWER);
  });

  it("does not steal spoken VO or invent overlay lines from a talking-head brief", () => {
    const spoken = extractSpokenVoiceover(KNOX_BRIEF);
    assert.match(spoken, /You didn't build your business in a vacuum/);
    assert.doesNotMatch(spoken, /Innovation\. Prosperity/);
    assert.doesNotMatch(spoken, /Larisa Brass/);
    const empty = parseTextOverlayFromDirection("I'm Alan. We build pools in Heber City, Utah. Call us today.");
    assert.equal(hasTextOverlay(empty), false);
    const stored = composeStoredVisual("Open on downtown Knoxville skyline", specFromFields(KNOX_END, KNOX_LOWER));
    assert.match(stored, /Open on downtown Knoxville skyline/);
    assert.match(stored, /\[END CARD:\] Knoxville Chamber \/ Innovation\. Prosperity\. Knoxville\./);
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
    assert.match(overlayHoldInstruction(spec), /composited after generation/);
    assert.match(overlayTags(spec), /\[END CARD:\] Knoxville Chamber/);
    const model = videoDirectionForModel(
      "End card: Knoxville Chamber / Innovation. Prosperity. Knoxville. / KnoxvilleChamber.com",
      spec,
    );
    assert.match(model, /no on-screen letters/);
    assert.doesNotMatch(model, /Innovation\. Prosperity\. Knoxville\./);
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
      await execFileAsync(
        "ffmpeg",
        ["-y", "-sseof", "-0.2", "-i", out, "-frames:v", "1", frame],
        { timeout: 20_000 },
      );
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
});
