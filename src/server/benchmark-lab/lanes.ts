import { BENCHMARK_LANE_LABELS, type BenchmarkLane } from '@/core/benchmark-lab';
import type { ImageDriver } from '@/core/system';
import type { ImageProviderCapabilities } from '@/server/providers/image-provider';

/**
 * Benchmark lane 预设：只声明实验变量（驱动目标、参考图、扩写开关、edit region 意图）。
 * 不硬编码模型名；模型由用户选择/活动的 AI 配置决定。
 */

export interface BenchmarkLanePreset {
  lane: BenchmarkLane;
  label: string;
  driverTarget: ImageDriver;
  /** 是否使用 Reference Pack 细节裁剪作为额外参考图 */
  useReferencePack: boolean;
  promptEnhancement: 'on' | 'off' | 'auto';
  /** 仅当 provider 真实支持时启用；不支持时如实记录未使用 */
  useEditRegions: boolean;
}

export const BENCHMARK_LANE_PRESETS: BenchmarkLanePreset[] = [
  {
    lane: 'qwen-single-extend-on',
    label: BENCHMARK_LANE_LABELS['qwen-single-extend-on'],
    driverTarget: 'dashscope-image',
    useReferencePack: false,
    promptEnhancement: 'on',
    useEditRegions: false,
  },
  {
    lane: 'qwen-single-extend-off',
    label: BENCHMARK_LANE_LABELS['qwen-single-extend-off'],
    driverTarget: 'dashscope-image',
    useReferencePack: false,
    promptEnhancement: 'off',
    useEditRegions: false,
  },
  {
    lane: 'qwen-multi-ref',
    label: BENCHMARK_LANE_LABELS['qwen-multi-ref'],
    driverTarget: 'dashscope-image',
    useReferencePack: true,
    promptEnhancement: 'off',
    useEditRegions: false,
  },
  {
    lane: 'seedream-multi-ref',
    label: BENCHMARK_LANE_LABELS['seedream-multi-ref'],
    driverTarget: 'volcengine-ark-image',
    useReferencePack: true,
    promptEnhancement: 'auto',
    useEditRegions: false,
  },
  {
    lane: 'wan-multi-ref',
    label: BENCHMARK_LANE_LABELS['wan-multi-ref'],
    driverTarget: 'dashscope-image',
    useReferencePack: true,
    promptEnhancement: 'off',
    // Wan edit region/bbox 仅当所用驱动真实支持时才启用，否则如实标记未使用
    useEditRegions: true,
  },
];

export function getLanePreset(lane: BenchmarkLane): BenchmarkLanePreset {
  const preset = BENCHMARK_LANE_PRESETS.find((item) => item.lane === lane);
  if (!preset) throw new Error(`未知 Benchmark lane: ${lane}`);
  return preset;
}

/** edit region 只有预设意图与 provider 真实能力同时满足才启用。 */
export function laneEditRegionsEnabled(
  preset: BenchmarkLanePreset,
  capabilities: ImageProviderCapabilities,
): boolean {
  return preset.useEditRegions && capabilities.supportsEditRegions;
}

/** lane 所需能力是否被 provider 真实满足；不满足返回明确原因。 */
export function laneCapabilityIssue(
  preset: BenchmarkLanePreset,
  capabilities: ImageProviderCapabilities,
): string | null {
  if (preset.useReferencePack && capabilities.maxReferenceImages <= 0) {
    return '当前生图配置不支持额外参考图，该路线不可用。';
  }
  if (preset.promptEnhancement === 'on' && !capabilities.supportsPromptEnhancementOverride) {
    return '当前生图协议不支持提示词扩写开关，该路线不可用。';
  }
  return null;
}
