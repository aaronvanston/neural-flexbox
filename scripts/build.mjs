import "./website-assets.mjs";
import { mkdir, cp, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("apps/website/public", "dist", { recursive: true });
await cp("packages/core/src", "dist/packages/core/src", { recursive: true });
await cp("packages/core/model", "dist/packages/core/model", {
  recursive: true,
});
console.log(
  "Static website built in dist/. Binary .br/.gz sidecars require Content-Encoding-aware hosting. Raw binary works on any static host.",
);
