'use client';

import {
  BENCHMARK_LANE_LABELS,
  BENCHMARK_SCENARIO_LABELS,
  type BenchmarkLane,
  type BenchmarkRunSummary,
  type BenchmarkScenario,
} from '@/core/benchmark-lab';
import type { AISettingsPublic } from '@/core/system';
import { fetchJson } from '@/features/shared/http';

/** Benchmark Lab 客户端契约：只做 HTTP 封装，不包含服务端逻辑。 */

export const ALL_BENCHMARK_SCENARIOS = Object.keys(BENCHMARK_SCENARIO_LABELS) as BenchmarkScenario[];
export const ALL_BENCHMARK_LANES = Object.keys(BENCHMARK_LANE_LABELS) as BenchmarkLane[];
export { BENCHMARK_LANE_LABELS, BENCHMARK_SCENARIO_LABELS };

export interface BenchmarkReferencePackPreview {
  summary: string;
  sourceUrl: string;
  crops: Array<{
    key: string;
    label: string;
    reason: string;
    x: number;
    y: number;
    width: number;
    height: number;
    url: string;
  }>;
}

export interface BenchmarkRunOptions {
  scenarios: BenchmarkScenario[];
  lanes: BenchmarkLane[];
  ratio: '1:1' | '3:4' | '4:3';
  note?: string;
  visionProfileId?: string | null;
  laneProfileIds?: Partial<Record<BenchmarkLane, string>>;
}

export async function fetchAISettings(): Promise<AISettingsPublic> {
  return fetchJson<AISettingsPublic>('/api/system/ai-settings');
}

export async function planReferencePackPreview(
  source: File,
  visionProfileId: string | null,
): Promise<{ runId: string; referencePack: BenchmarkReferencePackPreview }> {
  const form = new FormData();
  form.append('source', source);
  if (visionProfileId) form.append('visionProfileId', visionProfileId);
  return fetchJson('/api/benchmark/hero/reference-pack', { method: 'POST', body: form });
}

export async function executeBenchmark(
  source: File,
  options: BenchmarkRunOptions,
): Promise<BenchmarkRunSummary> {
  const form = new FormData();
  form.append('source', source);
  form.append('options', JSON.stringify(options));
  const result = await fetchJson<{ summary: BenchmarkRunSummary }>('/api/benchmark/hero/run', {
    method: 'POST',
    body: form,
  });
  return result.summary;
}
