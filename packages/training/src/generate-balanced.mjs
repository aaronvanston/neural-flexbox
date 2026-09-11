// Independent, browser-labeled regimes and invariant pairs. No validation examples are replayed.
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { features, JUSTIFY } from "../../core/src/features.js";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(
    '<style>*{box-sizing:border-box}body{margin:0}</style><div id="host"></div>',
  );
  await mkdir("data", { recursive: true });
  for (const [split, count, seed, balanced] of [
    ["train-balanced", 32000, 20261001, true],
    ["validation-balanced", 4000, 20261002, true],
    ["test-balanced-natural", 5000, 20261003, false],
  ]) {
    let state = seed;
    const random = () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const int = (a, b) => a + Math.floor(random() * (b - a + 1));
    const make = () => ({
      width: int(240, 1200),
      gap: int(0, 40),
      justify: JUSTIFY[int(0, 5)],
      items: Array.from({ length: int(1, 8) }, () => ({
        basis: int(20, 320),
        grow: random() < 0.55 ? 0 : int(1, 3),
        shrink: random() < 0.15 ? 0 : 1,
      })),
    });
    const configs = [];
    while (configs.length < count) {
      let c = make();
      if (balanced) {
        const regime = Math.floor(configs.length / 2) % 4;
        if (regime === 1) c.items.forEach((a) => (a.grow = 0));
        if (regime === 3)
          c.items.forEach((a) => (a.shrink = random() < 0.5 ? 0 : 1));
        const B = c.items.reduce((s, a) => s + a.basis, 0),
          G = c.items.reduce((s, a) => s + a.grow, 0),
          F = c.width - c.gap * (c.items.length - 1) - B;
        const fixed = c.items
          .filter((a) => !a.shrink)
          .reduce((s, a) => s + a.basis, 0);
        const actual =
          F >= 0
            ? G
              ? 0
              : 1
            : fixed + c.gap * (c.items.length - 1) > c.width
              ? 3
              : 2;
        if (actual !== regime) continue;
        configs.push(c);
        const pair = structuredClone(c);
        if (regime === 0) {
          pair.items.forEach((a) => (a.shrink = int(0, 1)));
          pair.justify = JUSTIFY[int(0, 5)];
        } else if (regime === 1)
          pair.items.forEach((a) => (a.shrink = int(0, 1)));
        else pair.items.forEach((a) => (a.grow = int(0, 3)));
        configs.push(pair);
      } else configs.push(c);
    }
    const records = [];
    for (let start = 0; start < count; start += 200) {
      const batch = configs.slice(start, start + 200);
      const labels = await page.evaluate((configs) => {
        const host = document.getElementById("host");
        return configs.map((c) => {
          Object.assign(host.style, {
            display: "flex",
            width: `${c.width}px`,
            gap: `${c.gap}px`,
            justifyContent: c.justify,
          });
          host.replaceChildren(
            ...c.items.map((a) => {
              const e = document.createElement("div");
              Object.assign(e.style, {
                flex: `${a.grow} ${a.shrink} ${a.basis}px`,
                minWidth: "0px",
                height: "10px",
              });
              return e;
            }),
          );
          const left = host.getBoundingClientRect().left;
          return [...host.children].map((e) => {
            const r = e.getBoundingClientRect();
            return [r.left - left, r.width];
          });
        });
      }, batch);
      records.push(
        ...batch.map((config, i) => ({
          config,
          input: features(config),
          target: labels[i].map((v) => v.map((x) => x / config.width)),
        })),
      );
    }
    const raw = JSON.stringify(records),
      sha256 = createHash("sha256").update(raw).digest("hex");
    await writeFile(`data/${split}.json`, raw);
    await writeFile(
      `data/${split}-manifest.json`,
      JSON.stringify(
        {
          seed,
          teacher: `Chromium ${browser.version()}`,
          balanced,
          splits: { [split]: { layouts: count, sha256 } },
        },
        null,
        2,
      ),
    );
    if (balanced) {
      let max = 0;
      for (let i = 0; i < records.length; i += 2)
        records[i].target.forEach((v, j) =>
          v.forEach(
            (x, k) =>
              (max = Math.max(
                max,
                Math.abs(x - records[i + 1].target[j][k]) *
                  records[i].config.width,
              )),
          ),
        );
      if (max > 0.001) throw new Error(`Invariant labels disagree by ${max}`);
    }
    console.log(`${split}: ${count} labeled layouts`);
  }
} finally {
  await browser.close();
}
