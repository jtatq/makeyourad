import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  imageGenerationAttempts,
  keepsReferences,
  preferredRefSource,
  rankReferenceAssets,
  referencePromptBlock,
} from "./generate-refs.ts";

describe("reference ranking", () => {
  it("puts owner and job-site photos ahead of a logo", () => {
    const ranked = rankReferenceAssets(
      [
        { kind: "logo", filename: "logo.png" },
        { kind: "upload", filename: "pool-3.jpg" },
        { kind: "upload", filename: "alan-owner.jpg" },
        { kind: "still", filename: "hook-gen.jpg" },
      ],
      false,
    );
    assert.deepEqual(
      ranked.map((a) => a.filename),
      ["alan-owner.jpg", "pool-3.jpg", "logo.png"],
    );
  });

  it("prefers stored data URLs over signed http file links", () => {
    assert.equal(
      preferredRefSource({
        data_url: "data:image/jpeg;base64,abc",
        external_url: "https://mya.geotargetus.dev/api/files/ast_1?exp=1&sig=x",
      }),
      "data",
    );
    assert.equal(preferredRefSource({ data_url: null, external_url: "https://cdn.example/p.jpg" }), "http");
    assert.equal(preferredRefSource({ data_url: null, external_url: "http://127.0.0.1:8080/api/files/ast_1" }), null);
  });
});

describe("image edit attempts", () => {
  it("never falls back to text-only generations when references exist", () => {
    const attempts = imageGenerationAttempts(["data:image/jpeg;base64,aaa", "data:image/jpeg;base64,bbb"]);
    assert.ok(attempts.length >= 2);
    assert.ok(attempts.every((a) => a.path === "/images/edits"));
    assert.ok(attempts.every(keepsReferences));
    assert.equal(
      attempts.some((a) => a.path === "/images/generations"),
      false,
    );
  });

  it("retries with fewer images before giving up, still as edits", () => {
    const refs = ["a", "b", "c", "d"];
    const attempts = imageGenerationAttempts(refs);
    const sizes = attempts.map((a) => (Array.isArray(a.image) ? a.image.length : 1));
    assert.ok(sizes.includes(4) || sizes.includes(5));
    assert.ok(sizes.includes(3));
    assert.ok(sizes.includes(1));
    assert.ok(attempts.every((a) => a.path === "/images/edits"));
  });

  it("uses generations only when there are no references", () => {
    const attempts = imageGenerationAttempts([]);
    assert.ok(attempts.every((a) => a.path === "/images/generations"));
    assert.ok(attempts.every((a) => !keepsReferences(a)));
  });

  it("names each attached photo in the still prompt", () => {
    const block = referencePromptBlock([
      { kind: "upload", filename: "alan-owner.jpg" },
      { kind: "upload", filename: "pool-1.jpg" },
    ]);
    assert.match(block, /REFERENCE PHOTOS ARE ATTACHED/);
    assert.match(block, /Image 1 \(upload\): alan-owner.jpg/);
    assert.match(block, /Image 2 \(upload\): pool-1.jpg/);
    assert.match(block, /do not add one/i);
    assert.match(block, /rectangular in-ground pool/);
  });
});
