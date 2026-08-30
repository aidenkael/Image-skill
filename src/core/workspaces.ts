import { z } from 'zod';
import {
  TASK_KINDS,
  HeroHumanPresenceSchema,
  normalizeLegacyHeroOptionsValue,
  CollageTaskOptionsSchema,
  OptimizeTaskOptionsSchema,
} from './tasks';
import { HeroRatioSchema } from './hero-workflow';
import { TemplateDocumentSchema } from './templates';

/**
 * 商品工作区领域契约。
 * 一个 Workspace 对应一个正在制作的商品；这里只定义纯数据规则。
 */

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceHeroDraftOptionsSchema = z.preprocess(
  normalizeLegacyHeroOptionsValue,
  z.object({
    sourceAssetId: z.string(),
    ratio: HeroRatioSchema,
    creativeIntent: z.string().trim().max(500).default(''),
    humanPresence: HeroHumanPresenceSchema.default('auto'),
  }),
);

export const WorkspaceOptimizeDraftOptionsSchema = OptimizeTaskOptionsSchema.extend({
  sourceAssetId: z.string(),
});

export const WorkspaceDraftSchema = z.object({
  kind: z.enum(TASK_KINDS).default('hero'),
  selectedAssetIds: z.array(z.string().uuid()).max(9).default([]),

  heroOptions: WorkspaceHeroDraftOptionsSchema.default({
    sourceAssetId: '',
    ratio: '1:1',
    creativeIntent: '',
    humanPresence: 'auto',
  }),
  heroCount: z.number().int().min(1).max(4).default(1),

  collageOptions: CollageTaskOptionsSchema.default({
    templateId: 'left-hero-right-three',
    includeTitle: true,
    title: '',
    includeSellingPoints: true,
    sellingPoints: ['', '', ''],
  }),
  collageCount: z.number().int().min(1).max(3).default(1),

  collageVariants: z.array(TemplateDocumentSchema).max(3).default([]),
  activeCollageVariant: z.number().int().min(0).default(0),

  latestHeroTaskId: z.string().uuid().nullable().default(null),

  optimizeOptions: WorkspaceOptimizeDraftOptionsSchema.default({
    sourceAssetId: '',
    ratio: 'original',
    fit: 'contain',
    background: 'white',
    maxEdge: 1600,
    quality: 90,
    format: 'jpg',
  }),
  latestOptimizeTaskId: z.string().uuid().nullable().default(null),
});

export type WorkspaceDraft = z.infer<typeof WorkspaceDraftSchema>;

export const DEFAULT_WORKSPACE_DRAFT: WorkspaceDraft = WorkspaceDraftSchema.parse({});
