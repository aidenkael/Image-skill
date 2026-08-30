/**
 * 图片生成 Provider 边界。
 * 未来 RunningHub / ComfyUI 等外部工作流 Provider 只需实现该接口。
 *
 * 可选字段不要求所有驱动都支持：不支持的字段必须显式忽略并在
 * capabilities() 中如实声明；Benchmark Lab 依据 capabilities 判定 lane 可用性。
 */

export interface ImageEditRegion {
  imageIndex: number;
  boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

export interface ImageGenerationInput {
  /** 主源图（商品内容源） */
  imagePath: string;
  prompt: string;
  ratio: '1:1' | '3:4' | '4:3';
  count: number;
  /** 额外细节/辅助参考图（不含主源图） */
  referenceImagePaths?: string[];
  /** 请求级提示词扩写覆盖；缺省用配置值 */
  promptEnhancement?: 'on' | 'off' | 'auto';
  /** Provider 特定提示（仅在真实支持时生效） */
  editRegions?: ImageEditRegion[];
  /** Benchmark Lab 追踪字段，仅写入诊断日志 */
  benchmarkTrace?: { runId: string; scenario: string; lane: string };
}

export interface GeneratedImage {
  url?: string;
  localPath?: string;
}

/** Provider 能力声明：运行时能力不得通过模型名推断。 */
export interface ImageProviderCapabilities {
  supportsMultipleReferences: boolean;
  /** 除主源图外可额外携带的参考图上限 */
  maxReferenceImages: number;
  supportsEditRegions: boolean;
  supportsPromptEnhancementOverride: boolean;
}

export interface ImageProvider {
  generate(input: ImageGenerationInput): Promise<GeneratedImage[]>;
  capabilities(): ImageProviderCapabilities;
}

export { ProviderCapabilityError, ProviderConfigError, ProviderRequestError } from './provider-errors';
