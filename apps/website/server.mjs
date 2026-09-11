import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
const root = fileURLToPath(new URL("../../", import.meta.url)),
  web = resolve(root, "apps/website/public");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".bin": "application/octet-stream",
  ".svg": "image/svg+xml",
};
function choices(header = "") {
  const accepted = new Map(
    header
      .toLowerCase()
      .split(",")
      .map((p) => {
        const [n, ...params] = p.trim().split(";");
        const q = params.find((x) => x.trim().startsWith("q="));
        const v = q ? Number(q.trim().slice(2)) : 1;
        return [n, Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0];
      }),
  );
  return ["br", "gzip"]
    .map((n) => [n, accepted.get(n) ?? accepted.get("*") ?? 0])
    .filter(([, q]) => q > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => n);
}
const server = http.createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let base = web,
    relative = path === "/" ? "index.html" : path.slice(1);
  if (path.startsWith("/packages/core/")) {
    base = resolve(root, "packages/core");
    relative = path.slice("/packages/core/".length);
  }
  const file = resolve(base, relative);
  if (!file.startsWith(base + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    let data, encoding;
    if (extname(file) === ".bin")
      for (const c of choices(req.headers["accept-encoding"]))
        try {
          data = await readFile(file + (c === "br" ? ".br" : ".gz"));
          encoding = c;
          break;
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
    data ??= await readFile(file);
    const headers = {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    };
    if (extname(file) === ".bin") headers.Vary = "Accept-Encoding";
    if (encoding) headers["Content-Encoding"] = encoding;
    res.writeHead(200, headers).end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
});
server.listen(Number(process.env.PORT ?? 4174), "0.0.0.0", () =>
  console.log(`Neural Flexbox: http://localhost:${process.env.PORT ?? 4174}`),
);
