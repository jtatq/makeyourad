import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  endCardTypeInstruction,
  looksLikeOnScreenPhone,
  motionScriptInstruction,
  noInventedOnScreenTypeInstruction,
  ON_SCREEN_TYPE_GUARD,
  onScreenMode,
  onScreenTypeGuard,
  shouldReinitGeneration,
  spokenScriptInstruction,
  stillEndCardTypeInstruction,
} from "./generate-direction.ts";

describe("on-screen text direction", () => {
  it("defaults to script captions so existing spots keep burned VO type", () => {
    assert.equal(onScreenMode(undefined), "script-captions");
    assert.equal(onScreenMode(""), "script-captions");
    assert.equal(onScreenMode("Match Alan's face and the real pool."), "script-captions");
  });

  it("switches to name + city only when direction asks for minimal / end-card text", () => {
    assert.equal(onScreenMode("Minimal on-screen text — business name and city only."), "minimal-endcard");
    assert.equal(onScreenMode("End-card text only. Keep the spoken VO."), "minimal-endcard");
    assert.equal(onScreenMode("Don't burn the script on screen."), "minimal-endcard");
    assert.equal(onScreenMode("No captions. Spoken VO only."), "minimal-endcard");
  });

  it("keeps the spoken script while dropping caption-burn language in minimal mode", () => {
    const script = "I'm Alan. We build pools in Heber City, Utah.";
    const spoken = spokenScriptInstruction(script, "minimal-endcard");
    assert.match(spoken, /SPEAK this script verbatim/);
    assert.match(spoken, /I'm Alan/);
    assert.match(spoken, /Do not burn those words as on-screen captions/);
    assert.match(spoken, /business name and city only/);
    assert.doesNotMatch(spoken, /Captions match those words/);
    assert.doesNotMatch(spoken, /No invented phones/);

    const motion = motionScriptInstruction(script, "minimal-endcard");
    assert.match(motion, /Speak this script verbatim/);
    assert.match(motion, /Do not burn the spoken words as captions/);
    assert.doesNotMatch(motion, /No invented phones/);

    const end = endCardTypeInstruction("minimal-endcard", {
      businessName: "Alan's Pool Service",
      place: "Heber City, Utah",
      phone: "435-555-0100",
      cta: "Call today",
    });
    assert.match(end, /Alan's Pool Service/);
    assert.match(end, /Heber City, Utah/);
    assert.doesNotMatch(end, /Call today/);
    assert.doesNotMatch(end, /435-555-0100/);
    assert.doesNotMatch(end, /No invented phones/);

    const noPhone = endCardTypeInstruction("minimal-endcard", {
      businessName: "Knoxville Chamber",
      place: "Knoxville, Tennessee",
      phone: "See website",
      cta: "Join us",
    });
    assert.match(noPhone, /Knoxville Chamber/);
    assert.doesNotMatch(noPhone, /See website/);
    assert.doesNotMatch(noPhone, /Join us/);
    assert.doesNotMatch(noPhone, /\d{3}/);

    const captionsNoPhone = endCardTypeInstruction("script-captions", {
      businessName: "Knoxville Chamber",
      place: "Knoxville, Tennessee",
      phone: "",
      cta: "Join us",
    });
    assert.match(captionsNoPhone, /Join us/);
    assert.doesNotMatch(captionsNoPhone, /Last 3s: Knoxville Chamber\. Knoxville, Tennessee\. \d/);

    const composited = endCardTypeInstruction(
      "minimal-endcard",
      {
        businessName: "Knoxville Chamber",
        place: "Knoxville, Tennessee",
        phone: "865-555-0100",
        cta: "Join us",
      },
      { endCard: { lines: ["Knoxville Chamber", "KnoxvilleChamber.com"] }, lowerThird: null },
    );
    assert.match(composited, /clean plate for composited type/);
    assert.doesNotMatch(composited, /865-555-0100/);
    assert.doesNotMatch(composited, /Knoxville Chamber\. Knoxville/);
    assert.ok(composited.length < 80, `end-card overlay line should stay short: ${composited.length}`);
  });

  it("uses one short guard for invented phones, and never letters a phone on overlay plates", () => {
    assert.equal(looksLikeOnScreenPhone("435-555-0100"), true);
    assert.equal(looksLikeOnScreenPhone("(865) 246-2000"), true);
    assert.equal(looksLikeOnScreenPhone("See website"), false);
    assert.equal(looksLikeOnScreenPhone(""), false);
    assert.equal(looksLikeOnScreenPhone("n/a"), false);

    const overlay = onScreenTypeGuard("865-555-0100", {
      endCard: { lines: ["Knoxville Chamber"] },
      lowerThird: null,
    });
    assert.equal(overlay, noInventedOnScreenTypeInstruction("865-555-0100", { endCard: { lines: ["Knoxville Chamber"] }, lowerThird: null }));
    assert.match(overlay, /Clean plate/);
    assert.match(overlay, /composited after generation/);
    assert.match(overlay, /phones/);
    assert.match(overlay, /digits/);
    assert.doesNotMatch(overlay, /865-555-0100/);
    assert.ok(overlay.length < 120, `overlay guard too long: ${overlay.length}`);

    const allowed = onScreenTypeGuard("435-555-0100");
    assert.match(allowed, /exactly 435-555-0100|use only 435-555-0100/);
    assert.match(allowed, new RegExp(ON_SCREEN_TYPE_GUARD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const none = onScreenTypeGuard("See website");
    assert.match(none, /Show a phone only if the brief gave a real one/);
    assert.doesNotMatch(none, /See website/);
  });

  it("keeps still end-card plates blank when exact type is composited", () => {
    const overlay = stillEndCardTypeInstruction(
      "script-captions",
      {
        businessName: "Knoxville Chamber",
        place: "Knoxville, Tennessee",
        phone: "865-555-0100",
        cta: "Join us",
      },
      { endCard: { lines: ["Knoxville Chamber", "KnoxvilleChamber.com"] }, lowerThird: null },
    );
    assert.match(overlay, /Clean plate for composited end-card/);
    assert.doesNotMatch(overlay, /865-555-0100/);
    assert.doesNotMatch(overlay, /Join us/);

    const minimal = stillEndCardTypeInstruction("minimal-endcard", {
      businessName: "Alan's Pool Service",
      place: "Heber City, Utah",
      phone: "",
      cta: "Call today",
    });
    assert.match(minimal, /Alan's Pool Service/);
    assert.match(minimal, /Heber City, Utah/);
    assert.doesNotMatch(minimal, /Call today/);
  });
});

describe("remake restart", () => {
  it("force start always reinit even when a prior video is live or the job is done", () => {
    assert.equal(shouldReinitGeneration("start", true, "done", false), true);
    assert.equal(shouldReinitGeneration("start", true, "running", true), true);
    assert.equal(shouldReinitGeneration("start", true, "cancelled", false), true);
  });

  it("does not restart an in-flight take unless force is set", () => {
    assert.equal(shouldReinitGeneration("start", false, "running", true), false);
    assert.equal(shouldReinitGeneration("start", false, "running", false), false);
    assert.equal(shouldReinitGeneration("tick", true, "done", false), false);
  });

  it("starts a fresh job when there is no generation, or a finished/failed one", () => {
    assert.equal(shouldReinitGeneration("start", false, null, false), true);
    assert.equal(shouldReinitGeneration("start", false, "done", false), true);
    assert.equal(shouldReinitGeneration("start", false, "error", false), true);
  });
});
