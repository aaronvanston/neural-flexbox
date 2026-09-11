export const JUSTIFY = [
  "flex-start",
  "flex-end",
  "center",
  "space-between",
  "space-around",
  "space-evenly",
];
export function features(c, version = 1) {
  if (![1, 2, 3, 4].includes(version))
    throw new Error(`Unsupported feature version: ${version}`);
  if (version === 4) {
    const free =
      c.width -
      c.gap * (c.items.length - 1) -
      c.items.reduce((s, a) => s + a.basis, 0);
    const grows = c.items.some((a) => a.grow > 0);
    c = {
      ...c,
      justify: free >= 0 && grows ? "flex-start" : c.justify,
      items: c.items.map((a) =>
        free >= 0 ? { ...a, shrink: 1 } : { ...a, grow: 0 },
      ),
    };
  }
  let basis = 0,
    grow = 0,
    shrink = 0;
  const totals = c.items.reduce(
    (s, a) => [s[0] + a.basis, s[1] + a.grow, s[2] + a.basis * a.shrink],
    [0, 0, 0],
  );
  return c.items.map((a, i) => {
    const f = [
      c.width / 1000,
      c.gap / 100,
      c.items.length / 8,
      ...JUSTIFY.map((j) => Number(j === c.justify)),
      a.basis / 400,
      a.grow / 3,
      a.shrink,
      i / 8,
      totals[0] / 1600,
      totals[1] / 24,
      totals[2] / 1600,
      basis / 1600,
      grow / 24,
      shrink / 1600,
    ];
    if (version >= 2) {
      const scale = f[0];
      for (const j of [0, 1, 9, 13, 15, 16, 18]) f[j] /= scale;
    }
    if (version >= 3)
      f.push(
        (c.gap * (c.items.length - 1)) / c.width,
        (c.gap * i) / c.width,
        Number(totals[1] > 0),
        Number(totals[2] > 0),
      );
    basis += a.basis;
    grow += a.grow;
    shrink += a.basis * a.shrink;
    return f;
  });
}
// Compile once: contiguous coefficients and reusable scratch buffers, same arithmetic order.
export function compilePredictor(model) {
  const layers = model.layers.map(({ weight, bias }) => ({
    weight: Float64Array.from(weight.flat()),
    bias: Float64Array.from(bias),
    columns: weight[0].length,
    rows: bias.length,
  }));
  const size = Math.max(...layers.map((l) => Math.max(l.columns, l.rows)));
  const a = new Float64Array(size),
    b = new Float64Array(size);
  return (c) =>
    features(c, model.featureVersion ?? 1).map((input) => {
      if (!input.every(Number.isFinite))
        throw new RangeError(
          "Layout dimensions cannot be represented numerically",
        );
      a.set(input);
      let source = a,
        target = b;
      for (let k = 0; k < layers.length; k++) {
        const l = layers[k];
        for (let i = 0; i < l.rows; i++) {
          let sum = l.bias[i],
            offset = i * l.columns;
          for (let j = 0; j < l.columns; j++)
            sum += l.weight[offset + j] * source[j];
          target[i] = k === layers.length - 1 ? sum : Math.max(0, sum);
        }
        [source, target] = [target, source];
      }
      return { x: source[0] * c.width, width: source[1] * c.width };
    });
}
