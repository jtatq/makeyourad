import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  endCardTypeInstruction,
  looksLikeOnScreenPhone,
  motionScriptInstruction,
  noInventedOnScreenTypeInstruction,
  NO_INVENTED_ONSCREEN_TYPE,
  onScreenMode,
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
    assert.match(spoken, /Do not invent phone numbers, digits, addresses, or gibberish lettering/);
    assert.doesNotMatch(spoken, /Captions match those words/);

    const motion = motionScriptInstruction(script, "minimal-endcard");
    assert.match(motion, /Speak this script verbatim/);
    assert.match(motion, /Do not burn the spoken words as captions/);
    assert.match(motion, /Do not invent phone numbers, digits, addresses, or gibberish lettering on screen/);

    const end = endCardTypeInstruction("minimal-endcard", {
      businessName: "Alan's Pool Service",
      place: "Heber City, Utah",
      phone: "435-555-0100",
      cta: "Call today",
    });
    assert.match(end, /Alan's Pool Service/);
    assert.match(end, /Heber City, Utah/);
    assert.match(end, /clean type fades on: Alan's Pool Service\. Heber City, Utah\./);
    assert.doesNotMatch(end, /Call today/);
    assert.match(end, /If a phone must appear it must be exactly 435-555-0100/);
    assert.match(end, /Never invent phone numbers, fake digits, addresses, captions, logos, or gibberish lettering/);

    const noPhone = endCardTypeInstruction("minimal-endcard", {
      businessName: "Knoxville Chamber",
      place: "Knoxville, Tennessee",
      phone: "See website",
      cta: "Join us",
    });
    assert.match(noPhone, /Knoxville Chamber/);
    assert.match(noPhone, /Do not invent a phone number, fake digits, an address, or extra contact scrap/);
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
    assert.match(captionsNoPhone, /Do not invent a phone number/);
    assert.doesNotMatch(captionsNoPhone, /clean type fades on: Knoxville Chamber\. Knoxville, Tennessee\. \d/);

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
    assert.match(composited, /composited after generation/);
    assert.match(composited, /clean plate/);
    assert.match(composited, /phone numbers/);
    assert.match(composited, /digits/);
    assert.match(composited, /addresses/);
    assert.match(composited, /gibberish/);
    assert.match(composited, /Never invent phone numbers/);
    assert.doesNotMatch(composited, /Knowillo|Knoxvillo/);
    assert.doesNotMatch(composited, /865-555-0100/);
    assert.doesNotMatch(composited, /clean type fades on: Knoxville Chamber/);
  });

  it("does not treat placeholder phones as on-screen type, and bans invented contact scrap", () => {
    assert.equal(looksLikeOnScreenPhone("435-555-0100"), true);
    assert.equal(looksLikeOnScreenPhone("(865) 246-2000"), true);
    assert.equal(looksLikeOnScreenPhone("See website"), false);
    assert.equal(looksLikeOnScreenPhone(""), false);
    assert.equal(looksLikeOnScreenPhone("n/a"), false);

    const overlay = noInventedOnScreenTypeInstruction("865-555-0100", {
      endCard: { lines: ["Knoxville Chamber"] },
      lowerThird: null,
    });
    assert.match(overlay, /Clean plate only/);
    assert.match(overlay, /composited after generation/);
    assert.doesNotMatch(overlay, /865-555-0100/);
    assert.match(overlay, /contact footer/);

    const allowed = noInventedOnScreenTypeInstruction("435-555-0100");
    assert.match(allowed, /exactly 435-555-0100/);
    assert.match(allowed, new RegExp(NO_INVENTED_ONSCREEN_TYPE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const none = noInventedOnScreenTypeInstruction("See website");
    assert.match(none, /Do not show a phone number unless the brief provided a real one/);
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
    assert.match(overlay, /clean plate/);
    assert.match(overlay, /composited after generation/);
    assert.match(overlay, /phone numbers/);
    assert.match(overlay, /digits/);
    assert.match(overlay, /gibberish/);
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
    assert.match(minimal, /Do not invent a phone number/);
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
