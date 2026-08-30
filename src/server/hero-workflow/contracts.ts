import type { AssetRole } from '@/core/assets';
import type { HeroBrief, HeroHumanPolicy } from '@/core/hero-workflow';

/**
 * 一键氛围主图工作流内部契约。
 * 编排：Director → 生成 → 批量 QA → 至多一次反馈补生。
 */

export interface HeroWorkflowInput {
  workspaceId: string;
  workspaceName: string;
  taskId: string;
  /** 源商品图本地路径（图片生成 Provider 输入） */
  sourceImagePath: string;
  /** 源商品图 vision 预览（jpeg，Director 与批量 QA 共用） */
  sourcePreview: Buffer;
  sourceAssetId: string;
  sourceAssetRole: AssetRole;
  ratio: '1:1' | '3:4' | '4:3';
  count: number;
  humanPolicy: HeroHumanPolicy;
  creativeIntent?: string;
}

export interface HeroWorkflowCandidate {
  url?: string;
  localPath: string;
}

export interface HeroWorkflowOutcome {
  brief: HeroBrief;
  /** 通过质检的结果，按 QA 偏好顺序 */
  candidates: HeroWorkflowCandidate[];
}
