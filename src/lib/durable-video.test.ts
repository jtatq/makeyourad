import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  durablePlaybackUrl,
  fileServePlan,
  isEphemeralGeneratorUrl,
  planFinishedVideo,
  presentGeneration,
  publicAssetUrl,
  publicExternalUrl,
} from "./durable-video.ts";

const ORIGIN = "https://mya.geotargetus.dev";
const VIDGEN = "https://vidgen.x.ai/v1/files/req_abc/video.mp4?exp=1";
const OVERLAY = "data:video/mp4;base64,b3ZlcmxheQ==";

describe("durable video urls", () => {
  it("recognizes vidgen.x.ai and not MYA file hosts", () => {
    assert.equal(isEphemeralGeneratorUrl(VIDGEN), true);
    assert.equal(isEphemeralGeneratorUrl("https://cdn.vidgen.x.ai/clip.mp4"), true);
    assert.equal(isEphemeralGeneratorUrl("https://mya.geotargetus.dev/api/files/ast_1?exp=1&sig=x"), false);
    assert.equal(isEphemeralGeneratorUrl("https://api.x.ai/v1/videos/req"), false);
    assert.equal(isEphemeralGeneratorUrl(OVERLAY), false);
  });

  it("stores the generator file when no overlay ran", () => {
    const plan = planFinishedVideo({ generatorUrl: VIDGEN, overlaidApplied: false });
    assert.equal(plan.dataUrl, null);
    assert.equal(plan.fetchUrl, VIDGEN);
    assert.equal(plan.externalUrl, VIDGEN);
  });

  it("stores the post-overlay mp4 and does not refetch the generator file", () => {
    const plan = planFinishedVideo({
      generatorUrl: VIDGEN,
      overlaidApplied: true,
      overlaidDataUrl: OVERLAY,
      providedDataUrl: "data:video/mp4;base64,cHJl",
    });
    assert.equal(plan.dataUrl, OVERLAY);
    assert.equal(plan.fetchUrl, null);
    assert.equal(plan.externalUrl, VIDGEN);
  });

  it("keeps caller bytes when the imagine worker already uploaded the mp4", () => {
    const plan = planFinishedVideo({
      generatorUrl: "https://cdn.example/take.mp4",
      overlaidApplied: false,
      providedDataUrl: "data:video/mp4;base64,dXBsb2Fk",
    });
    assert.equal(plan.dataUrl, "data:video/mp4;base64,dXBsb2Fk");
    assert.equal(plan.fetchUrl, null);
    assert.equal(plan.externalUrl, null);
  });

  it("refuses an overlay that did not produce a file", () => {
    assert.throws(
      () => planFinishedVideo({ generatorUrl: VIDGEN, overlaidApplied: true, overlaidDataUrl: null }),
      /Overlay finished without a video file/,
    );
  });

  it("serves stored bytes instead of redirecting to a generator url", () => {
    assert.equal(fileServePlan({ data_url: OVERLAY, external_url: VIDGEN }), "bytes");
    assert.equal(fileServePlan({ data_url: null, external_url: VIDGEN }), "redirect");
    assert.equal(fileServePlan({ data_url: null, external_url: null }), "missing");
  });

  it("never publishes vidgen once the mp4 bytes exist", () => {
    const url = publicAssetUrl({
      origin: ORIGIN,
      assetId: "ast_hook01",
      mime: "video/mp4",
      hasData: true,
      externalUrl: VIDGEN,
      inlineDataUrl: OVERLAY,
    });
    assert.ok(url);
    assert.match(url, /^https:\/\/mya\.geotargetus\.dev\/api\/files\/ast_hook01\?/);
    assert.equal(url.includes("vidgen.x.ai"), false);
    assert.equal(publicExternalUrl(VIDGEN, true), null);
    assert.equal(publicExternalUrl(VIDGEN, false), VIDGEN);
  });

  it("leaves a relative delivery path and a normal image cdn url alone", () => {
    assert.equal(
      publicAssetUrl({
        origin: ORIGIN,
        assetId: "ast_seed",
        mime: "video/mp4",
        hasData: false,
        externalUrl: "/examples/dental.jpg",
      }),
      "/examples/dental.jpg",
    );
    assert.equal(
      publicAssetUrl({
        origin: ORIGIN,
        assetId: "ast_photo",
        mime: "image/jpeg",
        hasData: true,
        externalUrl: "https://cdn.example/pool.jpg",
        inlineDataUrl: "data:image/jpeg;base64,abc",
      }),
      "https://cdn.example/pool.jpg",
    );
  });

  it("rewrites job video fields to the stored file and leaves jobs that were never copied", () => {
    const swapped = durablePlaybackUrl(VIDGEN, ["ast_hook01"], [
      { id: "ast_hook01", mime: "video/mp4", hasData: true, externalUrl: VIDGEN },
    ], ORIGIN);
    assert.match(String(swapped), /\/api\/files\/ast_hook01\?/);
    assert.equal(
      durablePlaybackUrl(VIDGEN, ["ast_hook01"], [
        { id: "ast_hook01", mime: "video/mp4", hasData: false, externalUrl: VIDGEN },
      ], ORIGIN),
      VIDGEN,
    );

    const job = presentGeneration(
      {
        masterUrl: OVERLAY,
        mascotUrl: undefined,
        slots: [{ id: "hook", videoUrl: VIDGEN, assetIds: ["ast_hook01"] }],
        timeline: [{ url: VIDGEN, slotId: "hook", label: "Hook" }],
      },
      [
        { id: "ast_hook01", mime: "video/mp4", data_url: "data:video/mp4;base64,aG9vaw==", external_url: VIDGEN },
        { id: "ast_master", mime: "video/mp4", data_url: OVERLAY, external_url: null },
      ],
      ORIGIN,
    );
    assert.match(job.slots[0].videoUrl ?? "", /\/api\/files\/ast_hook01\?/);
    assert.match(job.timeline?.[0].url ?? "", /\/api\/files\/ast_hook01\?/);
    assert.match(job.masterUrl ?? "", /\/api\/files\/ast_master\?/);
    assert.equal(JSON.stringify(job).includes("vidgen.x.ai"), false);
  });
});
