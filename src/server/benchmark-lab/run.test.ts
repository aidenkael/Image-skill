import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BenchmarkJudgeResult } from '@/core/benchmark-lab';
import type { AISettingsPublic } from '@/core/system';
import type { GeneratedImage, ImageGenerationInput, ImageProvider } from '@/server/providers/image-provider';
import type { VisionProvider } from '@/server/providers/vision-provider';
import { exists, runtimePath } from '@/server/storage/fs-store';
import { runBenchmark } from './run';

const DASH_PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const ARK_PROFILE_ID = '22222222-2222-4222-8222-222222222222';

let root = '';
let runtimeRoot = '';
let sourceBuffer: Buffer;
let candidateFilePath = '';
let previousRuntimeDir: string | undefined;

const settings: AISettingsPublic = {
  activeVisionProfileId: DASH_PROFILE_ID,
  activeImageProfileId: DASH_PROFILE_ID,
  profiles: [
    {
      id: DASH_PROFILE_ID,
      name: '百炼测试配置',
      preset: 'aliyun-qwen',
      maskedKey: 'sk-test****',
      vision: {
        enabled: true, driver: 'openai-compatible-vision', endpoint: 'https://example.test/vision', model: 'vision-model',
        compatibility: { imageInput: true, structuredOutput: 'auto' },
      },
      image: {
        enabled: true, driver: 'dashscope-image', endpoint: 'https://example.test/image', model: 'image-model',
        compatibility: {
          referenceImage: true, batchMode: 'native', sizeMode: 'mapped',
          sizeByRatio: { '1:1': '1024*1024', '3:4': '768*1344', '4:3': '1344*768' },
          promptEnhancement: 'auto',
          promptEnhancementSupported: true,
          maxReferenceImages: 2,
        },
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: ARK_PROFILE_ID,
      name: '方舟测试配置',
      preset: 'volcengine-ark',
      maskedKey: 'ark-test****',
      vision: {
        enabled: false, driver: 'openai-compatible-vision', endpoint: 'https://example.test/vision', model: 'vision-model',
        compatibility: { imageInput: true, structuredOutput: 'auto' },
      },
      image: {
        enabled: true, driver: 'volcengine-ark-image', endpoint: 'https://example.test/ark', model: 'ark-model',
        compatibility: {
          referenceImage: true, batchMode: 'single', sizeMode: 'mapped',
          sizeByRatio: { '1:1': '2048x2048', '3:4': '1536x2048', '4:3': '2048x1536' },
          promptEnhancement: 'off',
          promptEnhancementSupported: false,
          maxReferenceImages: 0,
        },
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

function fakeVisionProvider() {
  const judgeResult = (candidateIndex: number): BenchmarkJudgeResult => ({
    candidateIndex,
    hardFailures: candidateIndex % 2 === 1 ? ['topology_broken'] : [],
    notes: null,
  });
  return {
    planBenchmarkReferencePack: vi.fn(async () => ({
      summary: '链条是主要身份风险',
      crops: [{ key: 'chain', label: '链条', reason: '易被拆分', x: 0.2, y: 0.2, width: 0.3, height: 0.3 }],
    })),
    judgeBenchmarkCandidates: vi.fn(async (input: { candidateBuffers: unknown[] }) =>
      input.candidateBuffers.map((_, index) => judgeResult(index))),
    analyze: vi.fn(async () => { throw new Error('测试中不应调用分析'); }) as VisionProvider['analyze'],
    directHero: vi.fn(async () => { throw new Error('测试中不应调用 Director'); }) as VisionProvider['directHero'],
    reviewHeroBatch: vi.fn(async () => { throw new Error('测试中不应调用批量审片'); }) as VisionProvider['reviewHeroBatch'],
  };
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-run-'));
  runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-runtime-'));
  previousRuntimeDir = process.env.RUNTIME_DIR;
  process.env.RUNTIME_DIR = runtimeRoot;

  sourceBuffer = await sharp({
    create: { width: 120, height: 160, channels: 3, background: { r: 180, g: 60, b: 60 } },
  }).png().toBuffer();
  candidateFilePath = path.join(root, 'generated.png');
  await sharp({
    create: { width: 96, height: 128, channels: 3, background: { r: 60, g: 60, b: 180 } },
  }).png().toFile(candidateFilePath);
});

afterAll(async () => {
  if (previousRuntimeDir === undefined) delete process.env.RUNTIME_DIR;
  else process.env.RUNTIME_DIR = previousRuntimeDir;
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(runtimeRoot, { recursive: true, force: true });
});

function fakeProviders() {
  const dashGenerate = vi.fn(async (_input: ImageGenerationInput): Promise<GeneratedImage[]> =>
    [0, 1, 2, 3].map(() => ({ localPath: candidateFilePath })));
  const arkGenerate = vi.fn(async (_input: ImageGenerationInput): Promise<GeneratedImage[]> =>
    [0, 1, 2, 3].map(() => ({ localPath: candidateFilePath })));
  const dashProvider: ImageProvider = {
    generate: dashGenerate,
    capabilities: () => ({
      supportsMultipleReferences: true,
      maxReferenceImages: 2,
      supportsEditRegions: false,
      supportsPromptEnhancementOverride: true,
    }),
  };
  const arkProvider: ImageProvider = {
    generate: arkGenerate,
    capabilities: () => ({
      supportsMultipleReferences: false,
      maxReferenceImages: 0,
      supportsEditRegions: false,
      supportsPromptEnhancementOverride: false,
    }),
  };
  const downloadImage = vi.fn(async () => { throw new Error('不应发生下载'); });
  return { dashGenerate, arkGenerate, dashProvider, arkProvider, downloadImage };
}

describe('Benchmark 编排器', () => {
  it('一次 Reference Pack 复用于全部场景与 lane；不支持的路线保持不可用且不生成', async () => {
    const vision = fakeVisionProvider();
    const { dashGenerate, arkGenerate, dashProvider, arkProvider, downloadImage } = fakeProviders();

    const summary = await runBenchmark({
      sourceBuffer,
      sourceFileName: 'source.png',
      scenarios: ['human-carry', 'tabletop-placement'],
      lanes: [
        'qwen-single-extend-on', 'qwen-single-extend-off', 'qwen-multi-ref', 'seedream-multi-ref', 'wan-multi-ref',
      ],
      ratio: '3:4',
      laneProfileIds: {
        'qwen-single-extend-on': DASH_PROFILE_ID,
        'qwen-single-extend-off': DASH_PROFILE_ID,
        'qwen-multi-ref': DASH_PROFILE_ID,
        'wan-multi-ref': DASH_PROFILE_ID,
        'seedream-multi-ref': ARK_PROFILE_ID,
      },
    }, {
      resolveVisionProvider: async () => vision,
      resolveImageProvider: async (profileId) => (profileId === DASH_PROFILE_ID ? dashProvider : arkProvider),
      getSettings: async () => settings,
      downloadImage,
    });

    // Reference Pack 只规划一次
    expect(vision.planBenchmarkReferencePack).toHaveBeenCalledTimes(1);
    expect(summary.referencePack.crops).toHaveLength(1);

    // 4 条 dashscope 驱动 lane（含 wan）× 2 场景 = 8 次生成；ark 路线不调用生成
    expect(dashGenerate).toHaveBeenCalledTimes(8);
    expect(arkGenerate).not.toHaveBeenCalled();
    expect(downloadImage).not.toHaveBeenCalled();

    // seedream lane 保持 unavailable，并给出明确原因
    const seedreamRuns = summary.runs.filter((run) => run.lane === 'seedream-multi-ref');
    expect(seedreamRuns).toHaveLength(2);
    for (const run of seedreamRuns) {
      expect(run.status).toBe('unavailable');
      expect(run.statusReason).toMatch(/参考图/);
      expect(run.candidates).toEqual([]);
    }

    // 每个支持的 lane × 场景恰好 4 张候选且全部被判定
    const completed = summary.runs.filter((run) => run.status === 'completed');
    expect(completed).toHaveLength(8);
    for (const run of completed) {
      expect(run.candidates).toHaveLength(4);
      expect(run.passCount).toBe(2);
      expect(run.failCount).toBe(2);
      expect(run.candidates.every((candidate) => candidate.url.startsWith(`/api/benchmark/files/${summary.runId}/`))).toBe(true);
    }

    // lane 请求变量正确：单图路线不带参考图；扩写开/关是真实变量
    const calls = dashGenerate.mock.calls.map((call) => call[0]);
    const onCalls = calls.filter((input) => input.benchmarkTrace?.lane === 'qwen-single-extend-on');
    expect(onCalls).toHaveLength(2);
    for (const input of onCalls) {
      expect(input.promptEnhancement).toBe('on');
      expect(input.referenceImagePaths).toBeUndefined();
      expect(input.count).toBe(4);
    }
    const offCalls = calls.filter((input) => input.benchmarkTrace?.lane === 'qwen-single-extend-off');
    for (const input of offCalls) expect(input.promptEnhancement).toBe('off');
    const multiRefCalls = calls.filter((input) => input.benchmarkTrace?.lane === 'qwen-multi-ref');
    for (const input of multiRefCalls) {
      expect(input.promptEnhancement).toBe('off');
      expect(input.referenceImagePaths).toHaveLength(1);
    }

    // usedReferenceCount 如实记录：单图路线 0；multi-ref 路线用了 1 张（Reference Pack 只有 1 crop）
    const completedRuns = summary.runs.filter((run) => run.status === 'completed');
    for (const run of completedRuns) {
      if (run.lane === 'qwen-single-extend-on' || run.lane === 'qwen-single-extend-off') {
        expect(run.usedReferenceCount).toBe(0);
      }
      if (run.lane === 'qwen-multi-ref') {
        expect(run.usedReferenceCount).toBe(1);
      }
      if (run.lane === 'wan-multi-ref') {
        expect(run.usedReferenceCount).toBe(1);
      }
    }

    // wan lane 预设想用 edit regions，但当前驱动不支持 => 如实记录未使用
    const wanRuns = summary.runs.filter((run) => run.lane === 'wan-multi-ref');
    for (const run of wanRuns) expect(run.usedEditRegions).toBe(false);

    // 聚合统计：并列最佳路线 + 最常见失败原因（4 条 dashscope 路线各 4 通过）
    expect(summary.totalPass).toBe(16);
    expect(summary.totalFail).toBe(16);
    expect([...summary.bestLanes].sort()).toEqual([
      'qwen-multi-ref', 'qwen-single-extend-off', 'qwen-single-extend-on', 'wan-multi-ref',
    ]);
    expect(summary.topFailureReasons[0]).toEqual({ reason: 'topology_broken', count: 16 });

    // 落盘：summary.json 与候选文件真实存在
    await expect(exists(runtimePath('benchmark-lab', summary.runId, 'summary.json'))).resolves.toBe(true);
    const firstCompleted = completed[0];
    for (let index = 1; index <= 4; index += 1) {
      const filePath = runtimePath('benchmark-lab', summary.runId, firstCompleted.scenario, firstCompleted.lane, `candidate-${index}.png`);
      await expect(exists(filePath)).resolves.toBe(true);
    }
  }, 60_000);

  it('Reference Pack 3 crops + provider maxReferenceImages=2 => 只传前 2 张，usedReferenceCount=2', async () => {
    const vision = fakeVisionProvider();
    // Override Vision to return 3 crops
    vi.mocked(vision.planBenchmarkReferencePack).mockResolvedValue({
      summary: '三个风险区域',
      crops: [
        { key: 'a', label: 'A', reason: 'r', x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        { key: 'b', label: 'B', reason: 'r', x: 0.3, y: 0.3, width: 0.2, height: 0.2 },
        { key: 'c', label: 'C', reason: 'r', x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
      ],
    });
    const refPaths: Array<string[] | undefined> = [];
    const dashGenerate = vi.fn(async (input: ImageGenerationInput): Promise<GeneratedImage[]> => {
      refPaths.push(input.referenceImagePaths ? [...input.referenceImagePaths] : undefined);
      return [0, 1, 2, 3].map(() => ({ localPath: candidateFilePath }));
    });
    const dashProvider: ImageProvider = {
      generate: dashGenerate,
      capabilities: () => ({
        supportsMultipleReferences: true,
        maxReferenceImages: 2,
        supportsEditRegions: false,
        supportsPromptEnhancementOverride: true,
      }),
    };
    const summary = await runBenchmark({
      sourceBuffer, sourceFileName: 'source.png',
      scenarios: ['tabletop-placement'],
      lanes: ['qwen-multi-ref'],
      ratio: '3:4',
      laneProfileIds: { 'qwen-multi-ref': DASH_PROFILE_ID } as Record<string, string>,
    }, {
      resolveVisionProvider: async () => vision,
      resolveImageProvider: async () => dashProvider,
      getSettings: async () => settings,
      downloadImage: vi.fn(async () => { throw new Error('不应发生下载'); }),
    });

    // 3 crops 但 maxReferenceImages=2 → 只传前 2 张
    const multiRefCall = refPaths.find((paths) => paths !== undefined);
    expect(multiRefCall).toBeDefined();
    expect(multiRefCall).toHaveLength(2);

    const run = summary.runs[0];
    expect(run.status).toBe('completed');
    expect(run.usedReferenceCount).toBe(2);
  }, 60_000);

  it('multi-ref lane + provider maxReferenceImages=0 => unavailable', async () => {
    const vision = fakeVisionProvider();
    const zeroRefProvider: ImageProvider = {
      generate: vi.fn(async () => { throw new Error('不应调用'); }),
      capabilities: () => ({
        supportsMultipleReferences: false,
        maxReferenceImages: 0,
        supportsEditRegions: false,
        supportsPromptEnhancementOverride: true,
      }),
    };
    const summary = await runBenchmark({
      sourceBuffer, sourceFileName: 'source.png',
      scenarios: ['tabletop-placement'],
      lanes: ['qwen-multi-ref'],
      ratio: '3:4',
      laneProfileIds: { 'qwen-multi-ref': DASH_PROFILE_ID } as Record<string, string>,
    }, {
      resolveVisionProvider: async () => vision,
      resolveImageProvider: async () => zeroRefProvider,
      getSettings: async () => settings,
      downloadImage: vi.fn(async () => { throw new Error('不应发生下载'); }),
    });
    expect(summary.runs[0].status).toBe('unavailable');
    expect(summary.runs[0].statusReason).toMatch(/参考图/);
  }, 60_000);

  it('未显式选择 lane profile => unavailable，不 fallback', async () => {
    const vision = fakeVisionProvider();
    const dashProvider: ImageProvider = {
      generate: vi.fn(async () => { throw new Error('不应调用'); }),
      capabilities: () => ({
        supportsMultipleReferences: true,
        maxReferenceImages: 2,
        supportsEditRegions: false,
        supportsPromptEnhancementOverride: true,
      }),
    };
    const summary = await runBenchmark({
      sourceBuffer, sourceFileName: 'source.png',
      scenarios: ['tabletop-placement'],
      lanes: ['qwen-single-extend-on', 'wan-multi-ref'],
      ratio: '3:4',
      // 不提供 laneProfileIds
    }, {
      resolveVisionProvider: async () => vision,
      resolveImageProvider: async () => dashProvider,
      getSettings: async () => settings,
      downloadImage: vi.fn(async () => { throw new Error('不应发生下载'); }),
    });
    for (const run of summary.runs) {
      expect(run.status).toBe('unavailable');
      expect(run.statusReason).toMatch(/未显式选择/);
    }
  }, 60_000);
});
