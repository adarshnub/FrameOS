import type {
  AnalysisSegment,
  AnalyzerDescriptor,
  Asset,
  Project,
} from "@frameos/contracts";

export interface AnalyzerContext {
  project: Project;
  asset: Asset;
  parameters: Record<string, unknown>;
  signal: AbortSignal;
  reportProgress(progress: number): void;
}

export interface AnalyzerResult {
  type: string;
  segments: AnalysisSegment[];
  metadata?: Record<string, unknown>;
}

export interface AnalyzerPlugin {
  descriptor: AnalyzerDescriptor;
  analyze(context: AnalyzerContext): Promise<AnalyzerResult>;
}

export interface AnalyzerPluginLoadResult {
  plugins: AnalyzerPlugin[];
  descriptors: AnalyzerDescriptor[];
}
