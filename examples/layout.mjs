import { createLayoutPredictor } from "../packages/core/src/index.js";

const predict = await createLayoutPredictor();
const boxes = predict({
  width: 760,
  gap: 16,
  justify: "space-between",
  items: [
    { basis: 120, grow: 1, shrink: 1 },
    { basis: 200, grow: 2, shrink: 1 },
  ],
});

console.log(
  JSON.stringify(
    boxes.map(({ x, width }) => ({
      x: Number(x.toFixed(3)),
      width: Number(width.toFixed(3)),
    })),
    null,
    2,
  ),
);
