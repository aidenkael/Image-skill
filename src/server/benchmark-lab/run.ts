import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BENCHMARK_CANDIDATES_PER_RUN,
  BenchmarkRunSummarySchema,
  type BenchmarkCandidateRecord,
  type BenchmarkFailureRank,
  type BenchmarkHardFailure,
  type BenchmarkLane,
  type BenchmarkRunRecord,
  type BenchmarkRunRequest,
  type BenchmarkRunSummary,
  type BenchmarkScenario,
} from '@/core/benchmark-lab';
import type { AISettingsPublic } from '@/core/system';
import { readImageMeta } from '@/server/image/sharp';
import {
  createActiveVisionProvider,
  imageProviderFromConfig,
  visionProviderFromConfig,
} from '@/server/providers/factory';
import type { GeneratedImage, ImageProvider } from '@/server/providers/image-provider';
import { providerFetchError, providerHttpError } from '@/server/providers/provider-errors';
import type { VisionProvider } from '@/server/providers/vision-provider';
import {
  getAISettingsPublic,
  resolveProfileImageConfig,
  resolveProfileVisionConfig,
} from '@/server/settings/ai';
import { ensureDir, runtimePath, writeJson } from '@/server/storage/fs-store';
import { judgeBenchmarkRun } from './judge';
import { getLanePreset, laneCapabilityIssue, laneEditRegionsEnabled } from './lanes';
import { planReferencePack, type BenchmarkReferencePack } from './reference-pack';
import { buildBenchmarkPrompt } from './scenarios';

/**
 * Benchmark Lab 编排：
 * 源图 → 一次性 Reference Pack → 每个场景 × 每个 lane：
 *   解析兼容配置 → 不支持则标记 unavailable → 恰好 4 张候选 → 判定 4 张 → 落盘。
 * 无自动重试、无补生、无隐藏 prompt 变换；这是实验台，不是自愈工作流。
 */

export interface RunBenchmarkInput extends BenchmarkRunRequest {
  sourceBuffer: Buffer;
  sourceFileName: string;
}

export interface BenchmarkRunDependencies {
  resolveVisionProvider: (profileId: string | null | undefined) => Promise<VisionProvider>;
  resolveImageProvider: (profileId: string) => Promise<ImageProvider>;
  getSettings: () => Promise<AISettingsPublic>;
  downloadImage: (url: string) => Promise<Buffer>;
}

export function benchmarkFileUrl(runId: string, ...segments: string[]): string {
  return `/api/benchmark/files/${runId}/${segments.join('/')}`;
}

const defaultDependencies: BenchmarkRunDependencies = {
  resolveVisionProvider: async (profileId) =>
    profileId ? visionProviderForProfile(profileId) : createActiveVisionProvider(),
  resolveImageProvider: async (profileId) =>
    imageProviderFromConfig(await resolveProfileImageConfig(profileId)),
  getSettings: () => getAISettingsPublic(),
  downloadImage: downloadGeneratedImage,
};

async function visionProviderForProfile(profileId: string): Promise<VisionProvider> {
  return visionProviderFromConfig(await resolveProfileVisionConfig(profileId));
}

async function downloadGeneratedImage(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    throw providerFetchError(error);
  }
  if (!response.ok) throw providerHttpError(response.status);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error('下载的生成图片为空');
  return buffer;
}

function sourceExtension(fileName: string): string {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'png';
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function unavailableRun(scenario: BenchmarkScenario, lane: BenchmarkLane, reason: string): BenchmarkRunRecord {
  return {
    scenario,
    lane,
    status: 'unavailable',
    statusReason: reason.slice(0, 500),
    usedEditRegions: false,
    usedReferenceCount: 0,
    passCount: 0,
    failCount: 0,
    candidates: [],
    hardFailureCounts: {},
  };
}

function errorRun(scenario: BenchmarkScenario, lane: BenchmarkLane, reason: string): BenchmarkRunRecord {
  return { ...unavailableRun(scenario, lane, reason), status: 'error' };
}

/** lane → 生图配置：Benchmark 具名 lane 必须显式指定 laneProfileId，不自动 fallback。 */
function resolveLaneProfileId(
  lane: BenchmarkLane,
  laneProfileIds: RunBenchmarkInput['laneProfileIds'],
  settings: AISettingsPublic,
): { profileId?: string; reason?: string } {
  const preset = getLanePreset(lane);
  const requested = laneProfileIds?.[lane];
  if (!requested) {
    return { reason: `lane ${lane} 未显式选择生图配置，该路线不可用。` };
  }
  const profile = settings.profiles.find((item) => item.id === requested);
  if (!profile) return { reason: `lane ${lane} 选择的生图配置不存在` };
  if (!profile.image.enabled) return { reason: `lane ${lane} 选择的生图配置未启用生图能力` };
  if (profile.image.driver !== preset.driverTarget) {
    return { reason: `lane ${lane} 选择的配置驱动（${profile.image.driver}）与路线要求（${preset.driverTarget}）不匹配` };
  }
  return { profileId: requested };
}

async function saveCandidate(
  image: GeneratedImage,
  index: number,
  outDir: string,
  deps: BenchmarkRunDependencies,
): Promise<{ path: string; buffer: Buffer }> {
  let buffer: Buffer;
  if (image.localPath) {
    buffer = await fs.readFile(image.localPath);
  } else if (image.url) {
    buffer = await deps.downloadImage(image.url);
  } else {
    throw new Error(`候选 ${index + 1} 缺少结果地址`);
  }
  const meta = await readImageMeta(buffer).catch(() => null);
  const extension = !meta ? 'png' : meta.format === 'jpeg' ? 'jpg' : meta.format === 'webp' ? 'webp' : 'png';
  const filePath = path.join(outDir, `candidate-${index + 1}.${extension}`);
  await fs.writeFile(filePath, buffer);
  return { path: filePath, buffer };
}

async function executeLaneRun(options: {
  runId: string;
  scenario: BenchmarkScenario;
  lane: BenchmarkLane;
  prompt: string;
  ratio: RunBenchmarkInput['ratio'];
  sourcePath: string;
  pack: BenchmarkReferencePack;
  laneProfileIds: RunBenchmarkInput['laneProfileIds'];
  settings: AISettingsPublic;
  visionProvider: VisionProvider;
  deps: BenchmarkRunDependencies;
}): Promise<BenchmarkRunRecord> {
  const { scenario, lane, runId, pack, deps } = options;
  const preset = getLanePreset(lane);

  const resolved = resolveLaneProfileId(lane, options.laneProfileIds, options.settings);
  if (!resolved.profileId) return unavailableRun(scenario, lane, resolved.reason ?? '无法解析生图配置');

  let provider: ImageProvider;
  try {
    provider = await deps.resolveImageProvider(resolved.profileId);
  } catch (error) {
    return unavailableRun(scenario, lane, error instanceof Error ? error.message : '生图配置解析失败');
  }

  const capabilities = provider.capabilities();
  const capabilityIssue = laneCapabilityIssue(preset, capabilities);
  if (capabilityIssue) return unavailableRun(scenario, lane, capabilityIssue);
  const usedEditRegions = laneEditRegionsEnabled(preset, capabilities);

  // Reference Pack 截断：按 provider 真实 maxReferenceImages 截取前 N 张
  const usedRefs = preset.useReferencePack
    ? pack.crops.slice(0, capabilities.maxReferenceImages)
    : [];

  const outDir = await ensureDir('benchmark-lab', runId, scenario, lane);
  try {
    const generated = await provider.generate({
      imagePath: options.sourcePath,
      prompt: options.prompt,
      ratio: options.ratio,
      count: BENCHMARK_CANDIDATES_PER_RUN,
      ...(usedRefs.length > 0
        ? { referenceImagePaths: usedRefs.map((item) => item.path) }
        : {}),
      promptEnhancement: preset.promptEnhancement,
      ...(usedEditRegions
        ? {
          editRegions: pack.crops.map((item, cropIndex) => ({
            imageIndex: cropIndex + 1,
            boxes: [{
              x1: item.crop.x,
              y1: item.crop.y,
              x2: item.crop.x + item.crop.width,
              y2: item.crop.y + item.crop.height,
            }],
          })),
        }
        : {}),
      benchmarkTrace: { runId, scenario, lane },
    });
    if (generated.length !== BENCHMARK_CANDIDATES_PER_RUN) {
      throw new Error(`模型返回结果数量不完整：要求 ${BENCHMARK_CANDIDATES_PER_RUN} 张，实际 ${generated.length} 张`);
    }

    const candidates: Array<{ path: string }> = [];
    for (let index = 0; index < generated.length; index += 1) {
      candidates.push(await saveCandidate(generated[index], index, outDir, deps));
    }

    const judged = await judgeBenchmarkRun({
      visionProvider: options.visionProvider,
      runId,
      scenario,
      sourceImagePath: options.sourcePath,
      cropPaths: pack.crops.map((item) => item.path),
      candidatePaths: candidates.map((item) => item.path),
    });

    const candidateRecords: BenchmarkCandidateRecord[] = judged.map((item, index) => ({
      candidateIndex: item.candidateIndex,
      status: item.status,
      hardFailures: item.hardFailures,
      notes: item.notes,
      url: benchmarkFileUrl(runId, scenario, lane, path.basename(candidates[index].path)),
    }));
    const hardFailureCounts: Record<string, number> = {};
    for (const record of candidateRecords) {
      for (const failure of record.hardFailures) {
        hardFailureCounts[failure] = (hardFailureCounts[failure] ?? 0) + 1;
      }
    }
    const passCount = candidateRecords.filter((record) => record.status === 'pass').length;
    const record: BenchmarkRunRecord = {
      scenario,
      lane,
      status: 'completed',
      statusReason: null,
      usedEditRegions,
      usedReferenceCount: usedRefs.length,
      passCount,
      failCount: candidateRecords.length - passCount,
      candidates: candidateRecords,
      hardFailureCounts,
    };
    await writeJson(path.join(outDir, 'judge.json'), record);
    return record;
  } catch (error) {
    const message = error instanceof Error ? error.message : '执行失败';
    const record = errorRun(scenario, lane, message);
    await writeJson(path.join(outDir, 'judge.json'), record);
    return record;
  }
}

export async function runBenchmark(
  input: RunBenchmarkInput,
  overrides: Partial<BenchmarkRunDependencies> = {},
): Promise<BenchmarkRunSummary> {
  const deps: BenchmarkRunDependencies = { ...defaultDependencies, ...overrides };
  const scenarios = dedupe(input.scenarios);
  const lanes = dedupe(input.lanes);

  const runId = crypto.randomUUID();
  const runDir = await ensureDir('benchmark-lab', runId);
  const sourceDir = await ensureDir('benchmark-lab', runId, 'source');
  const refsDir = await ensureDir('benchmark-lab', runId, 'refs');

  const sourcePath = path.join(sourceDir, `source.${sourceExtension(input.sourceFileName)}`);
  await fs.writeFile(sourcePath, input.sourceBuffer);

  const settings = await deps.getSettings();
  const visionProvider = await deps.resolveVisionProvider(input.visionProfileId ?? settings.activeVisionProfileId);

  // Reference Pack 只创建一次，全部场景与 lane 复用
  const pack = await planReferencePack({
    runId,
    sourcePath,
    sourceBuffer: input.sourceBuffer,
    refsDir,
    visionProvider,
    cropUrl: (fileName) => benchmarkFileUrl(runId, 'refs', fileName),
  });

  const runs: BenchmarkRunRecord[] = [];
  for (const scenario of scenarios) {
    const prompt = buildBenchmarkPrompt(scenario, input.note);
    for (const lane of lanes) {
      runs.push(await executeLaneRun({
        runId,
        scenario,
        lane,
        prompt,
        ratio: input.ratio,
        sourcePath,
        pack,
        laneProfileIds: input.laneProfileIds,
        settings,
        visionProvider,
        deps,
      }));
    }
  }

  // 聚合：按 lane 汇总通过数；全局硬性失败分布
  const passByLane = new Map<BenchmarkLane, number>();
  const failureTotals: Record<string, number> = {};
  let totalPass = 0;
  let totalFail = 0;
  for (const run of runs) {
    passByLane.set(run.lane, (passByLane.get(run.lane) ?? 0) + run.passCount);
    totalPass += run.passCount;
    totalFail += run.failCount;
    for (const [failure, count] of Object.entries(run.hardFailureCounts)) {
      failureTotals[failure] = (failureTotals[failure] ?? 0) + count;
    }
  }
  const maxPass = Math.max(0, ...passByLane.values());
  const bestLanes = maxPass > 0
    ? [...passByLane.entries()].filter(([, count]) => count === maxPass).map(([lane]) => lane)
    : [];
  const topFailureReasons: BenchmarkFailureRank[] = Object.entries(failureTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason: reason as BenchmarkHardFailure, count }));

  const summary = BenchmarkRunSummarySchema.parse({
    runId,
    createdAt: new Date().toISOString(),
    referencePack: {
      summary: pack.plan.summary,
      sourceUrl: benchmarkFileUrl(runId, 'source', path.basename(sourcePath)),
      crops: pack.crops.map((item) => ({ ...item.crop, url: item.url })),
    },
    runs,
    bestLanes,
    topFailureReasons,
    totalPass,
    totalFail,
  });
  await writeJson(path.join(runDir, 'summary.json'), summary);
  return summary;
}

/** Lab 文件服务的安全路径校验：仅允许 benchmark-lab/<uuid>/ 下的图片文件。 */
export function benchmarkFilePath(runId: string, segments: string[]): string {
  if (segments.length === 0) throw new Error('路径不合法');
  const fileName = segments.join('/');
  if (!/^[A-Za-z0-9._/-]+$/.test(fileName) || fileName.includes('..')) {
    throw new Error('路径不合法');
  }
  return runtimePath('benchmark-lab', runId, ...segments);
}
