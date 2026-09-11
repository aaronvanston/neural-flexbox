import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { features, JUSTIFY } from "../../core/src/features.js";
const extra = process.argv.includes("--extra");
const compression = process.argv.includes("--compression-test");
const fresh = process.argv.includes("--fresh-test") || compression;
if (extra && fresh)
  throw new Error("Choose extra training or fresh test generation");
const seed = compression
  ? 20260923
  : fresh
    ? 20260917
    : extra
      ? 20260913
      : 20260911;
let state = seed;
const random = () => {
  state = (Math.imul(1664525, state) + 1013904223) >>> 0;
  return state / 4294967296;
};
const int = (a, b) => a + Math.floor(random() * (b - a + 1));
const make = (ood = false) => ({
  width: int(ood ? 1300 : 240, ood ? 1800 : 1200),
  gap: int(0, 40),
  justify: JUSTIFY[int(0, 5)],
  items: Array.from({ length: int(1, 8) }, () => ({
    basis: int(20, 320),
    grow: random() < 0.55 ? 0 : int(1, 3),
    shrink: random() < 0.15 ? 0 : 1,
  })),
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(
    '<style>*{box-sizing:border-box}body{margin:0}</style><div id="host"></div>',
  );
  await mkdir("data", { recursive: true });
  const manifest = {
    seed,
    teacher: `Chromium ${browser.version()}`,
    features: 1,
    splits: {},
  };
  for (const [split, count, ood] of fresh
    ? [[compression ? "test-compression" : "test-fresh", 5000, false]]
    : extra
      ? [["train-extra", 96000, false]]
      : [
          ["train", 24000, false],
          ["validation", 2000, false],
          ["test", 2000, false],
          ["ood", 1000, true],
        ]) {
    const records = [];
    for (let start = 0; start < count; start += 200) {
      const configs = Array.from({ length: Math.min(200, count - start) }, () =>
        make(ood),
      );
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
      }, configs);
      records.push(
        ...configs.map((config, i) => ({
          config,
          input: features(config),
          target: labels[i].map((r) => r.map((v) => v / config.width)),
        })),
      );
    }
    const json = JSON.stringify(records);
    await writeFile(`data/${split}.json`, json);
    manifest.splits[split] = {
      layouts: count,
      sha256: createHash("sha256").update(json).digest("hex"),
    };
    console.log(`${split}: ${count} browser-measured layouts`);
  }
  await writeFile(
    compression
      ? "data/test-compression-manifest.json"
      : fresh
        ? "data/test-fresh-manifest.json"
        : extra
          ? "data/train-extra-manifest.json"
          : "data/manifest.json",
    JSON.stringify(manifest, null, 2),
  );
} finally {
  await browser.close();
}
