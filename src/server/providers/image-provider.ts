/**
 * 图片生成 Provider 边界。
 * 未来 RunningHub / ComfyUI 等外部工作流 Provider 只需实现该接口。
 */

export interface ImageGenerationInput {
  imagePath: string;
  prompt: string;
  ratio: '1:1' | '3:4' | '4:3';
  count: number;
}

export interface GeneratedImage {
  url?: string;
  localPath?: string;
}

export interface ImageProvider {
  generate(input: ImageGenerationInput): Promise<GeneratedImage[]>;
}

export { ProviderConfigError, ProviderRequestError } from './provider-errors';
