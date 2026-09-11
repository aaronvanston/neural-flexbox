import { decodeModel } from "./model.js";
import { compilePredictor, JUSTIFY } from "./features.js";
export const modelInfo = Object.freeze({
  version: "refined-v1",
  parameters: 36354,
  featureVersion: 4,
  weightBytes: 39840,
  brotliBytes: 33801,
  meanErrorPx: 0.3503970503807068,
  p95ErrorPx: 1.0836013555526733,
  maxErrorPx: 13.962357521057129,
  trainingLayouts: 152000,
  testLayouts: 5000,
});
const weightsURL = new URL(
  "../model/weights-cf4acc1ceb2d3df3.bin",
  import.meta.url,
);
function validate(c) {
  if (
    !c ||
    !Number.isFinite(c.width) ||
    c.width <= 0 ||
    !Number.isFinite(c.gap) ||
    c.gap < 0 ||
    !JUSTIFY.includes(c.justify) ||
    !Array.isArray(c.items) ||
    c.items.length < 1 ||
    c.items.length > 8
  )
    throw new RangeError(
      "Expected positive finite width, nonnegative finite gap, a supported justify mode and 1–8 items.",
    );
  for (const a of c.items)
    if (
      !a ||
      !Number.isInteger(a.basis) ||
      a.basis < 20 ||
      a.basis > 320 ||
      !Number.isInteger(a.grow) ||
      a.grow < 0 ||
      a.grow > 3 ||
      ![0, 1].includes(a.shrink)
    )
      throw new RangeError(
        "Expected integer basis 20–320, integer grow 0–3 and shrink 0 or 1.",
      );
}
/** Load weights once and return a synchronous, reusable predictor. */
export async function createLayoutPredictor({ weights } = {}) {
  let buffer = weights;
  if (buffer === undefined) {
    if (weightsURL.protocol === "file:") {
      const { readFile } = await import("node:fs/promises");
      const bytes = await readFile(weightsURL);
      buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
    } else {
      const response = await fetch(weightsURL);
      if (!response.ok)
        throw new Error(`Model download failed (${response.status}).`);
      buffer = await response.arrayBuffer();
    }
  }
  if (!(buffer instanceof ArrayBuffer))
    throw new TypeError("weights must be an ArrayBuffer");
  const model = decodeModel(buffer);
  if (model.featureVersion !== 4)
    throw new Error("Expected refined-v1 feature version 4");
  const infer = compilePredictor(model);
  return (config) => {
    validate(config);
    return infer(config);
  };
}
export { JUSTIFY };
