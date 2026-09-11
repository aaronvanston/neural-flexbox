// A slow GPU result must never overwrite a newer playground configuration.
let parsePromise,
  timer,
  revision = 0,
  unavailable = false;
export function highlightExample(element, code) {
  const current = ++revision;
  clearTimeout(timer);
  element.textContent = code;
  const status = document.getElementById("highlight-status");
  if (!navigator.gpu || unavailable) {
    status.textContent = "WebGPU unavailable in this browser.";
    return;
  }
  status.textContent = "Highlighting…";
  timer = setTimeout(async () => {
    try {
      const { parse } = await (parsePromise ??= import("./vendor/gpu-lexer.js"));
      const spans = await parse(code);
      if (current !== revision) return;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const { start, end, type } of spans) {
        if (start < offset || end < start || end > code.length)
          throw new Error("Invalid syntax span");
        fragment.append(document.createTextNode(code.slice(offset, start)));
        const span = document.createElement("span");
        span.className = `syntax-${type}`;
        span.textContent = code.slice(start, end);
        fragment.append(span);
        offset = end;
      }
      fragment.append(document.createTextNode(code.slice(offset)));
      element.replaceChildren(fragment);
      status.textContent = "Highlighted with WebGPU.";
    } catch {
      unavailable = true;
      if (current === revision)
        status.textContent = "WebGPU highlighting unavailable in this browser.";
    }
  }, 120);
}
