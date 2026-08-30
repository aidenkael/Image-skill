import type { AssetRole } from '@/core/assets';
import type {
  BenchmarkJudgeResult,
  BenchmarkScenario,
  ReferencePackPlan,
} from '@/core/benchmark-lab';
import type {
  HeroBatchReview,
  HeroBrief,
  HeroHumanPolicy,
} from '@/core/hero-workflow';
import type { ProductIntelligencePayload } from '@/core/intelligence';

export interface VisionAssetInput {
  assetId: string;
  role: AssetRole;
  mimeType: 'image/jpeg';
  buffer: Buffer;
}

export interface ProductIntelligenceInput {
  workspaceId: string;
  workspaceName: string;
  assets: VisionAssetInput[];
}

/**
 * Hero Director 输入：只依赖源商品图本身，不消费 Product Intelligence。
 * Product Intelligence 是独立的拼图文案/证据能力，不是 Hero 前置条件。
 */
export interface HeroDirectorInput {
  workspaceId: string;
  taskId: string;
  workspaceName: string;
  asset: VisionAssetInput;
  humanPolicy: HeroHumanPolicy;
  creativeIntent?: string;
}

/**
 * 批量 QA 输入：一次调用包含源图 + 全部候选图。
 */
export interface HeroBatchReviewInput {
  workspaceId: string;
  taskId: string;
  source: VisionAssetInput;
  generated: VisionAssetInput[];
  brief: HeroBrief;
  humanPolicy: HeroHumanPolicy;
}

/**
 * Benchmark Lab Reference Pack 规划输入：只看源商品图，识别最易被生成破坏的身份细节。
 * 独立 R&D 域，不消费正式 Workspace/Intelligence 数据。
 */
export interface BenchmarkReferencePackPlanInput {
  runId: string;
  sourceBuffer: Buffer;
}

/**
 * Benchmark Lab Judge 输入：源图 + 参考裁剪 + 全部候选一次进入 Vision。
 */
export interface BenchmarkJudgeInput {
  runId: string;
  scenario: BenchmarkScenario;
  /** 确定性场景目标文本，供 judge 理解候选应处的物理状态 */
  scenarioGoal: string;
  sourceBuffer: Buffer;
  cropBuffers: Buffer[];
  candidateBuffers: Buffer[];
}

/**
 * Vision 能力统一接口：商品分析、Hero 摄影策划（Director）、Hero 批量质检，
 * 以及 Benchmark Lab 的 Reference Pack 规划与候选判定。
 */
export interface VisionProvider {
  analyze(input: ProductIntelligenceInput): Promise<ProductIntelligencePayload>;

  directHero(input: HeroDirectorInput): Promise<HeroBrief>;

  reviewHeroBatch(input: HeroBatchReviewInput): Promise<HeroBatchReview>;

  planBenchmarkReferencePack(input: BenchmarkReferencePackPlanInput): Promise<ReferencePackPlan>;

  judgeBenchmarkCandidates(input: BenchmarkJudgeInput): Promise<BenchmarkJudgeResult[]>;
}
