import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import {
  FrameOSError,
  analysisSegmentSchema,
  analyzerPluginManifestSchema,
  analyzerWorkerEventSchema,
  analyzerWorkerRequestSchema,
  createId,
  type AnalyzerDescriptor,
  type AnalyzerPluginManifest,
  type AnalyzerWorkerEvent,
  type AnalyzerWorkerRequest,
  type Asset,
  type FrameOSErrorCode,
} from "@frameos/contracts";
import type { MediaPolicy } from "../security/media-policy.js";
import type { ProjectStore } from "../store/project-store.js";
import type {
  AnalyzerPlugin,
  AnalyzerPluginLoadResult,
  AnalyzerResult,
} from "./types.js";

const MAX_MANIFEST_BYTES = 1 * 1_024 * 1_024;
const MAX_REQUEST_BYTES = 4 * 1_024 * 1_024;
const MAX_STDERR_BYTES = 64 * 1_024;
const parameterSchemaValidator = new Ajv2020({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  validateFormats: false,
});

interface LoadedManifest {
  manifestPath: string;
  directory: string;
  manifest: AnalyzerPluginManifest;
  executablePath?: string;
  modelPath?: string;
  resourcePaths: string[];
  parameterValidator: ValidateFunction;
  unavailableReason?: string;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function portableArguments(manifest: AnalyzerPluginManifest): string[] {
  const references = new Map(
    manifest.resources.map((resource) => [
      resource.path,
      `resource:${resource.role}`,
    ]),
  );
  if (manifest.model !== undefined) {
    references.set(manifest.model.path, "model");
  }
  references.set(manifest.executable.path, "executable");
  return manifest.executable.arguments.map(
    (argument) => references.get(argument) ?? argument,
  );
}

function analyzerBundleHash(manifest: AnalyzerPluginManifest): string {
  return createHash("sha256")
    .update(
      stableJson({
        protocolVersion: manifest.protocolVersion,
        analyzerId: manifest.id,
        analyzerVersion: manifest.version,
        capabilityId: manifest.capabilityId,
        outputTypes: manifest.outputTypes,
        assetKinds: manifest.assetKinds,
        deterministic: manifest.deterministic,
        parameterSchema: manifest.parameterSchema,
        executableHash: manifest.executable.sha256,
        executableArguments: portableArguments(manifest),
        modelHash: manifest.model?.sha256,
        resources: manifest.resources
          .map((resource) => ({
            sha256: resource.sha256,
            role: resource.role,
            version: resource.version,
          }))
          .sort((left, right) => left.role.localeCompare(right.role)),
        limits: manifest.limits,
      }),
    )
    .digest("hex");
}

async function regularFile(path: string): Promise<string> {
  const canonical = await realpath(path);
  const information = await stat(canonical);
  if (!information.isFile()) throw new Error("Configured path is not a file");
  return canonical;
}

function manifestFile(directory: string, path: string): string {
  return isAbsolute(path) ? path : resolve(directory, path);
}

function descriptor(
  loaded: LoadedManifest,
  available: boolean,
): AnalyzerDescriptor {
  const { manifest } = loaded;
  return {
    id: manifest.id,
    version: manifest.version,
    capabilityId: manifest.capabilityId,
    name: manifest.name,
    description: manifest.description,
    outputTypes: manifest.outputTypes,
    assetKinds: manifest.assetKinds,
    available,
    deterministic: manifest.deterministic,
    binaryHash: manifest.executable.sha256,
    bundleHash: analyzerBundleHash(manifest),
    binaryLicense: manifest.executable.license,
    ...(manifest.model === undefined
      ? {}
      : {
          modelHash: manifest.model.sha256,
          modelLicense: manifest.model.license,
        }),
    ...(loaded.unavailableReason === undefined
      ? {}
      : { reasonUnavailable: loaded.unavailableReason }),
    parameterSchema: manifest.parameterSchema,
  };
}

async function readManifest(path: string): Promise<LoadedManifest> {
  const manifestPath = await regularFile(path).catch(() => {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Configured analyzer manifest does not exist or is not a regular file",
      422,
    );
  });
  const information = await stat(manifestPath);
  if (information.size > MAX_MANIFEST_BYTES) {
    throw new FrameOSError(
      "RESOURCE_LIMIT",
      "Analyzer manifest exceeds the 1 MiB limit",
      413,
    );
  }
  let document: unknown;
  try {
    document = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Analyzer manifest is not valid JSON",
      422,
    );
  }
  const manifest = analyzerPluginManifestSchema.parse(document);
  let parameterValidator: ValidateFunction;
  try {
    parameterValidator = parameterSchemaValidator.compile(
      manifest.parameterSchema,
    );
  } catch {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Analyzer parameterSchema is not valid JSON Schema 2020-12",
      422,
    );
  }
  const directory = dirname(manifestPath);
  const loaded: LoadedManifest = {
    manifestPath,
    directory,
    manifest,
    resourcePaths: [],
    parameterValidator,
  };
  try {
    loaded.executablePath = await regularFile(
      manifestFile(directory, manifest.executable.path),
    );
    await access(loaded.executablePath, constants.X_OK);
    const binaryHash = await sha256File(loaded.executablePath);
    if (binaryHash !== manifest.executable.sha256) {
      throw new Error(
        "Analyzer executable SHA-256 does not match its manifest",
      );
    }
    if (manifest.model !== undefined) {
      loaded.modelPath = await regularFile(
        manifestFile(directory, manifest.model.path),
      );
      const modelHash = await sha256File(loaded.modelPath);
      if (modelHash !== manifest.model.sha256) {
        throw new Error("Analyzer model SHA-256 does not match its manifest");
      }
    }
    const pinnedPaths = new Set<string>([
      loaded.executablePath,
      ...(loaded.modelPath === undefined ? [] : [loaded.modelPath]),
    ]);
    for (const resource of manifest.resources) {
      const resourcePath = await regularFile(
        manifestFile(directory, resource.path),
      );
      if (pinnedPaths.has(resourcePath)) {
        throw new Error("Analyzer manifest contains duplicate pinned files");
      }
      const resourceHash = await sha256File(resourcePath);
      if (resourceHash !== resource.sha256) {
        throw new Error(
          `Analyzer ${resource.role} resource SHA-256 does not match its manifest`,
        );
      }
      pinnedPaths.add(resourcePath);
      loaded.resourcePaths.push(resourcePath);
    }
    for (const argument of manifest.executable.arguments) {
      const argumentPath = await realpath(
        manifestFile(directory, argument),
      ).catch(() => undefined);
      if (argumentPath !== undefined) {
        const information = await stat(argumentPath);
        if (information.isFile() && !pinnedPaths.has(argumentPath)) {
          throw new Error(
            "Analyzer executable argument references an unpinned file",
          );
        }
      }
    }
  } catch (error) {
    loaded.unavailableReason =
      error instanceof Error
        ? error.message
        : "Analyzer executable or model could not be verified";
  }
  return loaded;
}

function cleanEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    FRAMEOS_ANALYZER_PROTOCOL_VERSION: "1.0.0",
    NO_COLOR: "1",
    LANG: "C.UTF-8",
  };
  for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}

function errorStatus(code: FrameOSErrorCode): number {
  switch (code) {
    case "JOB_CANCELLED":
    case "REVISION_CONFLICT":
      return 409;
    case "RESOURCE_LIMIT":
      return 413;
    case "CAPABILITY_UNAVAILABLE":
      return 424;
    case "NOT_FOUND":
      return 404;
    case "FORBIDDEN":
      return 403;
    case "UNAUTHORIZED":
      return 401;
    case "PLUGIN_FAILURE":
    case "INTERNAL_ERROR":
      return 500;
    default:
      return 422;
  }
}

function terminate(processHandle: ReturnType<typeof spawn>): void {
  if (processHandle.exitCode === null && processHandle.signalCode === null) {
    processHandle.kill();
  }
}

async function executeWorker(
  loaded: LoadedManifest,
  request: AnalyzerWorkerRequest,
  signal: AbortSignal,
  reportProgress: (progress: number) => void,
): Promise<AnalyzerResult> {
  if (signal.aborted) {
    throw new FrameOSError("JOB_CANCELLED", "Analysis was cancelled", 409);
  }
  const executablePath = loaded.executablePath;
  if (executablePath === undefined) {
    throw new FrameOSError(
      "CAPABILITY_UNAVAILABLE",
      loaded.unavailableReason ?? "Analyzer executable is unavailable",
      424,
    );
  }
  const input = `${JSON.stringify(analyzerWorkerRequestSchema.parse(request))}\n`;
  if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) {
    throw new FrameOSError(
      "RESOURCE_LIMIT",
      "Analyzer request exceeds the 4 MiB protocol limit",
      413,
    );
  }

  return new Promise<AnalyzerResult>((resolveResult, rejectResult) => {
    const child = spawn(executablePath, loaded.manifest.executable.arguments, {
      cwd: loaded.directory,
      env: cleanEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let outputBytes = 0;
    let stderrBytes = 0;
    let stdoutBuffer = "";
    let resultEvent:
      Extract<AnalyzerWorkerEvent, { type: "result" }> | undefined;
    let workerError: FrameOSError | undefined;
    let spawnError: Error | undefined;
    let timedOut = false;

    const failProtocol = (
      message: string,
      code: FrameOSErrorCode = "PLUGIN_FAILURE",
    ) => {
      if (workerError === undefined) {
        workerError = new FrameOSError(code, message, errorStatus(code));
      }
      terminate(child);
    };
    const consumeLine = (line: string): void => {
      if (line.trim() === "" || workerError !== undefined) return;
      const parsed = analyzerWorkerEventSchema.safeParse(
        (() => {
          try {
            return JSON.parse(line);
          } catch {
            return undefined;
          }
        })(),
      );
      if (!parsed.success) {
        failProtocol("Analyzer emitted an invalid protocol event");
        return;
      }
      const event = parsed.data;
      if (event.requestId !== request.requestId) {
        failProtocol("Analyzer response request id did not match");
        return;
      }
      if (event.type === "progress") {
        reportProgress(event.progress);
        return;
      }
      if (event.type === "error") {
        workerError = new FrameOSError(
          event.code,
          event.message,
          errorStatus(event.code),
        );
        return;
      }
      if (resultEvent !== undefined) {
        failProtocol("Analyzer emitted more than one result event");
        return;
      }
      resultEvent = event;
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > loaded.manifest.limits.maxOutputBytes) {
        failProtocol(
          "Analyzer output exceeded its manifest limit",
          "RESOURCE_LIMIT",
        );
        return;
      }
      stdoutBuffer += chunk;
      let newline = stdoutBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        consumeLine(line);
        newline = stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR_BYTES) {
        failProtocol(
          "Analyzer stderr exceeded the 64 KiB limit",
          "RESOURCE_LIMIT",
        );
      }
    });
    child.once("error", (error) => {
      spawnError = error;
    });
    const onAbort = (): void => terminate(child);
    signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, loaded.manifest.limits.timeoutMs);
    timeout.unref();

    child.once("close", (code) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      if (stdoutBuffer.trim() !== "") consumeLine(stdoutBuffer);
      if (signal.aborted) {
        rejectResult(
          new FrameOSError("JOB_CANCELLED", "Analysis was cancelled", 409),
        );
        return;
      }
      if (timedOut) {
        rejectResult(
          new FrameOSError(
            "RESOURCE_LIMIT",
            "Analyzer exceeded its configured timeout",
            413,
          ),
        );
        return;
      }
      if (workerError !== undefined) {
        rejectResult(workerError);
        return;
      }
      if (spawnError !== undefined) {
        rejectResult(
          new FrameOSError(
            "PLUGIN_FAILURE",
            `Analyzer process could not start: ${spawnError.message}`,
            500,
          ),
        );
        return;
      }
      if (code !== 0) {
        rejectResult(
          new FrameOSError(
            "PLUGIN_FAILURE",
            `Analyzer process exited with code ${String(code)}`,
            500,
          ),
        );
        return;
      }
      if (resultEvent === undefined) {
        rejectResult(
          new FrameOSError(
            "PLUGIN_FAILURE",
            "Analyzer exited without a result event",
            500,
          ),
        );
        return;
      }
      if (!loaded.manifest.outputTypes.includes(resultEvent.outputType)) {
        rejectResult(
          new FrameOSError(
            "PLUGIN_FAILURE",
            `Analyzer returned undeclared output type ${resultEvent.outputType}`,
            500,
          ),
        );
        return;
      }
      if (resultEvent.segments.length > loaded.manifest.limits.maxSegments) {
        rejectResult(
          new FrameOSError(
            "RESOURCE_LIMIT",
            "Analyzer returned more segments than its manifest permits",
            413,
          ),
        );
        return;
      }
      resolveResult({
        type: resultEvent.outputType,
        segments: resultEvent.segments.map((segment) =>
          analysisSegmentSchema.parse({ id: createId(), ...segment }),
        ),
        metadata: resultEvent.metadata,
      });
    });
    child.stdin.end(input, "utf8");
  });
}

async function resolveAssetPath(
  asset: Asset,
  projectId: string,
  mediaPolicy: MediaPolicy,
  projects: ProjectStore,
): Promise<string> {
  await mediaPolicy.validateUris([asset.uri]);
  const path = asset.uri.startsWith("frameos:")
    ? projects.resolveProjectUri(projectId, asset.uri)
    : asset.uri.startsWith("file:")
      ? fileURLToPath(asset.uri)
      : asset.uri;
  if (!isAbsolute(path)) {
    throw new FrameOSError(
      "UNSUPPORTED_FORMAT",
      "External analyzers require an approved local media file",
      422,
    );
  }
  return regularFile(path).catch(() => {
    throw new FrameOSError("MEDIA_OFFLINE", "Media file is offline", 422);
  });
}

function externalPlugin(
  loaded: LoadedManifest,
  mediaPolicy: MediaPolicy,
  projects: ProjectStore,
): AnalyzerPlugin {
  const publicDescriptor = descriptor(loaded, true);
  return {
    descriptor: publicDescriptor,
    async analyze(context) {
      if (context.signal.aborted) {
        throw new FrameOSError("JOB_CANCELLED", "Analysis was cancelled", 409);
      }
      if (!loaded.parameterValidator(context.parameters)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Parameters for analyzer ${loaded.manifest.id} do not match its schema`,
          422,
          (loaded.parameterValidator.errors ?? [])
            .slice(0, 100)
            .map((error) => ({
              field: `parameters.${loaded.manifest.id}${error.instancePath.replaceAll("/", ".")}`,
              message: error.message ?? "Invalid analyzer parameter",
            })),
        );
      }
      const binaryHash = await sha256File(loaded.executablePath!);
      if (binaryHash !== loaded.manifest.executable.sha256) {
        throw new FrameOSError(
          "CAPABILITY_UNAVAILABLE",
          "Analyzer executable changed after capability discovery",
          424,
        );
      }
      if (loaded.manifest.model !== undefined) {
        const modelHash = await sha256File(loaded.modelPath!);
        if (modelHash !== loaded.manifest.model.sha256) {
          throw new FrameOSError(
            "CAPABILITY_UNAVAILABLE",
            "Analyzer model changed after capability discovery",
            424,
          );
        }
      }
      for (
        let index = 0;
        index < loaded.manifest.resources.length;
        index += 1
      ) {
        const resource = loaded.manifest.resources[index]!;
        const resourceHash = await sha256File(loaded.resourcePaths[index]!);
        if (resourceHash !== resource.sha256) {
          throw new FrameOSError(
            "CAPABILITY_UNAVAILABLE",
            `Analyzer ${resource.role} resource changed after capability discovery`,
            424,
          );
        }
      }
      if (context.signal.aborted) {
        throw new FrameOSError("JOB_CANCELLED", "Analysis was cancelled", 409);
      }
      const assetPath = await resolveAssetPath(
        context.asset,
        context.project.projectId,
        mediaPolicy,
        projects,
      );
      const request = analyzerWorkerRequestSchema.parse({
        schemaVersion: "1.0.0",
        requestId: createId(),
        analyzerId: loaded.manifest.id,
        analyzerVersion: loaded.manifest.version,
        asset: {
          id: context.asset.id,
          name: context.asset.name,
          kind: context.asset.kind,
          path: assetPath,
          hash: context.asset.hash,
          streams: context.asset.streams,
          ...(context.asset.duration === undefined
            ? {}
            : { duration: context.asset.duration }),
          semanticMetadata: context.asset.semanticMetadata,
        },
        parameters: context.parameters,
        ...(loaded.modelPath === undefined
          ? {}
          : { modelPath: loaded.modelPath }),
        resources: loaded.manifest.resources.map((resource, index) => ({
          role: resource.role,
          path: loaded.resourcePaths[index],
          sha256: resource.sha256,
          ...(resource.version === undefined
            ? {}
            : { version: resource.version }),
        })),
      });
      const result = await executeWorker(
        loaded,
        request,
        context.signal,
        context.reportProgress,
      );
      return {
        ...result,
        metadata: {
          ...(result.metadata ?? {}),
          analyzerBundle: {
            bundleHash: analyzerBundleHash(loaded.manifest),
            executable: {
              sha256: loaded.manifest.executable.sha256,
              version: loaded.manifest.executable.version,
              license: loaded.manifest.executable.license,
            },
            ...(loaded.manifest.model === undefined
              ? {}
              : {
                  model: {
                    sha256: loaded.manifest.model.sha256,
                    version: loaded.manifest.model.version,
                    license: loaded.manifest.model.license,
                  },
                }),
            resources: loaded.manifest.resources.map((resource) => ({
              sha256: resource.sha256,
              role: resource.role,
              version: resource.version,
              license: resource.license,
            })),
          },
        },
      };
    },
  };
}

export async function loadExternalAnalyzerPlugins(
  manifestPaths: readonly string[],
  mediaPolicy: MediaPolicy,
  projects: ProjectStore,
): Promise<AnalyzerPluginLoadResult> {
  const plugins: AnalyzerPlugin[] = [];
  const descriptors: AnalyzerDescriptor[] = [];
  const ids = new Set<string>();
  const capabilities = new Set<string>();
  for (const path of manifestPaths) {
    const loaded = await readManifest(path);
    if (ids.has(loaded.manifest.id)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Duplicate analyzer id ${loaded.manifest.id}`,
        422,
      );
    }
    if (capabilities.has(loaded.manifest.capabilityId)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Duplicate analyzer capability ${loaded.manifest.capabilityId}`,
        422,
      );
    }
    ids.add(loaded.manifest.id);
    capabilities.add(loaded.manifest.capabilityId);
    if (loaded.unavailableReason === undefined) {
      const plugin = externalPlugin(loaded, mediaPolicy, projects);
      plugins.push(plugin);
      descriptors.push(plugin.descriptor);
    } else {
      descriptors.push(descriptor(loaded, false));
    }
  }
  return { plugins, descriptors };
}
