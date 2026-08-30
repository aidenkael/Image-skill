import { describe, expect, it } from 'vitest';
import type { HeroPlanV2 } from '@/core/hero-workflow';
import { buildHeroWorkflowPrompt } from './prompt-builder';

const plan: HeroPlanV2 = {
  title: '晨光桌面',
  displayMode: 'scene-staging',
  humanPolicy: 'auto',
  coreSellingAngle: '日常陪伴感',
  preserve: ['白色杯身', '单件', '陶瓷质感'],
  flexible: ['光线氛围'],
  scene: '清晨木桌',
  composition: '居中微俯',
  lighting: '柔和自然光',
  riskChecks: ['杯柄结构', '数量变化'],
  prompt: 'A warm morning tabletop hero.',
  altPrompt: 'A dusk window hero.',
};

describe('Hero 最终 Prompt 组装', () => {
  it('稳定表达保真、展示方式、场景、构图、光线、发挥范围与结构禁令', () => {
    const prompt = buildHeroWorkflowPrompt(plan);
    expect(prompt).toContain('Preserve the referenced product exactly');
    expect(prompt).toContain('白色杯身');
    expect(prompt).toContain('still-life merchandising');
    expect(prompt).toContain('Scene: 清晨木桌');
    expect(prompt).toContain('Composition: 居中微俯');
    expect(prompt).toContain('Lighting: 柔和自然光');
    expect(prompt).toContain('You may freely interpret: 光线氛围');
    expect(prompt).toContain('Strictly avoid these structural hallucinations: 杯柄结构; 数量变化');
    expect(prompt).toContain('A warm morning tabletop hero.');
    expect(prompt).not.toMatch(/Do not show any person|natural human presence/);
  });

  it('human-interaction 分支输出人物互动语义', () => {
    const prompt = buildHeroWorkflowPrompt({ ...plan, displayMode: 'human-interaction' });
    expect(prompt).toContain('natural human interaction');
    expect(prompt).not.toContain('still-life merchandising');
  });

  it('人物政策直接来自策划结果：avoid 禁人物、require 要人物', () => {
    expect(buildHeroWorkflowPrompt({ ...plan, humanPolicy: 'avoid' }))
      .toContain('Do not show any person, hand, body part, silhouette or human figure');
    expect(buildHeroWorkflowPrompt({ ...plan, humanPolicy: 'require' }))
      .toContain('meaningful, natural human presence');
  });

  it('alt 变体优先使用备选 prompt；无备选时回退主 prompt', () => {
    expect(buildHeroWorkflowPrompt(plan, 'alt')).toContain('A dusk window hero.');
    expect(buildHeroWorkflowPrompt({ ...plan, altPrompt: undefined }, 'alt'))
      .toContain('A warm morning tabletop hero.');
  });
});
