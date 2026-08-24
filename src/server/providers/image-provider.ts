/**
 * 图片生成 Provider 边界。
 * 未来 RunningHub / ComfyUI 等外部工作流 Provider 只需实现该接口。
 */

export interface ImageGenerationInput {
  imagePath: string;
  prompt: string;
  size: string;
  count: number;
}

export interface GeneratedImage {
  url?: string;
  localPath?: string;
}

export interface ImageProvider {
  generate(input: ImageGenerationInput): Promise<GeneratedImage[]>;
}

/** 配置缺失类错误（如 DASHSCOPE_API_KEY 未配置）——UI 需要给出明确提示 */
export class ProviderConfigError extends Error {}

/** Provider 请求/响应类错误 */
export class ProviderRequestError extends Error {}
