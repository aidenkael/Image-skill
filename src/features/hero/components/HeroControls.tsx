'use client';

import type { AssetRef } from '@/core/assets';
import { assetUrl } from '@/core/results';
import type { HeroTaskOptions } from '@/core/tasks';

/**
 * 氛围主图控制面板。
 * 不暴露 prompt / 模型 id / Provider 内部细节；只有用户方向选项。
 */

interface HeroControlsProps {
  workspaceId: string;
  options: HeroTaskOptions;
  assets: AssetRef[];
  count: number;
  busy: boolean;
  onChange(patch: Partial<HeroTaskOptions>): void;
  onCountChange(n: number): void;
  onGenerate(): void;
}

const RATIOS: Array<{ value: HeroTaskOptions['ratio']; label: string }> = [
  { value: '1:1', label: '1:1 方形' },
  { value: '3:4', label: '3:4 竖版' },
  { value: '4:3', label: '4:3 横版' },
];

const PERSONS: Array<{ value: HeroTaskOptions['person']; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'none', label: '无人物' },
  { value: 'hand', label: '手部展示' },
  { value: 'person', label: '完整人物' },
];

export function HeroControls({
  workspaceId,
  options,
  assets,
  count,
  busy,
  onChange,
  onCountChange,
  onGenerate,
}: HeroControlsProps) {
  const sourceAsset = assets.find((asset) => asset.id === options.sourceAssetId);

  return (
    <div className="controls-body">
      <div className="field">
        <label className="field-label" htmlFor="hero-source-asset">
          源商品图（仅 1 张）
        </label>
        <select
          id="hero-source-asset"
          className="input"
          value={options.sourceAssetId}
          onChange={(e) => onChange({ sourceAssetId: e.target.value })}
        >
          <option value="">请选择源商品图</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
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
        <label className="field-label">输出数量</label>
        <div className="seg">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              className={`seg-btn${count === n ? ' is-active' : ''}`}
              onClick={() => onCountChange(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label">画面比例</label>
        <div className="seg">
          {RATIOS.map((r) => (
            <button
              key={r.value}
              type="button"
              className={`seg-btn${options.ratio === r.value ? ' is-active' : ''}`}
              onClick={() => onChange({ ratio: r.value })}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label">人物</label>
        <select
          className="input"
          value={options.person}
          onChange={(e) => onChange({ person: e.target.value as HeroTaskOptions['person'] })}
        >
          {PERSONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label">场景</label>
        <div className="seg">
          <button
            type="button"
            className={`seg-btn${options.sceneMode === 'auto' ? ' is-active' : ''}`}
            onClick={() => onChange({ sceneMode: 'auto' })}
          >
            自动搭配
          </button>
          <button
            type="button"
            className={`seg-btn${options.sceneMode === 'prompt' ? ' is-active' : ''}`}
            onClick={() => onChange({ sceneMode: 'prompt' })}
          >
            手动描述
          </button>
        </div>
        {options.sceneMode === 'prompt' && (
          <textarea
            className="input textarea"
            placeholder="描述想要的场景，例如：阳光充足的北欧风客厅，木地板，产品放在茶几上"
            value={options.scenePrompt ?? ''}
            maxLength={500}
            onChange={(e) => onChange({ scenePrompt: e.target.value })}
          />
        )}
      </div>

      <div className="controls-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !sourceAsset}
          onClick={onGenerate}
        >
          {busy ? '生成中…' : '生成氛围主图'}
        </button>
        {!sourceAsset && <div className="hint">请从已上传图片中明确选择一张源商品图</div>}
      </div>
    </div>
  );
}
