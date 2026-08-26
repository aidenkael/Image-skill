'use client';

import type { AssetRef } from '@/core/assets';
import type { ProductIntelligenceRecord } from '@/core/intelligence';
import { assetUrl } from '@/core/results';
import type { HeroTaskOptions } from '@/core/tasks';

interface HeroControlsProps {
  workspaceId: string;
  options: HeroTaskOptions;
  assets: AssetRef[];
  intelligence: ProductIntelligenceRecord | null;
  count: number;
  busy: boolean;
  aiConfigured: boolean;
  onChange(patch: Partial<HeroTaskOptions>): void;
  onCountChange(n: number): void;
  onGenerate(): void;
}

export function HeroControls({
  workspaceId,
  options,
  assets,
  intelligence,
  count,
  busy,
  aiConfigured,
  onChange,
  onCountChange,
  onGenerate,
}: HeroControlsProps) {
  const sourceAsset = assets.find((asset) => asset.id === options.sourceAssetId);
  const concepts = intelligence?.plan.heroConcepts ?? [];
  const selectedConcept = concepts.find((concept) => concept.id === options.conceptId);
  const blocker = busy
    ? '当前商品的氛围主图正在生成，请等待完成。'
    : !sourceAsset
      ? '请明确选择一张非参考源商品图。'
      : options.creativeMode === 'concept' && !selectedConcept
        ? '请选择一个当前商品的专属创意方向。'
        : options.creativeMode === 'custom' && !options.creativeIntent?.trim()
          ? '请填写你的创作想法。'
          : !aiConfigured
            ? '请先在 AI 设置中选择氛围主图配置'
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
          <button type="button" className={`seg-btn${options.creativeMode === 'free' ? ' is-active' : ''}`} onClick={() => onChange({ creativeMode: 'free', conceptId: undefined })}>AI 自由创作</button>
          <button type="button" className={`seg-btn${options.creativeMode === 'concept' ? ' is-active' : ''}`} onClick={() => onChange({ creativeMode: 'concept' })}>商品专属方向</button>
          <button type="button" className={`seg-btn${options.creativeMode === 'custom' ? ' is-active' : ''}`} onClick={() => onChange({ creativeMode: 'custom', conceptId: undefined })}>自定义想法</button>
        </div>
        {options.creativeMode === 'free' ? (
          <div className="hint">AI 根据商品自行决定画面、镜头、环境与表现方式。</div>
        ) : null}
        {options.creativeMode === 'concept' ? (
          <div className="concept-list">
            {concepts.map((concept) => (
              <button
                key={concept.id}
                type="button"
                className={`direction-card${options.conceptId === concept.id ? ' is-active' : ''}`}
                onClick={() => onChange({
                  creativeMode: 'concept',
                  conceptId: concept.id,
                  ...(options.sourceAssetId ? {} : {
                    sourceAssetId: concept.recommendedSourceAssetId,
                  }),
                })}
              >
                <strong>{concept.title}</strong>
                <span>{concept.creativeBrief}</span>
                <small>{concept.reason}</small>
              </button>
            ))}
            {concepts.length === 0 ? (
              <div className="hint">先分析商品获取专属创意方向；也可直接使用 AI 自由创作。</div>
            ) : null}
          </div>
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
        <label className="field-label">人物参与（可选）</label>
        <div className="seg">
          {([
            ['auto', 'AI 决定'],
            ['none', '不要人物'],
            ['involved', '需要人物参与'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" className={`seg-btn${options.humanPresence === value ? ' is-active' : ''}`} onClick={() => onChange({ humanPresence: value })}>{label}</button>
          ))}
        </div>
        <div className="hint">
          {options.humanPresence === 'involved'
            ? '需要人物参与：要求画面有人物参与；具体呈现方式由 AI 决定。'
            : options.humanPresence === 'none'
              ? '不要人物：要求画面不出现人物、手部或人体局部。'
              : 'AI 决定：不限制是否出现人物，由 AI 根据商品与创意判断。'}
        </div>
      </div>

      <Choice label="输出数量" current={String(count)} values={['1', '2', '3', '4']} onSelect={(value) => onCountChange(Number(value))} />
      <Choice label="画面比例" current={options.ratio} values={['1:1', '3:4', '4:3']} labels={['1:1 方形', '3:4 竖版', '4:3 横版']} onSelect={(value) => onChange({ ratio: value as HeroTaskOptions['ratio'] })} />

      <div className="controls-actions">
        <button type="button" className="btn btn-primary" disabled={Boolean(blocker)} onClick={onGenerate}>{busy ? '生成中…' : '生成氛围主图'}</button>
        {blocker ? <div className="hint blocker-hint">{blocker}</div> : null}
      </div>
    </div>
  );
}

function Choice({ label, current, values, labels = values, onSelect }: { label: string; current: string; values: string[]; labels?: string[]; onSelect(value: string): void }) {
  return <div className="field"><label className="field-label">{label}</label><div className="seg">{values.map((value, index) => <button key={value} type="button" className={`seg-btn${current === value ? ' is-active' : ''}`} onClick={() => onSelect(value)}>{labels[index]}</button>)}</div></div>;
}
