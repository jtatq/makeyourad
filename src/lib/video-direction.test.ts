import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { motionScriptInstruction, spokenScriptInstruction } from "./generate-direction.ts";
import {
  applyVideoDirection,
  composeStoredBrief,
  extractSpokenVoiceover,
  extractVideoDirection,
  looksLikeShotList,
  parseBriefLayers,
  pictureContinuityInstruction,
  readVideoDirectionField,
  resolveVideoDirection,
  stillOpeningHint,
  stillUsesDirectedOpening,
  videoShotListInstruction,
} from "./video-direction.ts";

const KNOX_SPOKEN = "You didn't build your business in a vacuum. You built it with grit, neighbors, and a city that shows up. Join us today.";

const KNOX_BRACKET_BRIEF = `[VISUAL:] Open on downtown Knoxville skyline
[VO:] You didn't build your business in a vacuum.
[VISUAL:] Transition to Market Square with Larisa Brass (Director of Innovation), tablet, welcoming nod
[LOWER THIRD:] Larisa Brass | Director of Innovation
[VISUAL:] Tight shot interacting / modern workspace
[VO:] You built it with grit, neighbors, and a city that shows up. Join us today.
[END CARD:] Knoxville Chamber logo + KnoxvilleChamber.com over Market Square
[SFX:] City ambience`;

const KNOX_SECTION_BRIEF = `Business Name: Knoxville Chamber
Business Address: 17 Market Square, Knoxville, TN

Voiceover 25–30 seconds
You didn't build your business in a vacuum. You built it with grit, neighbors, and a city that shows up. Join us today.

VISUAL / CAMERA:
- Open on downtown Knoxville skyline
- Transition to Market Square with Larisa Brass (Director of Innovation), tablet, welcoming nod
- Lower third: Larisa Brass | Director of Innovation
- Tight shot interacting / modern workspace
- End card: Knoxville Chamber logo + KnoxvilleChamber.com over Market Square`;

describe("parse spoken VO vs visual direction", () => {
  it("splits [VISUAL:] / [SFX:] / lower-third tags from spoken VO", () => {
    const layers = parseBriefLayers(KNOX_BRACKET_BRIEF);
    assert.match(layers.spoken, /You didn't build your business in a vacuum/);
    assert.match(layers.spoken, /Join us today/);
    assert.doesNotMatch(layers.spoken, /Open on downtown Knoxville/);
    assert.doesNotMatch(layers.spoken, /Larisa Brass/);
    assert.doesNotMatch(layers.spoken, /Market Square/);
    assert.doesNotMatch(layers.spoken, /KnoxvilleChamber\.com/);
    assert.doesNotMatch(layers.spoken, /City ambience/);
    assert.equal(layers.hasVisualDirection, true);
    assert.match(layers.videoDirection, /Open on downtown Knoxville skyline/);
    assert.match(layers.videoDirection, /Transition to Market Square with Larisa Brass/);
    assert.match(layers.videoDirection, /Larisa Brass \| Director of Innovation/);
    assert.match(layers.videoDirection, /Tight shot interacting/);
    assert.match(layers.videoDirection, /Knoxville Chamber logo/);
    assert.match(layers.videoDirection, /City ambience/);
  });

  it("reads a VISUAL / CAMERA shot list beside a Voiceover block", () => {
    const layers = parseBriefLayers(KNOX_SECTION_BRIEF);
    assert.match(layers.spoken, /You didn't build your business in a vacuum/);
    assert.match(layers.spoken, /Join us today/);
    assert.doesNotMatch(layers.spoken, /Open on downtown Knoxville/);
    assert.match(layers.videoDirection, /Open on downtown Knoxville skyline/);
    assert.match(layers.videoDirection, /End card: Knoxville Chamber logo/);
    assert.doesNotMatch(layers.spoken, /Open on downtown/);
  });

  it("does not rewrite spoken VO when composing a stored brief", () => {
    const layers = parseBriefLayers(KNOX_BRACKET_BRIEF);
    const stored = composeStoredBrief(layers.spoken, layers.videoDirection);
    assert.match(stored, /You didn't build your business in a vacuum/);
    assert.match(stored, /Join us today/);
    assert.equal(extractSpokenVoiceover(stored), layers.spoken);
    assert.match(extractVideoDirection(stored), /Open on downtown Knoxville skyline/);
  });

  it("leaves a normal talking-head brief as spoken-only", () => {
    const brief = "I'm Alan. We build pools in Heber City, Utah. Call us today.";
    const layers = parseBriefLayers(brief);
    assert.equal(layers.spoken, brief);
    assert.equal(layers.videoDirection, "");
    assert.equal(layers.hasVisualDirection, false);
    assert.equal(looksLikeShotList("Match Alan's face and the real pool. Minimal on-screen text."), false);
  });

  it("does not steal spoken idioms like Open your doors", () => {
    const brief = "Open your doors to neighbors. Cut to the chase — call us today.";
    const layers = parseBriefLayers(brief);
    assert.match(layers.spoken, /Open your doors/);
    assert.match(layers.spoken, /Cut to the chase/);
    assert.equal(layers.hasVisualDirection, false);
  });
});

describe("video prompt includes the shot list", () => {
  it("weights the beat sheet on the video call and keeps spoken copy verbatim", () => {
    const visual = extractVideoDirection(KNOX_BRACKET_BRIEF);
    const spoken = extractSpokenVoiceover(KNOX_BRACKET_BRIEF);
    const motion = applyVideoDirection(
      motionScriptInstruction(spoken, "minimal-endcard"),
      "video",
      visual,
    );
    assert.match(motion, /Speak this script verbatim/);
    assert.match(motion, /You didn't build your business in a vacuum/);
    assert.match(motion, /Join us today/);
    assert.match(motion, /SECOND PASS VIDEO — VISUAL SHOT LIST/);
    assert.match(motion, /Open on downtown Knoxville skyline/);
    assert.match(motion, /Transition to Market Square with Larisa Brass/);
    assert.match(motion, /Tight shot interacting/);
    assert.match(motion, /KnoxvilleChamber\.com/);
    assert.match(motion, /do not rewrite the voiceover/i);
    assert.match(pictureContinuityInstruction(visual), /Directed transitions are required/);
    assert.doesNotMatch(pictureContinuityInstruction(visual), /ONE CONTINUOUS SHOT/);
  });

  it("keeps the still pass free of shot-list captions", () => {
    const visual = extractVideoDirection(KNOX_SECTION_BRIEF);
    const spoken = extractSpokenVoiceover(KNOX_SECTION_BRIEF);
    const still = applyVideoDirection(spokenScriptInstruction(spoken, "minimal-endcard"), "still", visual);
    assert.match(still, /You didn't build your business/);
    assert.match(still, /FIRST PASS STILL — opening frame only/);
    assert.match(still, /Open on downtown Knoxville skyline/);
    assert.match(still, /Do not letter the visual shot list/);
    assert.match(still, /Do not invent phone numbers, digits, addresses, or gibberish lettering/);
    assert.doesNotMatch(still, /SECOND PASS VIDEO/);
    assert.equal(stillUsesDirectedOpening(visual), true);
    const hint = stillOpeningHint(visual);
    assert.doesNotMatch(hint, /Captions match/);
    assert.match(hint, /not captions/);
    assert.match(hint, /Do not invent phone numbers/);
    assert.ok((videoShotListInstruction(visual).match(/Transition to Market Square/g) ?? []).length >= 1);
  });

  it("resolves explicit videoDirection over a parsed brief, then stored, then shot-list direction", () => {
    assert.equal(
      resolveVideoDirection({
        explicit: "Open on the riverfront.",
        brief: KNOX_BRACKET_BRIEF,
        stored: "old stored list",
      }),
      "Open on the riverfront.",
    );
    assert.equal(
      resolveVideoDirection({ stored: "Open on the riverfront.", brief: KNOX_BRACKET_BRIEF }),
      "Open on the riverfront.",
    );
    assert.match(
      resolveVideoDirection({ brief: KNOX_BRACKET_BRIEF }),
      /Open on downtown Knoxville skyline/,
    );
    assert.match(
      resolveVideoDirection({
        operatorDirection: "[VISUAL:] Tight shot at Market Square",
      }),
      /Tight shot at Market Square/,
    );
    assert.equal(
      resolveVideoDirection({
        operatorDirection: "Minimal on-screen text — business name and city only.",
      }),
      "",
    );
  });

  it("reads bot aliases for videoDirection", () => {
    assert.equal(readVideoDirectionField({ videoDirection: "Open on the skyline." }), "Open on the skyline.");
    assert.equal(readVideoDirectionField({ shot_list: "Tight shot, then end card." }), "Tight shot, then end card.");
    assert.equal(readVideoDirectionField({ cameraDirection: "Handheld follow." }), "Handheld follow.");
    assert.equal(readVideoDirectionField({ direction: "Match the face." }), undefined);
  });
});
