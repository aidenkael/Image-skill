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
  onChange(patch: Partial<HeroTaskOptions>): void;
  onCountChange(n: number): void;
  onGenerate(): void;
}

const PERSON_LABELS = { none: '无人物', hand: '手部展示', person: '完整人物' } as const;

export function HeroControls({
  workspaceId,
  options,
  assets,
  intelligence,
  count,
  busy,
  onChange,
  onCountChange,
  onGenerate,
}: HeroControlsProps) {
  const sourceAsset = assets.find((asset) => asset.id === options.sourceAssetId);
  const directions = intelligence?.plan.heroDirections ?? [];
  const autoReady = directions.length > 0;
  const canGenerate =
    Boolean(sourceAsset) &&
    (options.sceneMode === 'auto' ? autoReady : Boolean(options.scenePrompt?.trim()));

  return (
    <div className="controls-body">
      <div className="field">
        <label className="field-label" htmlFor="hero-source-asset">源商品图（仅 1 张）</label>
        <select id="hero-source-asset" className="input" value={options.sourceAssetId} onChange={(event) => onChange({ sourceAssetId: event.target.value })}>
          <option value="">请选择源商品图</option>
          {assets.filter((asset) => asset.role !== 'reference').map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>
        {sourceAsset ? <div className="hero-source-preview"><img src={assetUrl(workspaceId, sourceAsset.id, 'thumb')} alt={sourceAsset.name} /><span>{sourceAsset.name}</span></div> : null}
      </div>

      <div className="field">
        <label className="field-label">视觉方向</label>
        {directions.map((direction) => (
          <button
            key={direction.id}
            type="button"
            className={`direction-card${options.sceneMode === 'auto' && options.directionId === direction.id ? ' is-active' : ''}`}
            onClick={() => onChange({
              sceneMode: 'auto',
              directionId: direction.id,
              sourceAssetId: direction.sourceAssetId,
            })}
          >
            <strong>{direction.title}</strong>
            <span>{direction.scene}</span>
            <span>{direction.composition}</span>
            <small>人物建议：{PERSON_LABELS[direction.person]}</small>
          </button>
        ))}
        {!autoReady ? <div className="hint">先分析商品获取推荐方向，或切换到自定义方向</div> : null}
        <button type="button" className={`direction-card custom-direction${options.sceneMode === 'prompt' ? ' is-active' : ''}`} onClick={() => onChange({ sceneMode: 'prompt', directionId: undefined })}>
          <strong>自定义方向</strong>
          <span>由你明确描述想要的场景与氛围</span>
        </button>
        {options.sceneMode === 'prompt' ? <textarea className="input textarea" placeholder="例如：阳光充足的北欧风客厅，木地板，产品放在茶几上" value={options.scenePrompt ?? ''} maxLength={500} onChange={(event) => onChange({ scenePrompt: event.target.value })} /> : null}
      </div>

      <Choice label="输出数量" current={String(count)} values={['1', '2', '3', '4']} onSelect={(value) => onCountChange(Number(value))} />
      <Choice label="画面比例" current={options.ratio} values={['1:1', '3:4', '4:3']} labels={['1:1 方形', '3:4 竖版', '4:3 横版']} onSelect={(value) => onChange({ ratio: value as HeroTaskOptions['ratio'] })} />

      <div className="field">
        <label className="field-label">人物</label>
        <select className="input" value={options.person} onChange={(event) => onChange({ person: event.target.value as HeroTaskOptions['person'] })}>
          <option value="auto">跟随推荐</option>
          <option value="none">无人物</option>
          <option value="hand">手部展示</option>
          <option value="person">完整人物</option>
        </select>
      </div>

      <div className="controls-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !canGenerate} onClick={onGenerate}>{busy ? '生成中…' : '生成氛围主图'}</button>
        {!sourceAsset ? <div className="hint">请明确选择一张非参考源商品图</div> : null}
      </div>
    </div>
  );
}

function Choice({ label, current, values, labels = values, onSelect }: { label: string; current: string; values: string[]; labels?: string[]; onSelect(value: string): void }) {
  return <div className="field"><label className="field-label">{label}</label><div className="seg">{values.map((value, index) => <button key={value} type="button" className={`seg-btn${current === value ? ' is-active' : ''}`} onClick={() => onSelect(value)}>{labels[index]}</button>)}</div></div>;
}
