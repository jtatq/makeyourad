import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  endCardTypeInstruction,
  motionScriptInstruction,
  onScreenMode,
  shouldReinitGeneration,
  spokenScriptInstruction,
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

    const motion = motionScriptInstruction(script, "minimal-endcard");
    assert.match(motion, /Speak this script verbatim/);
    assert.match(motion, /Do not burn the spoken words as captions/);

    const end = endCardTypeInstruction("minimal-endcard", {
      businessName: "Alan's Pool Service",
      place: "Heber City, Utah",
      phone: "435-555-0100",
      cta: "Call today",
    });
    assert.match(end, /Alan's Pool Service/);
    assert.match(end, /Heber City, Utah/);
    assert.doesNotMatch(end, /435-555-0100/);
    assert.doesNotMatch(end, /Call today/);
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
