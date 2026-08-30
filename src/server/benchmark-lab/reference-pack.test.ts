import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReferencePackPlan } from '@/core/benchmark-lab';
import type { VisionProvider } from '@/server/providers/vision-provider';
import { cropReferenceRegions, expandAndClampCrop } from './cropper';
import { planReferencePack } from './reference-pack';

let root = '';
let sourcePath = '';

function fakeVisionProvider(plan: ReferencePackPlan) {
  return {
    planBenchmarkReferencePack: vi.fn(async () => plan),
    judgeBenchmarkCandidates: vi.fn(async () => { throw new Error('测试中不应调用判定'); }),
    analyze: vi.fn(async () => { throw new Error('测试中不应调用分析'); }) as VisionProvider['analyze'],
    directHero: vi.fn(async () => { throw new Error('测试中不应调用 Director'); }) as VisionProvider['directHero'],
    reviewHeroBatch: vi.fn(async () => { throw new Error('测试中不应调用批量审片'); }) as VisionProvider['reviewHeroBatch'],
  };
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-refpack-'));
  sourcePath = path.join(root, 'source.png');
  await sharp({
    create: { width: 200, height: 160, channels: 3, background: { r: 210, g: 60, b: 60 } },
  }).png().toFile(sourcePath);
});
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('expandAndClampCrop（确定性扩边与钳制）', () => {
  it('中心区域按比例外扩且保持确定性', () => {
    const crop = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    const first = expandAndClampCrop(crop, 1000, 800);
    const second = expandAndClampCrop(crop, 1000, 800);
    expect(first).toEqual(second);
    // 外扩后比原始框更大，但仍完全位于图像内
    expect(first.width).toBeGreaterThan(200);
    expect(first.height).toBeGreaterThan(160);
    expect(first.left).toBeLessThan(400);
    expect(first.left + first.width).toBeLessThanOrEqual(1000);
    expect(first.top + first.height).toBeLessThanOrEqual(800);
  });

  it('边缘区域被安全钳制在图像边界内', () => {
    const topLeft = expandAndClampCrop({ x: 0, y: 0, width: 0.3, height: 0.3 }, 100, 100);
    expect(topLeft.left).toBe(0);
    expect(topLeft.top).toBe(0);

    const rightEdge = expandAndClampCrop({ x: 0.88, y: 0.4, width: 0.12, height: 0.2 }, 100, 100);
    expect(rightEdge.left + rightEdge.width).toBeLessThanOrEqual(100);

    const bottomEdge = expandAndClampCrop({ x: 0.4, y: 0.88, width: 0.2, height: 0.12 }, 100, 100);
    expect(bottomEdge.top + bottomEdge.height).toBeLessThanOrEqual(100);
  });

  it('非法图像尺寸直接报错', () => {
    expect(() => expandAndClampCrop({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 0, 100)).toThrow();
  });
});

describe('cropReferenceRegions（裁剪落盘）', () => {
  it('Vision 裁剪计划变成实际裁剪文件，最多 3 张', async () => {
    const outDir = path.join(root, 'crops-1');
    const crops = [
      { key: 'chain', label: '链条', reason: '易被拆分', x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
      { key: 'hardware', label: '五金', reason: '易变形', x: 0.6, y: 0.6, width: 0.25, height: 0.25 },
    ];
    const results = await cropReferenceRegions(sourcePath, crops, outDir);
    expect(results).toHaveLength(2);
    for (const item of results) {
      const meta = await sharp(await fs.readFile(item.path)).metadata();
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    }
  });

  it('超过 3 张的计划被截断为 3 张；空计划不落盘', async () => {
    const outDir = path.join(root, 'crops-2');
    const four = Array.from({ length: 4 }, (_, i) => ({
      key: `k${i}`, label: 'l', reason: 'r',
      x: 0.1 + i * 0.05, y: 0.1, width: 0.1, height: 0.1,
    }));
    const limited = await cropReferenceRegions(sourcePath, four, outDir);
    expect(limited).toHaveLength(3);

    const empty = await cropReferenceRegions(sourcePath, [], path.join(root, 'crops-3'));
    expect(empty).toEqual([]);
  });
});

describe('planReferencePack（Vision 规划 + 确定性裁剪）', () => {
  it('完整流程：调用一次 Vision，裁剪文件与 URL 齐全', async () => {
    const plan: ReferencePackPlan = {
      summary: '链条与五金扣是主要身份风险',
      crops: [
        { key: 'chain', label: '链条', reason: 'AI 常拆分链条', x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
      ],
    };
    const vision = fakeVisionProvider(plan);
    const refsDir = path.join(root, 'refs');
    const pack = await planReferencePack({
      runId: 'run-1',
      sourcePath,
      sourceBuffer: await fs.readFile(sourcePath),
      refsDir,
      visionProvider: vision,
      cropUrl: (fileName) => `/api/benchmark/files/run-1/refs/${fileName}`,
    });

    expect(vision.planBenchmarkReferencePack).toHaveBeenCalledTimes(1);
    expect(pack.plan.summary).toBe(plan.summary);
    expect(pack.crops).toHaveLength(1);
    expect(pack.crops[0].url).toBe('/api/benchmark/files/run-1/refs/crop-1.png');
    await expect(fs.access(pack.crops[0].path)).resolves.toBeUndefined();
  });

  it('无高风险区域时返回 0 张裁剪', async () => {
    const vision = fakeVisionProvider({ summary: '整体结构简单', crops: [] });
    const pack = await planReferencePack({
      runId: 'run-2',
      sourcePath,
      sourceBuffer: await fs.readFile(sourcePath),
      refsDir: path.join(root, 'refs-empty'),
      visionProvider: vision,
      cropUrl: (fileName) => `/refs/${fileName}`,
    });
    expect(pack.crops).toEqual([]);
  });
});
