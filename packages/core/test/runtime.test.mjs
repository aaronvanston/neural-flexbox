import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createLayoutPredictor, modelInfo } from "../src/index.js";
import { decodeModel } from "../src/model.js";
const fixtures = JSON.parse(
  await readFile(
    new URL("../../training/active/parity.json", import.meta.url),
    "utf8",
  ),
);
test("accepted binary matches recorded hash and PyTorch fixtures", async () => {
  const report = JSON.parse(
    await readFile(
      new URL("../../training/active/report.json", import.meta.url),
      "utf8",
    ),
  );
  const bytes = await readFile(
    new URL("../model/" + report.runtime.file, import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    report.runtime.sha256,
  );
  const infer = await createLayoutPredictor();
  for (const f of fixtures)
    infer(f.config).forEach((b, i) => {
      assert.ok(Math.abs(b.x - f.prediction[i][0]) < 0.002);
      assert.ok(Math.abs(b.width - f.prediction[i][1]) < 0.002);
    });
  assert.equal(modelInfo.parameters, 36354);
});
test("invalid inputs are rejected before inference", async () => {
  const infer = await createLayoutPredictor();
  for (const c of [
    null,
    {},
    { ...fixtures[0].config, width: NaN },
    { ...fixtures[0].config, width: Number.MIN_VALUE },
    { ...fixtures[0].config, items: [] },
    { ...fixtures[0].config, items: [{ basis: 0, grow: 1, shrink: 1 }] },
  ])
    assert.throws(() => infer(c), RangeError);
});
test("irrelevant properties cannot change growing layouts", async () => {
  const infer = await createLayoutPredictor();
  const c = {
    width: 1130,
    gap: 29,
    justify: "space-evenly",
    items: [
      { basis: 137, grow: 1, shrink: 0 },
      { basis: 109, grow: 1, shrink: 0 },
    ],
  };
  assert.deepEqual(
    infer(c),
    infer({
      ...c,
      justify: "flex-start",
      items: c.items.map((i) => ({ ...i, shrink: 1 })),
    }),
  );
});
test("truncated or corrupt artifacts fail closed", () => {
  assert.throws(() => decodeModel(new ArrayBuffer(0)));
  const b = new Uint8Array([78, 70, 76, 88, 2, 4, 8, 4]);
  assert.throws(() => decodeModel(b.buffer));
});
