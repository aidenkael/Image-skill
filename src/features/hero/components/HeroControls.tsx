'use client';

import type { AssetRef } from '@/core/assets';
import type { HeroPlanRecord } from '@/core/hero-workflow';
import { assetUrl } from '@/core/results';
import type { HeroTaskOptions } from '@/core/tasks';

interface HeroControlsProps {
  workspaceId: string;
  options: HeroTaskOptions;
  assets: AssetRef[];
  count: number;
  busy: boolean;
  visionConfigured: boolean;
  imageConfigured: boolean;
  heroPlan: HeroPlanRecord | null;
  planLoading: boolean;
  onChange(patch: Partial<HeroTaskOptions>): void;
  onCountChange(n: number): void;
  onGeneratePlan(): void;
  onGenerate(): void;
}

const DISPLAY_MODE_LABEL: Record<string, string> = {
  'scene-staging': '静物陈列',
  'human-interaction': '人物互动',
};

export function HeroControls({
  workspaceId,
  options,
  assets,
  count,
  busy,
  visionConfigured,
  imageConfigured,
  heroPlan,
  planLoading,
  onChange,
  onCountChange,
  onGeneratePlan,
  onGenerate,
}: HeroControlsProps) {
  const sourceAsset = assets.find((asset) => asset.id === options.sourceAssetId);
  const hasPlan = heroPlan !== null && heroPlan.id === options.planId;
  const generateBlocker = busy
    ? '当前商品的氛围主图正在生成，请等待完成。'
    : !sourceAsset
      ? '请明确选择一张非参考源商品图。'
      : !imageConfigured
        ? '请先在 AI 设置中选择氛围主图生成模型'
        : null;
  const planBlocker = !sourceAsset
    ? '请先选择源商品图'
    : options.creativeMode === 'custom' && !options.creativeIntent?.trim()
      ? '请先填写创作想法'
      : !visionConfigured
        ? '请先在 AI 设置中选择商品分析/视觉模型'
        : null;

  return (
    <div className="controls-body">
      <div className="field">
        <label className="field-label" htmlFor="hero-source-asset">源商品图（仅 1 张）</label>
        <select
          id="hero-source-asset"
          className="input"
          value={options.sourceAssetId}
          onChange={(event) => onChange({ sourceAssetId: event.target.value })}
        >
          <option value="">请选择源商品图</option>
          {assets.filter((asset) => asset.role !== 'reference').map((asset) => (
            <option key={asset.id} value={asset.id}>{asset.name}</option>
          ))}
        </select>
        {sourceAsset ? (
          <div className="hero-source-preview">
            <img src={assetUrl(workspaceId, sourceAsset.id, 'thumb')} alt={sourceAsset.name} />
            <span>{sourceAsset.name}</span>
          </div>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label">创作方式</label>
        <div className="seg">
          <button type="button" className={`seg-btn${options.creativeMode === 'recommended' ? ' is-active' : ''}`} onClick={() => onChange({ creativeMode: 'recommended' })}>AI 推荐方案</button>
          <button type="button" className={`seg-btn${options.creativeMode === 'custom' ? ' is-active' : ''}`} onClick={() => onChange({ creativeMode: 'custom' })}>自定义想法</button>
        </div>
        {options.creativeMode === 'recommended' ? (
          <div className="hint">AI 像商业摄影师一样为商品策划氛围主图：锁定商品身份，自由发挥展示方式。</div>
        ) : null}
        {options.creativeMode === 'custom' ? (
          <textarea
            className="input textarea"
            placeholder="写下你希望画面传达的感觉、故事或任何创意要求"
            value={options.creativeIntent ?? ''}
            maxLength={500}
            onChange={(event) => onChange({ creativeIntent: event.target.value })}
          />
        ) : null}
      </div>

      <div className="field">
        <label className="field-label">人物偏好</label>
        <div className="seg">
          {([
            ['auto', '自动'],
            ['avoid', '不要人物'],
            ['require', '需要人物'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" className={`seg-btn${options.humanPresence === value ? ' is-active' : ''}`} onClick={() => onChange({ humanPresence: value })}>{label}</button>
          ))}
        </div>
        <div className="hint">
          {options.humanPresence === 'require'
            ? '需要人物：画面通过手持/佩戴/背负等自然互动展示商品。'
            : options.humanPresence === 'avoid'
              ? '不要人物：画面不出现人物、手部或人体局部。'
              : '自动：由 AI 判断人物参与是否有助于表现商品。'}
        </div>
      </div>

      <div className="field">
        <label className="field-label">创意程度</label>
        <div className="seg">
          {([
            ['conservative', '保守'],
            ['balanced', '平衡'],
            ['creative', '创意'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" className={`seg-btn${options.creativeLevel === value ? ' is-active' : ''}`} onClick={() => onChange({ creativeLevel: value })}>{label}</button>
          ))}
        </div>
        <div className="hint">
          {options.creativeLevel === 'conservative'
            ? '保守：强调结构保真，只做轻度场景联想。'
            : options.creativeLevel === 'creative'
              ? '创意：允许更大胆的场景与表现方式，但商品身份不变。'
              : '平衡：默认的保真与氛围兼顾。'}
        </div>
      </div>

      <Choice label="输出数量" current={String(count)} values={['1', '2', '3', '4']} onSelect={(value) => onCountChange(Number(value))} />
      <Choice label="画面比例" current={options.ratio} values={['1:1', '3:4', '4:3']} labels={['1:1 方形', '3:4 竖版', '4:3 横版']} onSelect={(value) => onChange({ ratio: value as HeroTaskOptions['ratio'] })} />

      <div className="controls-actions">
        <button
          type="button"
          className="btn"
          disabled={Boolean(planBlocker) || planLoading}
          onClick={onGeneratePlan}
        >
          {planLoading ? '策划方案中…' : hasPlan ? '更新 AI 方案' : '生成/更新 AI 方案'}
        </button>
        {planBlocker ? <div className="hint blocker-hint">{planBlocker}</div> : null}
      </div>

      {hasPlan && heroPlan ? (
        <div className="direction-card is-readonly">
          <strong>当前执行方案：{heroPlan.plan.title}</strong>
          <span>展示方式：{DISPLAY_MODE_LABEL[heroPlan.plan.displayMode] ?? heroPlan.plan.displayMode}</span>
          <span>核心卖点：{heroPlan.plan.coreSellingAngle}</span>
          <span>场景：{heroPlan.plan.scene}</span>
          <span>构图：{heroPlan.plan.composition}</span>
        </div>
      ) : heroPlan ? (
        <div className="hint">当前方案已失效（参数已变化），请重新生成方案。</div>
      ) : (
        <div className="hint">请先点击「生成/更新 AI 方案」获取策划方案。</div>
      )}

      <div className="controls-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={Boolean(generateBlocker) || !hasPlan}
          onClick={onGenerate}
        >
          {busy ? '生成中…' : '按此方案生成氛围主图'}
        </button>
        {generateBlocker ? <div className="hint blocker-hint">{generateBlocker}</div> : null}
        {!hasPlan && !generateBlocker ? <div className="hint blocker-hint">请先生成 AI 方案</div> : null}
      </div>
    </div>
  );
}

function Choice({ label, current, values, labels = values, onSelect }: { label: string; current: string; values: string[]; labels?: string[]; onSelect(value: string): void }) {
  return <div className="field"><label className="field-label">{label}</label><div className="seg">{values.map((value, index) => <button key={value} type="button" className={`seg-btn${current === value ? ' is-active' : ''}`} onClick={() => onSelect(value)}>{labels[index]}</button>)}</div></div>;
}
