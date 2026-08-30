import type { BenchmarkScenario } from '@/core/benchmark-lab';

/**
 * Benchmark 场景：跨品类通用的电商展示状态，不是商品品类。
 * Prompt 共享、可组合；不建品类专属 prompt 树。
 */

/** 每个场景的生成目标（允许物理合理的状态变化，锁定商品身份）。 */
export function scenarioGoal(scenario: BenchmarkScenario): string {
  switch (scenario) {
    case 'human-carry':
      return [
        'Create a believable ecommerce lifestyle image showing the product being naturally carried / held / worn / used by a person only when that is physically meaningful.',
        'Product identity, proportions, connectors and flexible-part continuity must remain consistent.',
        'Human interaction must look physically plausible.',
      ].join(' ');
    case 'tabletop-placement':
      return [
        'Create a believable ecommerce scene where the product is placed on a surface in a natural physically supported state.',
        'Do not keep flexible parts frozen in the exact cutout pose.',
        'Allow straps/chains/cords/fabric to settle naturally under gravity while preserving quantity, attachment and approximate proportion.',
        'Keep the product visually dominant.',
      ].join(' ');
    case 'hanging-display':
      return [
        'Create a believable ecommerce scene where the product is displayed hanging in a natural supported state.',
        'Flexible components may become tensioned or draped depending on support and gravity, but product identity, attachment points and quantity must remain unchanged.',
      ].join(' ');
  }
}

/** 商品身份锁定前缀：所有场景共享。 */
const IDENTITY_LOCK = [
  'The supplied image is the exact source product photo to preserve.',
  'Lock product identity: overall shape, structure/topology, quantity, major colors, materials, visible patterns/logos/text, hardware, closures and attachment points.',
  'Flexible parts (straps, chains, cords, fabric) may settle or bend naturally under gravity or use, but must keep their quantity, attachment points and approximate length/proportion.',
  'Believable commercial ecommerce photography: natural light integration, credible physical contact and scale, realistic gravity, product visually dominant.',
  'Do not invent product functions, accessories, materials, text, logos or claims.',
].join(' ');

/**
 * 组装确定性生成 prompt：身份锁定 + 场景目标 +（可选）用户软性备注。
 * 同一场景在所有 lane 上使用完全相同的 prompt（lane 只改变执行变量）。
 */
export function buildBenchmarkPrompt(scenario: BenchmarkScenario, note?: string): string {
  const parts = [IDENTITY_LOCK, scenarioGoal(scenario)];
  if (note && note.trim()) {
    parts.push(`User creative note (soft direction; never overrides product identity or physics): ${note.trim()}`);
  }
  return parts.join('\n');
}
