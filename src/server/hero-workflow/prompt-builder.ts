import type { HeroBrief, HeroHumanPolicy } from '@/core/hero-workflow';

/**
 * 确定性 Prompt 编译器：最终生成 prompt 完全由软件从 HeroBrief 组装。
 * Vision 模型不提供自由格式的最终 prompt；不维护 primary/alt 变体。
 */

export function buildHeroGenerationPrompt(
  brief: HeroBrief,
  input: Pick<{ humanPolicy: HeroHumanPolicy; creativeIntent?: string }, 'humanPolicy' | 'creativeIntent'>,
  repairInstruction?: string,
): string {
  const lines: string[] = [
    'Create a photorealistic ecommerce hero photograph using the reference image as the product identity source.',

    `Product identity that must remain unchanged: ${brief.productIdentity.fixedTraits.join('; ')}.`,

    ...brief.productIdentity.movableParts.map((part) =>
      [
        `Movable part "${part.name}": ${part.fixedIdentity}.`,
        `Fixed relationships: ${part.fixedRelations.join('; ')}.`,
        `Allowed natural motion: ${part.allowedMotion.join('; ')}.`,
        `Never: ${part.forbiddenChanges.join('; ')}.`,
      ].join(' ')
    ),

    `Presentation: ${brief.presentation.mode}.`,
    brief.presentation.interaction
      ? `Human/product interaction: ${brief.presentation.interaction}.`
      : '',

    `Scene: ${brief.presentation.scene}.`,
    `Camera: ${brief.presentation.camera}.`,
    `Lighting: ${brief.presentation.lighting}.`,
    `Depth of field: ${brief.presentation.depthOfField}.`,
    brief.presentation.scaleCue
      ? `Scale/context cue: ${brief.presentation.scaleCue}.`
      : '',

    `Forbidden product changes: ${brief.forbiddenChanges.join('; ')}.`,
  ];

  // 用户人物政策是硬约束，直接编译进 prompt。
  if (input.humanPolicy === 'avoid') {
    lines.push('Hard constraint: do not show any person, hand, body part, silhouette or human figure anywhere in the image.');
  } else if (input.humanPolicy === 'require') {
    lines.push('Hard constraint: meaningful human interaction is mandatory — natural holding, wearing, carrying or partial-body participation with the product.');
  }

  // 用户创作意图只是软性方向，不得覆盖商品身份与物理约束。
  const creativeIntent = input.creativeIntent?.trim();
  if (creativeIntent) {
    lines.push(`User creative intent (soft creative direction; it must never override product identity or physical constraints): ${creativeIntent}`);
  }

  // QA 修复反馈：放在结尾，但位于最终硬性保真指令之前。
  const repair = repairInstruction?.trim();
  if (repair) {
    lines.push(`Visual QA correction for this retry: ${repair}`);
  }

  lines.push(
    'Keep gravity, attachment, contact, scale, lighting and depth of field physically believable.',
    'Avoid excessive background blur and abrupt depth-of-field transitions.',
  );

  return lines.filter(Boolean).join(' ');
}
