import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { DaemonConfig } from "../config.js";
import { EngineWorkerClient } from "../engine/worker-client.js";
import { EventBus } from "../events/event-bus.js";
import { JobManager } from "../jobs/job-manager.js";
import { MediaPolicy } from "../security/media-policy.js";
import { ProjectStore } from "../store/project-store.js";
import { RuntimeDatabase } from "../store/runtime-database.js";
import { TransactionEngine } from "../domain/transaction-engine.js";
import { CapabilityService } from "./capability-service.js";
import { AgentService } from "../agents/agent-service.js";
import { ProviderRegistry } from "../agents/provider.js";
import { OtioInterchangeService } from "../interchange/otio.js";
import { AnalysisService } from "../analysis/analysis-service.js";
import { AssetService } from "../assets/asset-service.js";
import { CaptionInterchangeService } from "../interchange/captions.js";
import { loadExternalAnalyzerPlugins } from "../analysis/external-analyzer.js";
import { loadVertexGeminiAnalyzer } from "../analysis/vertex-gemini-analyzer.js";
import { SemanticService } from "../semantic/semantic-service.js";
import { ObservabilityService } from "../observability/observability-service.js";

export interface FrameOSServices {
  config: DaemonConfig;
  projects: ProjectStore;
  transactions: TransactionEngine;
  capabilities: CapabilityService;
  worker: EngineWorkerClient;
  jobs: JobManager;
  database: RuntimeDatabase;
  events: EventBus;
  agents: AgentService;
  interchange: OtioInterchangeService;
  analysis: AnalysisService;
  assets: AssetService;
  captions: CaptionInterchangeService;
  semantic: SemanticService;
  observability: ObservabilityService;
  close(): Promise<void>;
}

export async function createServices(
  config: DaemonConfig,
): Promise<FrameOSServices> {
  const projects = new ProjectStore(config.dataDirectory);
  await projects.initialize();
  const database = new RuntimeDatabase(
    resolve(config.dataDirectory, "runtime.sqlite"),
  );
  await database.initialize();
  const uploadStagingDirectory = resolve(config.dataDirectory, "uploads");
  await mkdir(uploadStagingDirectory, { recursive: true });
  const mediaPolicy = new MediaPolicy([
    ...config.allowedMediaRoots,
    uploadStagingDirectory,
  ]);
  await mediaPolicy.initialize();
  const worker = new EngineWorkerClient(config.engineWorkerPath);
  const events = new EventBus();
  const observability = new ObservabilityService(config.dataDirectory);
  await observability.initialize();
  const unsubscribeObservability = events.subscribe((event) =>
    observability.recordEvent(event),
  );
  const externalAnalyzers = await loadExternalAnalyzerPlugins(
    config.analyzerManifestPaths ?? [],
    mediaPolicy,
    projects,
  );
  const capabilities = new CapabilityService(worker);
  const transactions = new TransactionEngine(
    projects,
    mediaPolicy,
    capabilities,
  );
  const jobs = new JobManager(
    database,
    projects,
    worker,
    events,
    config.dataDirectory,
  );
  const vertexGeminiAnalyzer = loadVertexGeminiAnalyzer(
    process.env,
    mediaPolicy,
    projects,
    database,
    observability,
  );
  const analysis = new AnalysisService(
    database,
    projects,
    transactions,
    jobs,
    events,
    mediaPolicy,
    {
      plugins: [...externalAnalyzers.plugins, ...vertexGeminiAnalyzer.plugins],
      descriptors: [
        ...externalAnalyzers.descriptors,
        ...vertexGeminiAnalyzer.descriptors,
      ],
    },
  );
  capabilities.setAnalyzerDescriptorProvider(() => analysis.listAnalyzers());
  const assets = new AssetService(
    projects,
    transactions,
    mediaPolicy,
    events,
    worker,
    jobs,
  );
  const captions = new CaptionInterchangeService(projects, transactions);
  const semantic = new SemanticService(projects, analysis);
  const providers = ProviderRegistry.fromEnvironment();
  const agents = new AgentService(
    database,
    projects,
    capabilities,
    providers,
    events,
    transactions,
    analysis,
    jobs,
  );
  const interchange = new OtioInterchangeService(projects, mediaPolicy);
  return {
    config,
    projects,
    transactions,
    capabilities,
    worker,
    jobs,
    database,
    events,
    agents,
    interchange,
    analysis,
    assets,
    captions,
    semantic,
    observability,
    async close() {
      await jobs.shutdown();
      unsubscribeObservability();
      await observability.close();
      database.close();
    },
  };
}
