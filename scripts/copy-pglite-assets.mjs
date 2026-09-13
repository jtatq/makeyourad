#!/usr/bin/env node
/**
 * Vercel/Nitro traces pglite.wasm but not the sibling pglite.data blob
 * Emscripten reads at runtime. Copy both into every serverless function.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "node_modules/@electric-sql/pglite/dist");
const files = ["pglite.data", "pglite.wasm", "initdb.wasm"];
const functionsRoot = join(root, ".vercel/output/functions");

function functionDirs(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) functionDirs(path, acc);
    else if (entry.name === ".vc-config.json") acc.push(dirname(path));
  }
  return acc;
}

if (!existsSync(join(srcDir, "pglite.data"))) {
  console.warn("[pglite] pglite.data missing in node_modules — skip copy");
  process.exit(0);
}

const dirs = functionDirs(functionsRoot);
if (dirs.length === 0) {
  console.warn("[pglite] no Vercel functions to patch");
  process.exit(0);
}

for (const funcDir of dirs) {
  const libs = join(funcDir, "_libs");
  mkdirSync(libs, { recursive: true });
  for (const name of files) {
    const from = join(srcDir, name);
    if (!existsSync(from)) continue;
    copyFileSync(from, join(libs, name));
    copyFileSync(from, join(funcDir, name));
  }
  console.log(`[pglite] copied assets into ${funcDir}`);
}
