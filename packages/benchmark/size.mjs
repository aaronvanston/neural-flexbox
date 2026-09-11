import { readdir, readFile } from "node:fs/promises";
import { brotliCompressSync } from "node:zlib";
const report = JSON.parse(
  await readFile("packages/training/active/report.json", "utf8"),
);
const paths = (await readdir("packages/core/src")).filter((f) =>
  f.endsWith(".js"),
);
const js = Buffer.concat(
  await Promise.all(paths.map((f) => readFile("packages/core/src/" + f))),
);
console.log(
  JSON.stringify(
    {
      weightsRawBytes: report.runtime.bytes,
      weightsBrotliBytes: report.runtime.brotliBytes,
      runtimeSourceBytes: js.length,
      runtimeSourceBrotliBytes: brotliCompressSync(js).length,
      note: "Runtime source compression is a separate unminified measurement, not a bundled package or website transfer size.",
    },
    null,
    2,
  ),
);
