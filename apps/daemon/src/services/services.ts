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
import { SemanticService } from "../semantic/semantic-service.js";

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
  const mediaPolicy = new MediaPolicy(config.allowedMediaRoots);
  await mediaPolicy.initialize();
  const worker = new EngineWorkerClient(config.engineWorkerPath);
  const events = new EventBus();
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
  const analysis = new AnalysisService(
    database,
    projects,
    transactions,
    jobs,
    events,
    mediaPolicy,
    externalAnalyzers,
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
    async close() {
      await jobs.shutdown();
      database.close();
    },
  };
}
