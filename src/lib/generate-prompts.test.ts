import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  composeMotionPrompt,
  composeStillPrompt,
  continuityLine,
  type PromptPacket,
} from "./generate-prompts.ts";
import {
  IMAGE_STILL_PROMPT_BUDGET,
  IMAGE_STILL_PROMPT_HARD_MAX,
  onScreenTypeGuard,
} from "./generate-direction.ts";
import { referencePromptBlock } from "./generate-refs.ts";
import { specFromFields } from "./text-overlay.ts";
import { recipeSlots, recipeSummary } from "./recipe.ts";

const VO =
  "You didn't build your business in a vacuum. You built it with grit, neighbors, and a city that shows up. " +
  "Join the Knoxville Chamber and find the people who will help you grow. We are here for the next hire, " +
  "the next location, and the next decade. Come see us downtown and get to work with neighbors who care. " +
  "This city rewards people who show up, and we will be there when you do.";

assert.ok(
  VO.length >= 380 && VO.length <= 520,
  `fixture VO should be ~400 chars, got ${VO.length}`,
);

const OVERLAY = specFromFields(
  ["Knoxville Chamber", "Innovation. Prosperity. Knoxville.", "KnoxvilleChamber.com"],
  "Larisa Brass | Director of Innovation",
);

function knoxPacket(refCount = 0): PromptPacket {
  const assets = Array.from({ length: refCount }, (_, i) => ({
    kind: "upload",
    filename: i === 0 ? "larisa.jpg" : `site-${i}.jpg`,
  }));
  return {
    intake: {
      businessName: "Knoxville Chamber",
      category_label: "Chamber of commerce",
      city: "Knoxville",
      state: "TN",
      phone: "See website",
      brief: VO,
      tone: "trustworthy",
    },
    website_profile: null,
    recipe: { structure: recipeSummary("video-20", false, "trustworthy") },
    assets,
    script: VO,
  };
}

describe("still prompt budget", () => {
  it("keeps an overlay end-card still under the 3500-char budget (headroom under 4096)", () => {
    const packet = knoxPacket(4);
    const slot = recipeSlots({ productId: "video-20", mascot: false })[0];
    assert.equal(slot.id, "hook");
    const direction = "Minimal on-screen text — business name and city only.";
    const visual =
      "Open on downtown Knoxville skyline\nEnd card: Knoxville Chamber / Innovation. Prosperity. Knoxville. / KnoxvilleChamber.com";
    const still = composeStillPrompt(packet, slot, "9:16", direction, visual, OVERLAY);
    const guard = onScreenTypeGuard(packet.intake.phone, OVERLAY);
    const guardHits = still.split(guard).length - 1;
    assert.equal(guardHits, 1, `type guard should appear once, found ${guardHits}\n${still}`);
    assert.match(still, /Clean plate — no phones, digits, or invented type/);
    assert.match(still, /composited after generation/);
    assert.match(still, /blank plate with no words, letters, logos, or URLs/);
    assert.match(still, /You didn't build your business in a vacuum/);
    assert.doesNotMatch(still, /super name and city/i);
    assert.doesNotMatch(still, /business name and city only/i);
    assert.doesNotMatch(still, /Innovation\. Prosperity\. Knoxville/);
    assert.doesNotMatch(still, /KnoxvilleChamber\.com/);
    assert.doesNotMatch(still, /865-555-0100|555-0100/);
    const motion = composeMotionPrompt(packet, slot, 15, VO, direction, visual, OVERLAY, "imagine");
    assert.match(motion, /You didn't build your business in a vacuum/);
    assert.match(motion, /blank plate/i);
    assert.doesNotMatch(motion, /super name and city/i);
    assert.doesNotMatch(motion, /Innovation\. Prosperity\. Knoxville/);
    assert.doesNotMatch(motion, /KnoxvilleChamber\.com/);
    assert.doesNotMatch(motion, /named lower-thirds/);
    const lettered = composeStillPrompt(knoxPacket(0), slot, "9:16");
    assert.match(lettered, /super name and city/i);
    assert.ok(
      still.length <= IMAGE_STILL_PROMPT_BUDGET,
      `still prompt ${still.length} exceeds budget ${IMAGE_STILL_PROMPT_BUDGET}`,
    );

    const sentToModel = `${still}\n${referencePromptBlock(packet.assets)}`;
    assert.ok(
      sentToModel.length < IMAGE_STILL_PROMPT_HARD_MAX,
      `still+refs ${sentToModel.length} exceeds hard max ${IMAGE_STILL_PROMPT_HARD_MAX}`,
    );

    const tiny = composeStillPrompt(knoxPacket(0), slot, "9:16", direction, "", OVERLAY);
    assert.ok(tiny.length < still.length);
    assert.ok(tiny.length <= IMAGE_STILL_PROMPT_BUDGET);

    const extra = continuityLine(packet, direction, visual, OVERLAY);
    assert.equal(extra.split(guard).length - 1, 1);
    console.log(
      `measured still prompt: ${still.length} chars (budget ${IMAGE_STILL_PROMPT_BUDGET}, hard max ${IMAGE_STILL_PROMPT_HARD_MAX}); with extra ref block ${sentToModel.length}`,
    );
  });
});
