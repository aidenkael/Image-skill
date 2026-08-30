'use client';

import type { AssetRef } from '@/core/assets';
import { assetUrl } from '@/core/results';
import type { HeroTaskOptions } from '@/core/tasks';

/**
 * 一键氛围主图控制面板：
 * 源图 + 可选创作要求 + 人物偏好 + 数量 + 比例 + 一个主操作。
 * Director、Prompt 编译、生成、批量 QA 与补生全部由任务内部完成。
 */

interface HeroControlsProps {
  workspaceId: string;
  options: HeroTaskOptions;
  assets: AssetRef[];
  count: number;
  busy: boolean;
  visionConfigured: boolean;
  imageConfigured: boolean;
  onChange(patch: Partial<HeroTaskOptions>): void;
  onCountChange(n: number): void;
  onGenerate(): void;
}

export function HeroControls({
  workspaceId,
  options,
  assets,
  count,
  busy,
  visionConfigured,
  imageConfigured,
  onChange,
  onCountChange,
  onGenerate,
}: HeroControlsProps) {
  const sourceAsset = assets.find((asset) => asset.id === options.sourceAssetId);
  const blocker = busy
    ? '当前商品的氛围主图正在生成，请等待完成。'
    : !sourceAsset
      ? '请明确选择一张非参考源商品图。'
      : !visionConfigured
        ? '请先在 AI 设置中选择商品分析/视觉模型'
        : !imageConfigured
          ? '请先在 AI 设置中选择氛围主图生成模型'
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
        <label className="field-label" htmlFor="hero-creative-intent">可选创作要求</label>
        <textarea
          id="hero-creative-intent"
          className="input textarea"
          placeholder="可不填。需要特定场景、氛围或展示方式时直接写一句话。"
          value={options.creativeIntent ?? ''}
          maxLength={500}
          onChange={(event) => onChange({ creativeIntent: event.target.value })}
        />
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
              : '自动：由 AI 按买家理解商品的价值判断展示方式。'}
        </div>
      </div>

      <Choice label="输出数量" current={String(count)} values={['1', '2', '3', '4']} onSelect={(value) => onCountChange(Number(value))} />
      <Choice label="画面比例" current={options.ratio} values={['1:1', '3:4', '4:3']} labels={['1:1 方形', '3:4 竖版', '4:3 横版']} onSelect={(value) => onChange({ ratio: value as HeroTaskOptions['ratio'] })} />

      <div className="controls-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={Boolean(blocker)}
          onClick={onGenerate}
        >
          {busy ? '生成中…' : '生成氛围主图'}
        </button>
        {blocker ? <div className="hint blocker-hint">{blocker}</div> : null}
      </div>
    </div>
  );
}

function Choice({ label, current, values, labels = values, onSelect }: { label: string; current: string; values: string[]; labels?: string[]; onSelect(value: string): void }) {
  return <div className="field"><label className="field-label">{label}</label><div className="seg">{values.map((value, index) => <button key={value} type="button" className={`seg-btn${current === value ? ' is-active' : ''}`} onClick={() => onSelect(value)}>{labels[index]}</button>)}</div></div>;
}
