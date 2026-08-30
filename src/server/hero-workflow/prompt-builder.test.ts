import { describe, expect, it } from 'vitest';
import type { HeroBrief } from '@/core/hero-workflow';
import { buildHeroGenerationPrompt } from './prompt-builder';

const brief: HeroBrief = {
  title: '午后斜挎',
  productIdentity: {
    summary: '白色链条小方包',
    fixedTraits: ['白色包身', '金色五金', '翻盖结构'],
    movableParts: [{
      name: '金色链条',
      fixedIdentity: '一条金色金属链，链节样式保持原样',
      fixedRelations: ['连接包身两侧原挂点', '保持一条连续链'],
      allowedMotion: ['重力下自然垂坠', '随姿态弯曲'],
      forbiddenChanges: ['断裂成多段', '复制成多条'],
    }],
  },
  presentation: {
    mode: 'human-interaction',
    reason: '斜挎状态帮助理解尺寸与佩戴效果',
    interaction: '模特自然斜挎行走',
    scene: '午后街角',
    camera: '35mm 平视',
    lighting: '自然日光',
    depthOfField: '轻浅景深，背景可辨',
    scaleCue: '与常见手机对比的尺寸',
  },
  forbiddenChanges: ['包身颜色改变', '五金变银色', '链条数量变化'],
};

const input = { humanPolicy: 'auto' as const, creativeIntent: undefined as string | undefined };

describe('确定性 Prompt 编译器', () => {
  it('编译商品身份、可动部件的固定关系/允许运动/禁止变化', () => {
    const prompt = buildHeroGenerationPrompt(brief, input);
    expect(prompt).toContain('Product identity that must remain unchanged: 白色包身; 金色五金; 翻盖结构');
    expect(prompt).toContain('Movable part "金色链条"');
    expect(prompt).toContain('Fixed relationships: 连接包身两侧原挂点; 保持一条连续链');
    expect(prompt).toContain('Allowed natural motion: 重力下自然垂坠; 随姿态弯曲');
    expect(prompt).toContain('Never: 断裂成多段; 复制成多条');
    expect(prompt).toContain('Forbidden product changes: 包身颜色改变; 五金变银色; 链条数量变化');
  });

  it('编译展示方式、场景、相机、光线、景深与尺寸线索', () => {
    const prompt = buildHeroGenerationPrompt(brief, input);
    expect(prompt).toContain('Presentation: human-interaction');
    expect(prompt).toContain('Human/product interaction: 模特自然斜挎行走');
    expect(prompt).toContain('Scene: 午后街角');
    expect(prompt).toContain('Camera: 35mm 平视');
    expect(prompt).toContain('Lighting: 自然日光');
    expect(prompt).toContain('Depth of field: 轻浅景深，背景可辨');
    expect(prompt).toContain('Scale/context cue: 与常见手机对比的尺寸');
  });

  it('humanPolicy=require 强制人物互动指令', () => {
    const prompt = buildHeroGenerationPrompt(brief, { humanPolicy: 'require' });
    expect(prompt).toContain('meaningful human interaction is mandatory');
  });

  it('humanPolicy=avoid 强制无人物指令', () => {
    const prompt = buildHeroGenerationPrompt(brief, { humanPolicy: 'avoid' });
    expect(prompt).toContain('do not show any person, hand, body part, silhouette or human figure');
  });

  it('creativeIntent 作为软性方向注入且不覆盖身份约束', () => {
    const prompt = buildHeroGenerationPrompt(brief, { humanPolicy: 'auto', creativeIntent: '雨夜归家' });
    expect(prompt).toContain('User creative intent');
    expect(prompt).toContain('雨夜归家');
    expect(prompt).toContain('never override product identity');
  });

  it('repairInstruction 在补生时注入，且位于最终保真指令之前', () => {
    const prompt = buildHeroGenerationPrompt(brief, input, '保持金色链条为一条连续链。');
    const repairIndex = prompt.indexOf('Visual QA correction for this retry: 保持金色链条为一条连续链。');
    const fidelityIndex = prompt.indexOf('Keep gravity, attachment, contact, scale');
    expect(repairIndex).toBeGreaterThan(-1);
    expect(fidelityIndex).toBeGreaterThan(repairIndex);
  });

  it('刚性商品 movableParts=[] 时不产生部件段落', () => {
    const rigidPrompt = buildHeroGenerationPrompt({
      ...brief,
      productIdentity: { ...brief.productIdentity, movableParts: [] },
    }, input);
    expect(rigidPrompt).not.toContain('Movable part');
    expect(rigidPrompt).not.toContain('Fixed relationships');
  });

  it('无 interaction/scaleCue 时对应行为空', () => {
    const prompt = buildHeroGenerationPrompt({
      ...brief,
      presentation: { ...brief.presentation, mode: 'scene-staging', interaction: null, scaleCue: null },
    }, input);
    expect(prompt).not.toContain('Human/product interaction');
    expect(prompt).not.toContain('Scale/context cue');
  });
});
