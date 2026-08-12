import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function firstExisting(paths) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Continue through explicit cross-platform build locations.
    }
  }
  return undefined;
}

const outputPath = resolve(argument("--output") ?? "build/frameos.cdx.json");
const explicitWorker = argument("--worker");
const workerPath = await firstExisting(
  explicitWorker === undefined
    ? [
        resolve("build/engine-worker/Release/frameos-engine-worker.exe"),
        resolve("build/engine-worker/frameos-engine-worker"),
      ]
    : [resolve(explicitWorker)],
);
if (workerPath === undefined) {
  throw new Error(
    "A built engine worker is required; pass --worker or build build/engine-worker first",
  );
}

const npmArguments = [
  "sbom",
  "--sbom-format",
  "cyclonedx",
  "--workspaces",
  "--include-workspace-root",
];
const npmCli = process.env.npm_execpath;
const generated = spawnSync(
  npmCli === undefined ? "npm" : process.execPath,
  npmCli === undefined ? npmArguments : [npmCli, ...npmArguments],
  { encoding: "utf8", maxBuffer: 64 * 1_024 * 1_024 },
);
if (generated.status !== 0) {
  throw new Error(
    `npm SBOM generation failed: ${generated.error?.message ?? generated.stderr ?? generated.stdout}`,
  );
}
const sbom = JSON.parse(generated.stdout);
const workerBytes = await readFile(workerPath);
const workerHash = createHash("sha256").update(workerBytes).digest("hex");
sbom.metadata ??= {};
sbom.metadata.properties ??= [];
sbom.metadata.properties.push(
  {
    name: "frameos:distribution-allowlist",
    value: "third-party/distribution-allowlist.yml",
  },
  { name: "frameos:release-gate", value: "legal-review-required" },
);
sbom.components ??= [];
sbom.components.push({
  type: "application",
  "bom-ref": `frameos-engine-worker@0.1.0#sha256:${workerHash}`,
  name: "frameos-engine-worker",
  version: "0.1.0",
  hashes: [{ alg: "SHA-256", content: workerHash }],
  properties: [
    { name: "frameos:packaged-filename", value: basename(workerPath) },
    { name: "frameos:mlt-linkage", value: "dynamic" },
    { name: "frameos:dependency-license-status", value: "audit-required" },
  ],
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify({ output: outputPath, worker: workerPath, workerHash }),
);
