import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";

export const bearerTokenScopes = [
  "project:read",
  "project:write",
  "render:write",
  "agent:run",
  "mcp",
  "admin",
] as const;
export type BearerTokenScope = (typeof bearerTokenScopes)[number];

export interface ScopedBearerToken {
  id: string;
  token: string;
  scopes: BearerTokenScope[];
}

export interface DaemonConfig {
  host: string;
  port: number;
  dataDirectory: string;
  authToken: string;
  authTokenPath: string;
  allowedMediaRoots: string[];
  remoteMode: boolean;
  tlsCertificatePath?: string;
  tlsKeyPath?: string;
  engineWorkerPath?: string;
  analyzerManifestPaths?: string[];
  scopedTokens?: ScopedBearerToken[];
  environmentFilePath?: string;
  workspaceRoot?: string;
}

async function findWorkspaceRoot(
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const configuredRoot = environment.FRAMEOS_WORKSPACE_ROOT?.trim();
  if (configuredRoot !== undefined && configuredRoot.length > 0) {
    return resolve(configuredRoot);
  }
  let candidate = resolve(environment.INIT_CWD ?? process.cwd());
  for (let depth = 0; depth < 12; depth += 1) {
    try {
      const manifest = JSON.parse(
        await readFile(resolve(candidate, "package.json"), "utf8"),
      ) as { name?: unknown; workspaces?: unknown };
      if (manifest.name === "frameos" && Array.isArray(manifest.workspaces)) {
        return candidate;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // Invalid or unrelated package manifests are skipped while walking up.
      }
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return resolve(environment.INIT_CWD ?? process.cwd());
}

async function loadEnvironmentFile(
  environment: NodeJS.ProcessEnv,
  workspaceRoot: string,
): Promise<string | undefined> {
  const explicitPath = environment.FRAMEOS_ENV_FILE?.trim() || undefined;
  if (environment !== process.env && explicitPath === undefined)
    return undefined;
  const environmentFilePath = resolve(workspaceRoot, explicitPath ?? ".env");
  let contents: string;
  try {
    contents = await readFile(environmentFilePath, "utf8");
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" &&
      explicitPath === undefined
    ) {
      return undefined;
    }
    throw error;
  }
  const parsed = parseEnv(contents);
  for (const [key, value] of Object.entries(parsed)) {
    if (key.startsWith("FRAMEOS_") && environment[key] === undefined) {
      environment[key] = value;
    }
  }
  return environmentFilePath;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function parsePort(value: string | undefined): number {
  const port = value === undefined ? 31_415 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("FRAMEOS_PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseScopedTokens(value: string | undefined): ScopedBearerToken[] {
  if (value === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("FRAMEOS_SCOPED_TOKENS must be valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) {
    throw new Error(
      "FRAMEOS_SCOPED_TOKENS must be a non-empty array with at most 100 entries",
    );
  }
  const knownScopes = new Set<string>(bearerTokenScopes);
  const ids = new Set<string>();
  const tokens = new Set<string>();
  return parsed.map((entry, index) => {
    if (typeof entry !== "object" || entry === null)
      throw new Error(`Scoped token ${index} must be an object`);
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      !/^[a-zA-Z0-9._-]{1,128}$/u.test(candidate.id)
    ) {
      throw new Error(`Scoped token ${index} has an invalid id`);
    }
    if (typeof candidate.token !== "string" || candidate.token.length < 32) {
      throw new Error(
        `Scoped token ${index} must contain a token of at least 32 characters`,
      );
    }
    if (!Array.isArray(candidate.scopes) || candidate.scopes.length === 0) {
      throw new Error(`Scoped token ${index} must contain at least one scope`);
    }
    const scopes = candidate.scopes.map((scope) => {
      if (typeof scope !== "string" || !knownScopes.has(scope)) {
        throw new Error(`Scoped token ${index} contains an unknown scope`);
      }
      return scope as BearerTokenScope;
    });
    if (ids.has(candidate.id) || tokens.has(candidate.token))
      throw new Error("Scoped token ids and secrets must be unique");
    ids.add(candidate.id);
    tokens.add(candidate.token);
    return {
      id: candidate.id,
      token: candidate.token,
      scopes: [...new Set(scopes)],
    };
  });
}

async function loadOrCreateToken(
  dataDirectory: string,
  configuredToken?: string,
): Promise<{
  token: string;
  tokenPath: string;
}> {
  const tokenPath = resolve(dataDirectory, "auth-token");
  if (configuredToken !== undefined) {
    if (configuredToken.length < 32) {
      throw new Error("FRAMEOS_AUTH_TOKEN must contain at least 32 characters");
    }
    return { token: configuredToken, tokenPath };
  }

  try {
    const existing = (await readFile(tokenPath, "utf8")).trim();
    if (existing.length >= 32) {
      return { token: existing, tokenPath };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  const token = randomBytes(32).toString("base64url");
  await writeFile(tokenPath, `${token}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") {
      throw error;
    }
  });
  const storedToken = (await readFile(tokenPath, "utf8")).trim();
  return { token: storedToken, tokenPath };
}

export async function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<DaemonConfig> {
  const workspaceRoot = await findWorkspaceRoot(environment);
  const environmentFilePath = await loadEnvironmentFile(
    environment,
    workspaceRoot,
  );
  const dataDirectory = resolve(
    workspaceRoot,
    environment.FRAMEOS_DATA_DIR ?? ".frameos-data",
  );
  await mkdir(dataDirectory, { recursive: true });
  const host = environment.FRAMEOS_HOST ?? "127.0.0.1";
  const remoteMode = !isLoopbackHost(host);
  if (isIP(host) === 0 && host !== "localhost") {
    throw new Error("FRAMEOS_HOST must be localhost or a literal IP address");
  }

  const configuredTlsCertificatePath =
    environment.FRAMEOS_TLS_CERT?.trim() || undefined;
  const configuredTlsKeyPath = environment.FRAMEOS_TLS_KEY?.trim() || undefined;
  const tlsCertificatePath =
    configuredTlsCertificatePath === undefined
      ? undefined
      : resolve(workspaceRoot, configuredTlsCertificatePath);
  const tlsKeyPath =
    configuredTlsKeyPath === undefined
      ? undefined
      : resolve(workspaceRoot, configuredTlsKeyPath);
  if (
    remoteMode &&
    (tlsCertificatePath === undefined || tlsKeyPath === undefined)
  ) {
    throw new Error(
      "Remote mode requires FRAMEOS_TLS_CERT and FRAMEOS_TLS_KEY",
    );
  }
  const scopedTokens = parseScopedTokens(environment.FRAMEOS_SCOPED_TOKENS);
  if (remoteMode && scopedTokens.length === 0) {
    throw new Error(
      "Remote mode requires FRAMEOS_SCOPED_TOKENS with explicit least-privilege scopes",
    );
  }

  const { token, tokenPath } = await loadOrCreateToken(
    dataDirectory,
    environment.FRAMEOS_AUTH_TOKEN,
  );
  const configuredRoots = environment.FRAMEOS_MEDIA_ROOTS?.split(";").filter(
    Boolean,
  ) ?? [workspaceRoot];
  const allowedMediaRoots = configuredRoots.map((root) =>
    resolve(workspaceRoot, root),
  );
  const analyzerManifestPaths = (
    environment.FRAMEOS_ANALYZER_MANIFESTS?.split(";") ?? []
  )
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => resolve(workspaceRoot, path));
  if (analyzerManifestPaths.length > 64) {
    throw new Error("FRAMEOS_ANALYZER_MANIFESTS is limited to 64 manifests");
  }

  return {
    host,
    port: parsePort(environment.FRAMEOS_PORT),
    dataDirectory,
    authToken: token,
    authTokenPath: tokenPath,
    allowedMediaRoots,
    remoteMode,
    workspaceRoot,
    ...(environmentFilePath === undefined ? {} : { environmentFilePath }),
    ...(tlsCertificatePath === undefined ? {} : { tlsCertificatePath }),
    ...(tlsKeyPath === undefined ? {} : { tlsKeyPath }),
    ...(environment.FRAMEOS_ENGINE_WORKER === undefined
      ? {}
      : {
          engineWorkerPath: resolve(
            workspaceRoot,
            environment.FRAMEOS_ENGINE_WORKER,
          ),
        }),
    ...(analyzerManifestPaths.length === 0 ? {} : { analyzerManifestPaths }),
    ...(scopedTokens.length === 0 ? {} : { scopedTokens }),
  };
}
