import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { decodeModel } from "../../core/src/model.js";
const run = process.argv[2];
if (!run) throw new Error("Usage: node training/package-model.mjs <run-name>");
const dir = resolve("packages/training/runs", run);
const raw = await readFile(`${dir}/weights.bin`);
const decoded = decodeModel(
  raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
);
assert.deepEqual(
  decoded,
  JSON.parse(await readFile(`${dir}/weights.json`, "utf8")),
);
const hash = createHash("sha256").update(raw).digest("hex");
const file = `weights-${hash.slice(0, 16)}.bin`;
const br = brotliCompressSync(raw),
  gz = gzipSync(raw);
for (const [suffix, data] of [
  ["", raw],
  [".br", br],
  [".gz", gz],
])
  await writeFile(`${dir}/${file}${suffix}`, data);
const report = {
  file,
  format: `NFLX-v${raw[4]}`,
  sha256: hash,
  bytes: raw.length,
  brotliBytes: br.length,
  gzipBytes: gz.length,
};
await writeFile(`${dir}/runtime.json`, JSON.stringify(report, null, 2));
console.log(report);
