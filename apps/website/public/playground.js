import { highlightExample } from "./highlight.js";
import { createLayoutPredictor, JUSTIFY } from "/packages/core/src/index.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const BAD_PX = 1;
const LIMITS = {
  width: [240, 1800],
  gap: [0, Number.MAX_SAFE_INTEGER],
  basis: [20, 320],
  grow: [0, 3],
  count: [1, 8],
};

// Default: a plain centred row, nothing growing. Basis stays in px because the model never saw auto (0 px) boxes.
const config = {
  width: 760,
  gap: 16,
  justify: "center",
  items: [
    { basis: 120, grow: 0, shrink: 1 },
    { basis: 80, grow: 0, shrink: 1 },
    { basis: 200, grow: 0, shrink: 1 },
    { basis: 100, grow: 0, shrink: 1 },
  ],
};
let model = null,
  report = null,
  infer = null,
  selected = -1,
  boxes = [],
  errors = [];

/* ---------- justify dropdown ---------- */
$("justify").replaceChildren(
  ...JUSTIFY.map((mode) => {
    const o = document.createElement("option");
    o.value = mode;
    o.textContent = mode.replace(/^(flex|space)-/, "");
    return o;
  }),
);
$("justify").addEventListener("change", (e) => {
  config.justify = e.target.value;
  update();
});
function syncJustify() {
  $("justify").value = config.justify;
}

/* ---------- reference boxes ---------- */
function makeBox(i) {
  const el = document.createElement("div");
  el.className = "box";
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.setAttribute("aria-pressed", "false");
  el.innerHTML = `<span class="n">${i + 1}</span><button class="rm" type="button" aria-label="Remove box ${i + 1}">×</button><div class="grip" aria-hidden="true"></div>`;
  el.addEventListener("click", (e) => {
    if (e.target.closest(".rm,.grip")) return;
    select(selected === i ? -1 : i);
  });
  el.addEventListener("keydown", (e) => {
    if (e.target !== el) return;
    const item = config.items[i];
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(selected === i ? -1 : i);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      item.basis = clamp(
        item.basis + (e.key === "ArrowRight" ? step : -step),
        ...LIMITS.basis,
      );
      update();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeBox(i);
    }
  });
  el.querySelector(".rm").addEventListener("click", (e) => {
    e.stopPropagation();
    removeBox(i);
  });
  el.addEventListener("pointerenter", () => {
    if (!dragging) showTip(boxCenter(i), boxTip(i));
  });
  el.addEventListener("pointerleave", () => {
    if (!dragging) hideTip();
  });
  drag(el.querySelector(".grip"), {
    start: () => config.items[i].basis,
    move: (start, dx) => {
      config.items[i].basis = clamp(Math.round(start + dx), ...LIMITS.basis);
      update();
      showTip(boxCenter(i), boxTip(i));
    },
    end: () => hideTip(),
  });
  return el;
}
function rect(el) {
  const r = el.getBoundingClientRect(),
    o = $("reference").getBoundingClientRect().left;
  return { l: r.left - o, w: r.width, r: r.right - o };
}
function boxCenter(i) {
  const b = $("reference").children[i];
  if (!b) return 0;
  const r = rect(b);
  return r.l + r.w / 2;
}
function boxTip(i) {
  const item = config.items[i],
    b = $("reference").children[i];
  const w = b ? rect(b).w : 0;
  const note = Math.abs(w - item.basis) > 0.5 ? ` · basis ${item.basis}` : "";
  return `box ${i + 1} · ${fmt(w)} px${note} · grow ${item.grow} · shrink ${item.shrink}`;
}
function renderBoxes() {
  const ref = $("reference");
  if (ref.children.length !== config.items.length)
    ref.replaceChildren(...config.items.map((_, i) => makeBox(i)));
  config.items.forEach((a, i) => {
    const el = ref.children[i];
    Object.assign(el.style, { flex: `${a.grow} ${a.shrink} ${a.basis}px` });
    el.setAttribute(
      "aria-label",
      `Box ${i + 1}: basis ${a.basis} px, grow ${a.grow}, shrink ${a.shrink ? "on" : "off"}`,
    );
    el.setAttribute("aria-pressed", String(i === selected));
    el.querySelector(".rm").disabled = config.items.length <= 1;
  });
  Object.assign(ref.style, {
    gap: `${config.gap}px`,
    justifyContent: config.justify,
  });
}

/* ---------- gutters: gap (hatched) + free space (stippled), all drag the gap ---------- */
function renderGutters() {
  const focusedGap = document.activeElement?.classList.contains("gut")
    ? document.activeElement.dataset.after
    : undefined;
  const ref = $("reference"),
    kids = [...ref.children],
    rects = kids.map((k) => rect(k));
  $("masks").replaceChildren(
    ...rects.map((r) => {
      const el = document.createElement("div");
      el.style.left = `${r.l}px`;
      el.style.width = `${Math.max(0, r.w)}px`;
      return el;
    }),
  );
  const regions = [];
  if (rects.length) {
    if (rects[0].l > 0.5)
      regions.push({ l: 0, r: rects[0].l, gap: 0, kind: "lead" });
    for (let i = 0; i < rects.length - 1; i++)
      regions.push({
        l: rects[i].r,
        r: rects[i + 1].l,
        gap: config.gap,
        after: i,
        kind: "mid",
      });
    const last = rects[rects.length - 1];
    if (config.width - last.r > 0.5)
      regions.push({ l: last.r, r: config.width, gap: 0, kind: "trail" });
  }
  $("gutters").replaceChildren(
    ...regions.map((g) => {
      const el = document.createElement("div");
      const w = g.r - g.l,
        hit = Math.max(w, 10);
      el.className = `gut ${g.kind}`;
      el.style.left = `${g.l - (hit - w) / 2}px`;
      el.style.width = `${hit}px`;
      const free = Math.max(0, w - g.gap);
      const x0 = (hit - w) / 2;

      if (g.gap > 0)
        el.insertAdjacentHTML(
          "beforeend",
          `<div class="gap" style="left:${x0 + free / 2}px;width:${g.gap}px"></div>`,
        );
      if (g.kind === "mid") {
        el.dataset.after = String(g.after);
        el.tabIndex = 0;
        el.setAttribute("role", "slider");
        el.setAttribute("aria-label", "Gap");
        el.setAttribute("aria-valuemin", LIMITS.gap[0]);
        el.setAttribute("aria-valuenow", config.gap);
        const ins = document.createElement("button");
        ins.type = "button";
        ins.className = "ins";
        ins.textContent = "+";
        ins.setAttribute("aria-label", `Insert a box after box ${g.after + 1}`);
        ins.disabled = config.items.length >= LIMITS.count[1];
        ins.addEventListener("click", (e) => {
          e.stopPropagation();
          insertBox(g.after + 1);
        });
        ins.addEventListener("pointerdown", (e) => e.stopPropagation());
        el.append(ins);
        el.addEventListener("keydown", (e) => {
          if (e.target !== el) return;
          const step = e.shiftKey ? 5 : 1;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            config.gap = clamp(config.gap + step, ...LIMITS.gap);
            update();
          }
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            config.gap = clamp(config.gap - step, ...LIMITS.gap);
            update();
          }
        });
        drag(el, {
          start: () => config.gap,
          move: (start, dx) => {
            config.gap = clamp(Math.round(start + dx), ...LIMITS.gap);
            update();
            showTip(gutterCenter(g.after), gapTip(g.after));
          },
          end: () => hideTip(),
        });
      }
      const tipText =
        g.kind === "mid"
          ? () => gapTip(g.after)
          : () => `free space · ${fmt(w)} px`;
      const tipX =
        g.kind === "mid" ? () => gutterCenter(g.after) : () => (g.l + g.r) / 2;
      el.addEventListener("pointerenter", () => {
        if (!dragging) showTip(tipX(), tipText());
      });
      el.addEventListener("pointerleave", () => {
        if (!dragging) hideTip();
      });
      return el;
    }),
  );
  if (focusedGap !== undefined)
    $("gutters")
      .querySelector(`[data-after="${focusedGap}"]`)
      ?.focus({ preventScroll: true });
}
function gutterCenter(after) {
  const k = $("reference").children;
  return (rect(k[after]).r + rect(k[after + 1]).l) / 2;
}
function gapTip(after) {
  const k = $("reference").children,
    space = rect(k[after + 1]).l - rect(k[after]).r;
  const free = space - config.gap;
  return `gap ${config.gap} px${free > 0.5 ? ` · +${fmt(free)} px free` : ""}`;
}

/* ---------- predictions overlay, disagreement slivers, per-box labels ---------- */
function renderPredictions() {
  const ref = $("reference");
  if (!model) {
    $("predictions").replaceChildren();
    $("labels").replaceChildren();
    boxes = [];
    errors = [];
    return;
  }
  const started = performance.now();
  boxes = infer(config);
  $("timing").textContent =
    `${(performance.now() - started).toFixed(2)} ms inference`;
  let total = 0;
  const rects = [...ref.children].map(rect);
  errors = rects.map((r, i) => {
    const xe = Math.abs(boxes[i].x - r.l),
      we = Math.abs(boxes[i].width - r.w);
    const edge = Math.max(xe, Math.abs(boxes[i].x + boxes[i].width - r.r));
    total += edge;
    return { xe, we, edge, bad: edge > BAD_PX };
  });
  const layer = [];
  const sliver = (cls, l, r) => {
    const w = r - l;
    if (w < 0.5) return;
    const el = document.createElement("div");
    el.className = cls;
    Object.assign(el.style, { left: `${l}px`, width: `${Math.max(w, 1.5)}px` });
    layer.push(el);
  };
  boxes.forEach((b, i) => {
    const ml = b.x,
      mr = b.x + Math.max(0, b.width),
      bl = rects[i].l,
      br = rects[i].r;
    const el = document.createElement("div");
    el.className = "pred";
    // CSS cannot draw a negative width; the raw prediction still counts in the error.
    Object.assign(el.style, { left: `${ml}px`, width: `${mr - ml}px` });
    layer.push(el);
    // One colour for any disagreement: model painted where the browser did not, or left browser box uncovered.
    sliver("off", ml, Math.min(mr, bl));
    sliver("off", Math.max(ml, br), mr);
    sliver("off", bl, Math.min(br, ml));
    sliver("off", Math.max(bl, mr), br);
  });
  $("predictions").replaceChildren(...layer);
  $("labels").replaceChildren(
    ...rects.map((r, i) => {
      const s = document.createElement("span");
      s.classList.toggle("bad", errors[i].bad);
      s.textContent = r.w < 52 ? "" : `${errors[i].edge.toFixed(2)} px`;
      s.title = `Box ${i + 1}: largest edge error ${errors[i].edge.toFixed(2)} px; position off by ${errors[i].xe.toFixed(2)} px, width off by ${errors[i].we.toFixed(2)} px`;
      s.style.left = `${r.l + r.w / 2}px`;
      return s;
    }),
  );
  $("status").textContent =
    config.width > 1200 || config.gap > 40
      ? "Outside training range (width ≤ 1,200 px, gap ≤ 40 px)"
      : "";
  $("error").textContent =
    `mean edge error ${(total / boxes.length).toFixed(2)} px`;
  $("error").classList.toggle("bad", total / boxes.length > BAD_PX);
}

/* ---------- drawer: the selected box's rules ---------- */
function measurement(i) {
  const e = errors[i];
  return e
    ? `<span>Position error <b>${e.xe.toFixed(2)} px</b></span><span>Width error <b>${e.we.toFixed(2)} px</b></span><span>Largest edge error <b>${e.edge.toFixed(2)} px</b></span>`
    : "Loading prediction…";
}
function renderDrawer() {
  const d = $("drawer");
  if (selected < 0 || selected >= config.items.length) {
    d.hidden = true;
    return;
  }
  d.hidden = false;
  const i = selected,
    item = config.items[i],
    el = $("reference").children[i],
    r = rect(el),
    b = boxes[i],
    e = errors[i];
  d.innerHTML = `<span class="who">Box ${i + 1}</span>
  <label class="field"><span>basis</span><input type="number" min="${LIMITS.basis[0]}" max="${LIMITS.basis[1]}" step="1" value="${item.basis}" aria-label="Box ${i + 1} basis in pixels"> px</label>
  <div class="field"><span>grow</span><div class="toggle" role="group" aria-label="Grow">${[0, 1, 2, 3].map((g) => `<button type="button" data-grow="${g}" aria-pressed="${g === item.grow}">${g}</button>`).join("")}</div></div>
  <div class="field"><span>shrink</span><div class="toggle" role="group" aria-label="Shrink"><button type="button" data-shrink="0" aria-pressed="${item.shrink === 0}">off</button><button type="button" data-shrink="1" aria-pressed="${item.shrink === 1}">on</button></div></div>
  <button type="button" class="rmbtn" ${config.items.length <= 1 ? "disabled" : ""}>Remove</button>
  <span class="meas">${measurement(i)}</span>`;
  d.querySelector("input").addEventListener("input", (ev) => {
    if (!ev.target.validity.valid || ev.target.value === "") return;
    item.basis = Number(ev.target.value);
    update({ keepDrawer: true });
  });
  d.querySelectorAll("[data-grow]").forEach((btn) =>
    btn.addEventListener("click", () => {
      item.grow = Number(btn.dataset.grow);
      update();
    }),
  );
  d.querySelectorAll("[data-shrink]").forEach((btn) =>
    btn.addEventListener("click", () => {
      item.shrink = Number(btn.dataset.shrink);
      update();
    }),
  );
  d.querySelector(".rmbtn").addEventListener("click", () => removeBox(i));
}

function renderExample() {
  const items = config.items
    .map(
      (item) =>
        `    { basis: ${item.basis}, grow: ${item.grow}, shrink: ${item.shrink} },`,
    )
    .join("\n");
  const output = model
    ? boxes
        .map(
          (b) => `//   { x: ${b.x.toFixed(3)}, width: ${b.width.toFixed(3)} },`,
        )
        .join("\n")
    : "// Model loading…";
  const code = `import { createLayoutPredictor } from './packages/core/src/index.js';

const predict = await createLayoutPredictor();
const boxes = predict({
  width: ${config.width},
  gap: ${config.gap},
  justify: '${config.justify}',
  items: [
${items}
  ],
});

console.log(boxes);
// Positions and widths in pixels (rounded here).
// [
${output}
// ]`;
  highlightExample($("example"), code);
}

/* ---------- state changes ---------- */
function select(i) {
  selected = i;
  update();
  if (i >= 0) $("reference").children[i]?.focus({ preventScroll: true });
}
function insertBox(at) {
  if (config.items.length >= LIMITS.count[1]) return;
  config.items.splice(at, 0, { basis: 100, grow: 0, shrink: 1 });
  if (selected >= at) selected++;
  $("reference").replaceChildren();
  update();
  $("reference").children[at]?.focus({ preventScroll: true });
}
function removeBox(i) {
  if (config.items.length <= 1) return;
  config.items.splice(i, 1);
  if (selected === i) selected = -1;
  else if (selected > i) selected--;
  hideTip();
  $("reference").replaceChildren();
  update();
}
// The frame is centred and never wider than the viewport, so the handles always stay reachable.
function maxWidth() {
  const pad = parseFloat(
    getComputedStyle($("frame")).getPropertyValue("--pad"),
  );
  const available = document.documentElement.clientWidth;
  return Math.max(1, Math.floor(available - 2 * pad - 24));
}
function update({ keepDrawer = false } = {}) {
  const frame = $("frame");
  config.width = Math.min(config.width, maxWidth());
  frame.style.setProperty("--w", `${config.width}px`);
  for (const h of [$("handleL"), $("handleR")]) {
    h.setAttribute("aria-valuenow", config.width);
    h.setAttribute("aria-valuemax", maxWidth());
  }
  $("add").disabled = config.items.length >= LIMITS.count[1];
  syncJustify();
  renderBoxes();
  renderGutters();
  renderPredictions();
  renderExample();
  if (keepDrawer) {
    const m = $("drawer").querySelector(".meas");
    if (m) m.innerHTML = measurement(selected);
  } else renderDrawer();
}

/* ---------- frame width handles (the frame stays centred, so edges move at half the width change) ---------- */
for (const [handle, sign] of [
  [$("handleR"), 1],
  [$("handleL"), -1],
]) {
  drag(handle, {
    start: () => config.width,
    move: (w, dx) => {
      config.width = clamp(
        Math.round(w + sign * dx * 2),
        LIMITS.width[0],
        maxWidth(),
      );
      update();
      showTip(config.width / 2, `width ${config.width} px`);
    },
    end: () => hideTip(),
  });
  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 20 : 2;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      config.width = clamp(config.width + step, LIMITS.width[0], maxWidth());
      update();
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      config.width = clamp(config.width - step, ...LIMITS.width);
      update();
    }
  });
}
$("add").addEventListener("click", () => insertBox(config.items.length));
addEventListener("resize", () => {
  if (config.width > maxWidth()) update();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selected >= 0) select(-1);
});
document.addEventListener("pointerdown", (e) => {
  if (selected >= 0 && !e.target.closest(".frame")) select(-1);
});

/* ---------- helpers ---------- */
let dragging = false,
  moved = false,
  lastDragEnd = -1e9;
// A drag that ends over its own box synthesises a click; swallow only that one.
document.addEventListener(
  "click",
  (e) => {
    if (moved && performance.now() - lastDragEnd < 60) e.stopPropagation();
    moved = false;
  },
  true,
);
function drag(el, { start, move, end }) {
  // Listeners live on the document: the element under the pointer may be rebuilt mid-drag.
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX,
      state = start();
    dragging = true;
    moved = false;
    el.classList.add("active");
    $("frame").classList.add("dragging");
    document.body.style.cursor = "ew-resize";
    let pending = 0,
      latest = 0;
    const onMove = (ev) => {
      if (ev.clientX !== x0) moved = true;
      latest = ev.clientX - x0;
      if (!pending)
        pending = requestAnimationFrame(() => {
          pending = 0;
          move(state, latest);
        });
    };
    const onUp = () => {
      if (pending) {
        cancelAnimationFrame(pending);
        pending = 0;
        move(state, latest);
      }
      dragging = false;
      lastDragEnd = performance.now();
      el.classList.remove("active");
      $("frame").classList.remove("dragging");
      document.body.style.cursor = "";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      end?.();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  });
}
function showTip(x, text) {
  const t = $("tip");
  t.textContent = text;
  t.hidden = false;
  const half = t.getBoundingClientRect().width / 2;
  t.style.left = `${clamp(x, half, config.width - half)}px`;
}
function hideTip() {
  $("tip").hidden = true;
}
function fmt(n) {
  return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
}

$("reset").addEventListener("click", () => {
  Object.assign(config, {
    width: 760,
    gap: 16,
    justify: "center",
    items: [120, 80, 200, 100].map((basis) => ({ basis, grow: 0, shrink: 1 })),
  });
  selected = -1;
  $("reference").replaceChildren();
  update();
});

/* ---------- boot ---------- */
update();
try {
  const response = await fetch("/model-report.json");
  if (!response.ok) throw new Error("Missing model report");
  report = await response.json();
  infer = await createLayoutPredictor();
  model = true;
  const m = report.metrics["test-balanced-natural"];
  $("metrics").textContent =
    `This checkpoint has ${report.parameters.toLocaleString()} learned parameters: ${report.quantization.bits}-bit hidden weights with a float32 output layer, ${(report.runtime.bytes / 1024).toFixed(1)} KiB as a binary and ${(report.runtime.brotliBytes / 1024).toFixed(1)} KiB over the wire with Brotli. It trained on ${(report.trainingLayouts ?? report.manifest.splits.train.layouts).toLocaleString()} Chromium-measured layouts. On ${report.manifest.splits["test-balanced-natural"].layouts.toLocaleString()} held-out layouts it is ${m.maePx.toFixed(3)} px off on average, ${m.p95Px.toFixed(2)} px at the 95th percentile, with ${(m.coordinatesUnder1Px * 100).toFixed(1)}% of coordinates within 1 px and a worst miss of ${m.maxPx.toFixed(2)} px. Wider, unseen containers average ${report.metrics.ood.maePx.toFixed(2)} px.`;
  update();
} catch (error) {
  $("status").textContent = "Model download failed. Reload to try again.";
  $("metrics").textContent = "No trained checkpoint is available.";
  console.error(error);
}
