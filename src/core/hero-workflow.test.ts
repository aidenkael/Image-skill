import { describe, expect, it } from 'vitest';
import {
  HeroBatchReviewSchema,
  HeroBriefSchema,
  heroBriefSchemaForHumanPolicy,
  type HeroBrief,
} from './hero-workflow';

const rigidBrief: HeroBrief = {
  title: '晨光桌面',
  productIdentity: {
    summary: '白色陶瓷马克杯',
    fixedTraits: ['白色杯身', '单件', '陶瓷质感'],
    movableParts: [],
  },
  presentation: {
    mode: 'scene-staging',
    reason: '桌面场景能传达日常使用感',
    interaction: null,
    scene: '清晨木桌',
    camera: '居中微俯 50mm',
    lighting: '柔和自然窗光',
    depthOfField: '轻浅景深，背景可辨',
    scaleCue: null,
  },
  forbiddenChanges: ['杯柄数量变化', '杯身图案改变', '材质变成金属'],
};

const chainPart = {
  name: '金色链条',
  fixedIdentity: '一条金色金属链，链节样式与光泽保持原样',
  fixedRelations: ['连接包身两侧原挂点', '保持一条连续链', '近似原长度比例'],
  allowedMotion: ['重力下自然垂坠', '随手持姿态弯曲'],
  forbiddenChanges: ['断裂成多段', '复制成多条', '脱离挂点', '明显缩短'],
};

const articulatedBrief: HeroBrief = {
  ...rigidBrief,
  title: '午后斜挎',
  productIdentity: {
    summary: '白色链条小方包',
    fixedTraits: ['白色包身', '金色五金', '单件', '翻盖结构'],
    movableParts: [chainPart],
  },
  presentation: {
    ...rigidBrief.presentation,
    mode: 'human-interaction',
    interaction: '模特自然斜挎行走',
  },
};

describe('HeroBrief 契约', () => {
  it('刚性商品允许 movableParts=[]', () => {
    expect(HeroBriefSchema.parse(rigidBrief).productIdentity.movableParts).toEqual([]);
  });

  it('关节商品支持可动部件（固定身份/关系 与 允许运动分离）', () => {
    const parsed = HeroBriefSchema.parse(articulatedBrief);
    expect(parsed.productIdentity.movableParts[0]).toMatchObject({
      name: '金色链条',
      fixedRelations: expect.arrayContaining(['保持一条连续链']),
      allowedMotion: expect.arrayContaining(['重力下自然垂坠']),
    });
  });

  it('HeroBrief 不包含 prompt/altPrompt/score/creativeLevel 字段', () => {
    const shape = HeroBriefSchema.shape as Record<string, unknown>;
    for (const banned of ['prompt', 'altPrompt', 'score', 'creativeLevel']) {
      expect(shape).not.toHaveProperty(banned);
    }
    expect(JSON.stringify(HeroBriefSchema.parse(articulatedBrief))).not.toMatch(/"(prompt|altPrompt|score|creativeLevel)"/);
  });

  it('fixedTraits 至少 3 条、forbiddenChanges 至少 3 条', () => {
    expect(HeroBriefSchema.safeParse({
      ...rigidBrief,
      productIdentity: { ...rigidBrief.productIdentity, fixedTraits: ['白色杯身', '单件'] },
    }).success).toBe(false);
    expect(HeroBriefSchema.safeParse({ ...rigidBrief, forbiddenChanges: ['杯柄数量变化', '图案改变'] }).success).toBe(false);
  });
});

describe('heroBriefSchemaForHumanPolicy（人物政策硬约束）', () => {
  it('require：human-interaction + 非空 interaction 通过，且结果仍是 HeroBrief', () => {
    const schema = heroBriefSchemaForHumanPolicy('require');
    const parsed: HeroBrief = schema.parse(articulatedBrief);
    expect(parsed.presentation.mode).toBe('human-interaction');
    expect(parsed.presentation.interaction).toBe('模特自然斜挎行走');
  });

  it('require：scene-staging 无法通过 schema', () => {
    expect(heroBriefSchemaForHumanPolicy('require').safeParse(rigidBrief).success).toBe(false);
  });

  it('require：human-interaction 但 interaction=null 无法通过 schema', () => {
    expect(heroBriefSchemaForHumanPolicy('require').safeParse({
      ...articulatedBrief,
      presentation: { ...articulatedBrief.presentation, interaction: null },
    }).success).toBe(false);
  });

  it('avoid：scene-staging + interaction=null 通过', () => {
    expect(heroBriefSchemaForHumanPolicy('avoid').safeParse(rigidBrief).success).toBe(true);
  });

  it('avoid：human-interaction 无法通过 schema', () => {
    expect(heroBriefSchemaForHumanPolicy('avoid').safeParse(articulatedBrief).success).toBe(false);
  });

  it('avoid：scene-staging 但 interaction 非空无法通过 schema', () => {
    expect(heroBriefSchemaForHumanPolicy('avoid').safeParse({
      ...rigidBrief,
      presentation: { ...rigidBrief.presentation, interaction: '模特手持' },
    }).success).toBe(false);
  });

  it('auto：保持现有自由决策，两种合法 presentation 都可通过', () => {
    const schema = heroBriefSchemaForHumanPolicy('auto');
    expect(schema).toBe(HeroBriefSchema);
    expect(schema.safeParse(rigidBrief).success).toBe(true);
    expect(schema.safeParse(articulatedBrief).success).toBe(true);
  });
});

describe('HeroBatchReview 契约', () => {
  const assessment = (candidateIndex: number, hard: string[] = []) => ({
    candidateIndex,
    hardFailures: hard,
    softIssues: [],
    repairInstruction: hard.length > 0 ? '保持链条为一条连续链' : null,
  });

  it('解析合法批量评估', () => {
    const parsed = HeroBatchReviewSchema.parse({
      assessments: [assessment(0), assessment(1, ['topology_broken'])],
      preferredOrder: [0, 1],
    });
    expect(parsed.assessments).toHaveLength(2);
  });

  it('硬性失败枚举外的值被拒绝', () => {
    expect(HeroBatchReviewSchema.safeParse({
      assessments: [assessment(0, ['not_a_real_failure'])],
      preferredOrder: [0],
    }).success).toBe(false);
  });

  it('human_policy_violated 是合法硬性失败', () => {
    expect(HeroBatchReviewSchema.safeParse({
      assessments: [assessment(0, ['human_policy_violated'])],
      preferredOrder: [0],
    }).success).toBe(true);
  });
});
