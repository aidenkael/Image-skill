import type { HeroPlanV2 } from '@/core/hero-workflow';

/**
 * 最终生成 Prompt 组装：只稳定表达策划结果，不做巨型模板系统。
 * 人物政策已在 HeroPlanV2 策划时注入，不再后置拼接冲突约束。
 */

const DISPLAY_MODE_INSTRUCTION: Record<HeroPlanV2['displayMode'], string> = {
  'scene-staging':
    'Stage the product as believable still-life merchandising (tabletop, spatial display or hanging); ' +
    'the product presentation is not led by any person.',
  'human-interaction':
    'Present the product through natural human interaction (holding, wearing, carrying or partial body participation); ' +
    'the interaction must look physically plausible and help the buyer understand scale or usage.',
};

export function buildHeroWorkflowPrompt(plan: HeroPlanV2, variant: 'primary' | 'alt' = 'primary'): string {
  const direction = variant === 'alt' && plan.altPrompt ? plan.altPrompt : plan.prompt;
  const parts: string[] = [
    `Preserve the referenced product exactly: ${plan.preserve.join('; ')}.`,
    DISPLAY_MODE_INSTRUCTION[plan.displayMode],
  ];
  if (plan.humanPolicy === 'avoid') {
    parts.push('Do not show any person, hand, body part, silhouette or human figure anywhere in the image.');
  } else if (plan.humanPolicy === 'require') {
    parts.push('Include meaningful, natural human presence that participates with the product.');
  }
  parts.push(
    `Scene: ${plan.scene}`,
    `Composition: ${plan.composition}`,
    `Lighting: ${plan.lighting}`,
    `You may freely interpret: ${plan.flexible.join('; ')}.`,
    `Strictly avoid these structural hallucinations: ${plan.riskChecks.join('; ')}.`,
    direction,
  );
  return parts.join(' ');
}
