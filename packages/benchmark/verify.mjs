import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = process.env.VERIFY_BASE_URL ?? "http://localhost:4174";
const fixtures = JSON.parse(
  await readFile("packages/training/active/parity.json", "utf8"),
);
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() =>
    document.getElementById("error").textContent.includes("mean edge"),
  );
  assert.equal(await page.locator("h1").textContent(), "neural-flexbox");
  assert.equal(await page.locator("nav").count(), 0);
  const parity = await page.evaluate(async (fixtures) => {
    const { createLayoutPredictor } = await import(
      "/packages/core/src/index.js"
    );
    const infer = await createLayoutPredictor();
    let max = 0;
    for (const f of fixtures)
      infer(f.config).forEach((b, i) => {
        max = Math.max(
          max,
          Math.abs(b.x - f.prediction[i][0]),
          Math.abs(b.width - f.prediction[i][1]),
        );
      });
    return max;
  }, fixtures);
  assert.ok(parity < 0.002);
  await page.locator("#reference>.box").first().click();
  await page.locator('[data-grow="3"]').click();
  assert.equal(
    await page.locator('[data-grow="3"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.match(
    await page.locator(".meas").textContent(),
    /Position error.*Width error.*Largest edge error/,
  );
  await page.locator("#add").click();
  assert.equal(await page.locator("#reference>.box").count(), 5);
  for (const m of [
    "flex-start",
    "flex-end",
    "center",
    "space-between",
    "space-around",
    "space-evenly",
  ])
    await page.locator("#justify").selectOption(m);
  const handle = await page.locator("#handleR").boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(1438, handle.y + handle.height / 2, { steps: 12 });
  await page.mouse.up();
  assert.ok(
    await page.evaluate(() => {
      const l = document.getElementById("handleL").getBoundingClientRect(),
        r = document.getElementById("handleR").getBoundingClientRect(),
        b = document.querySelector(".bench").getBoundingClientRect();
      return l.left >= 0 && r.right <= innerWidth && r.right > innerWidth - 4;
    }),
    "Container did not reach the viewport edge",
  );
  await page.locator("#reset").click();
  await page.locator("#reference>.box").first().hover();
  await page.getByRole("button", { name: "Remove box 1", exact: true }).click();
  assert.equal(await page.locator("#reference>.box").count(), 3);
  await page.locator("#reset").click();
  await page.locator('.gut[data-after="0"]').focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowRight");
  assert.equal(
    await page.locator('.gut[data-after="0"]').getAttribute("aria-valuenow"),
    "76",
  );
  assert.ok(
    await page.evaluate(
      () =>
        getComputedStyle(document.getElementById("gutters"))
          .transitionDuration === "0s",
    ),
  );
  await page.locator("#reference>.box").first().hover();
  assert.ok(
    await page.evaluate(() => {
      const tip = document.getElementById("tip").getBoundingClientRect(),
        bar = document.querySelector(".bar").getBoundingClientRect();
      return tip.top >= bar.bottom;
    }),
    "Tooltip overlaps toolbar",
  );
  await page.locator("#reset").click();
  await page.locator("#justify").selectOption("space-between");
  await page.locator("#stage").hover();
  await page.locator('.gut[data-after="0"]').focus();
  for (let i = 0; i < 16; i++) await page.keyboard.press("ArrowLeft");
  assert.equal(
    await page.locator('.gut[data-after="0"]').getAttribute("aria-valuenow"),
    "0",
  );
  assert.equal(await page.locator(".gap,.free").count(), 0);
  assert.ok(
    await page.evaluate(() =>
      getComputedStyle(
        document.querySelector(".surface"),
        "::before",
      ).backgroundImage.includes("radial-gradient"),
    ),
  );
  assert.ok(
    await page.evaluate(() => {
      const labels = [...document.querySelectorAll("#labels>span")];
      const reference = [...document.querySelectorAll("#reference>.box")];
      return [...document.querySelectorAll("#predictions>.pred")].every(
        (e, i) => {
          const p = e.getBoundingClientRect(),
            r = reference[i].getBoundingClientRect();
          const edge = Math.max(
            Math.abs(p.left - r.left),
            Math.abs(p.right - r.right),
          );
          return (
            !labels[i].textContent ||
            Math.abs(parseFloat(labels[i].textContent) - edge) < 0.03
          );
        },
      );
    }),
    "Visible edge metric disagrees with box geometry",
  );
  await page.screenshot({
    path: "artifacts/website-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/website-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile overflow",
  );
  assert.ok(
    await page.evaluate(() => {
      const l = document.getElementById("handleL").getBoundingClientRect(),
        r = document.getElementById("handleR").getBoundingClientRect();
      return l.left >= 0 && r.right <= innerWidth;
    }),
    "Mobile handles clipped",
  );
  assert.deepEqual(errors, []);
  const r = {
    browser: browser.version(),
    fixtures: fixtures.length,
    maxParityErrorPx: parity,
    controls: "passed",
    resizeBounds: "passed",
    zeroGapPattern: "passed",
    edgeMetric: "passed",
    mobileOverflow: false,
    pageErrors: errors,
  };
  await writeFile("artifacts/browser-check.json", JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r, null, 2));
} finally {
  await browser.close();
}
