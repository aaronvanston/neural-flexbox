import { mkdir, copyFile } from "node:fs/promises";
const target = new URL("../apps/website/public/vendor/", import.meta.url);
await mkdir(target, { recursive: true });
await copyFile(
  new URL("../node_modules/gpu-lexer/dist/index.js", import.meta.url),
  new URL("gpu-lexer.js", target),
);
await copyFile(
  new URL("../THIRD_PARTY_NOTICES.md", import.meta.url),
  new URL("THIRD_PARTY_NOTICES.txt", target),
);
