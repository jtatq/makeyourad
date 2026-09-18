import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectReferencesFromBody,
  inferReferenceKind,
  materializeReference,
  parseAppAssetId,
  parseGenerateFlag,
  parseOperatorJobForm,
  parseOperatorJobJson,
} from "./operator-refs.ts";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("operator bot reference parsing", () => {
  it("reads JSON profile plus dataUrl references", () => {
    const payload = parseOperatorJobJson({
      profile: "Business Name: Alan's Pool Service\n".repeat(8),
      generate: true,
      direction: "Use Alan's face and the real pool.",
      references: [
        { filename: "alan-owner.jpg", mime: "image/jpeg", dataUrl: TINY_PNG, kind: "upload" },
        { filename: "pool-1.jpg", dataUrl: TINY_PNG },
        { filename: "logo.png", dataUrl: TINY_PNG },
      ],
    });
    assert.equal(payload.generate, true);
    assert.equal(payload.direction, "Use Alan's face and the real pool.");
    assert.equal(payload.videoDirection, undefined);
    assert.equal(payload.references.length, 3);
    assert.equal(payload.references[0]?.filename, "alan-owner.jpg");
    assert.equal(payload.references[2]?.kind, "logo");
  });

  it("accepts photos[] and upload-then-attach /api/files URLs", () => {
    const payload = parseOperatorJobJson({
      profile: "x".repeat(50),
      photos: [
        "https://mya.geotargetus.dev/api/files/ast_abc123def456?exp=1&sig=aa",
        { url: "/api/files/ast_ownerhead01", filename: "alan.jpg" },
      ],
    });
    assert.equal(payload.references.length, 2);
    assert.equal(payload.references[0]?.assetId, "ast_abc123def456");
    assert.equal(payload.references[1]?.assetId, "ast_ownerhead01");
    assert.equal(payload.references[1]?.filename, "alan.jpg");
  });

  it("parses multipart profile + image files", async () => {
    const bytes = Buffer.from(TINY_PNG.split(",")[1] ?? "", "base64");
    const form = new FormData();
    form.set("profile", "Business Name: Alan's Pool Service\nCity: Heber City\n" + "x".repeat(40));
    form.set("generate", "true");
    form.set(
      "references",
      new File([bytes], "alan-owner.jpg", { type: "image/jpeg" }),
    );
    form.append("references", new File([bytes], "pool-1.jpg", { type: "image/jpeg" }));
    form.set("logo", new File([bytes], "company-logo.png", { type: "image/png" }));

    const payload = await parseOperatorJobForm(form);
    assert.match(payload.profile, /Alan's Pool Service/);
    assert.equal(payload.generate, true);
    assert.equal(payload.references.length, 3);
    assert.equal(payload.references[0]?.filename, "alan-owner.jpg");
    assert.equal(payload.references[2]?.kind, "logo");
    assert.ok(payload.references[0]?.dataUrl?.startsWith("data:image/"));
  });

  it("materializes a data URL for generation without requiring a public host", async () => {
    const ready = await materializeReference({
      filename: "pool-3.jpg",
      mime: "image/png",
      dataUrl: TINY_PNG,
      kind: "upload",
    });
    assert.equal(ready.kind, "upload");
    assert.ok(ready.dataUrl?.startsWith("data:image/"));
    assert.equal(ready.externalUrl, null);
    assert.equal(ready.assetId, undefined);
  });

  it("links an existing app upload by asset id", async () => {
    const ready = await materializeReference({
      filename: "alan.jpg",
      url: "https://mya.geotargetus.dev/api/files/ast_linkedphoto1?exp=9&sig=z",
    });
    assert.equal(ready.assetId, "ast_linkedphoto1");
    assert.equal(ready.dataUrl, null);
  });
});

describe("operator ref helpers", () => {
  it("parses app file URLs and bare asset ids", () => {
    assert.equal(parseAppAssetId("ast_abc123xyz789"), "ast_abc123xyz789");
    assert.equal(parseAppAssetId("/api/files/ast_ownerhead01"), "ast_ownerhead01");
    assert.equal(
      parseAppAssetId("https://mya.geotargetus.dev/api/files/ast_pooljob0001?exp=1&sig=x"),
      "ast_pooljob0001",
    );
    assert.equal(parseAppAssetId("https://example.com/photo.jpg"), null);
  });

  it("infers logo vs upload from the filename", () => {
    assert.equal(inferReferenceKind("Logo.PNG"), "logo");
    assert.equal(inferReferenceKind("pool-1.jpg"), "upload");
    assert.equal(inferReferenceKind("face.jpg", "logo"), "logo");
  });

  it("reads videoDirection / shotList aliases without rewriting spoken profile", () => {
    const profile = [
      "Business Name: Knoxville Chamber",
      "You didn't build your business in a vacuum. Join us today.",
      "[VISUAL:] Open on downtown Knoxville skyline",
    ].join("\n");
    const payload = parseOperatorJobJson({
      profile,
      generate: true,
      direction: "Minimal on-screen text — business name and city only.",
      videoDirection:
        "Open on downtown Knoxville skyline\nTransition to Market Square with Larisa Brass\nEnd card: Knoxville Chamber logo + KnoxvilleChamber.com",
    });
    assert.match(payload.profile, /You didn't build your business/);
    assert.equal(payload.direction, "Minimal on-screen text — business name and city only.");
    assert.match(payload.videoDirection ?? "", /Open on downtown Knoxville skyline/);
    assert.match(payload.videoDirection ?? "", /KnoxvilleChamber\.com/);
    const aliased = parseOperatorJobJson({
      profile,
      shot_list: "Tight shot interacting / modern workspace",
    });
    assert.equal(aliased.videoDirection, "Tight shot interacting / modern workspace");
  });

  it("reads explicit endCard / lowerThird without rewriting spoken profile", () => {
    const profile = [
      "Business Name: Knoxville Chamber",
      "You didn't build your business in a vacuum. Join us today.",
    ].join("\n");
    const payload = parseOperatorJobJson({
      profile,
      generate: true,
      endCard: ["Knoxville Chamber", "Innovation. Prosperity. Knoxville.", "KnoxvilleChamber.com"],
      lowerThird: "Larisa Brass | Director of Innovation",
    });
    assert.match(payload.profile, /You didn't build your business/);
    assert.deepEqual(payload.endCard, [
      "Knoxville Chamber",
      "Innovation. Prosperity. Knoxville.",
      "KnoxvilleChamber.com",
    ]);
    assert.deepEqual(payload.lowerThird, ["Larisa Brass", "Director of Innovation"]);
    assert.equal(payload.textOverlay?.endCard?.lines[0], "Knoxville Chamber");
  });

  it("uses note as remake direction when direction is omitted", () => {
    const payload = parseOperatorJobJson({
      profile: "x".repeat(50),
      note: "Match the attached owner and the real pool.",
      generate: false,
    });
    assert.equal(payload.direction, "Match the attached owner and the real pool.");
    assert.equal(payload.generate, false);
  });

  it("treats generate=false from JSON or multipart strings", () => {
    assert.equal(parseGenerateFlag(false), false);
    assert.equal(parseGenerateFlag("false"), false);
    assert.equal(parseGenerateFlag("0"), false);
    assert.equal(parseGenerateFlag(undefined, true), true);
    assert.equal(parseGenerateFlag("true"), true);
  });

  it("collects at most eight references", () => {
    const refs = collectReferencesFromBody({
      references: Array.from({ length: 12 }, (_, i) => ({
        filename: `p-${i}.jpg`,
        dataUrl: TINY_PNG,
      })),
    });
    assert.equal(refs.length, 8);
  });
});
