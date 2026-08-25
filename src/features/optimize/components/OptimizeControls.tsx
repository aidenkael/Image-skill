'use client';

import type { AssetRef } from '@/core/assets';
import type { OptimizeTaskOptions } from '@/core/tasks';

interface OptimizeControlsProps {
  options: OptimizeTaskOptions;
  assets: AssetRef[];
  busy: boolean;
  onChange(patch: Partial<OptimizeTaskOptions>): void;
  onRun(): void;
}

export function OptimizeControls({ options, assets, busy, onChange, onRun }: OptimizeControlsProps) {
  return (
    <div className="controls-body">
      <div className="field">
        <label className="field-label" htmlFor="optimize-source">源商品图</label>
        <select id="optimize-source" className="input" value={options.sourceAssetId} onChange={(event) => onChange({ sourceAssetId: event.target.value })}>
          <option value="">请选择一张图片</option>
          {assets.filter((asset) => asset.role !== 'reference').map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>
      </div>
      <Choice label="比例" values={[
        ['original', '保持原比例'], ['1:1', '1:1 方形'], ['3:4', '3:4 竖版'], ['4:3', '4:3 横版'],
      ]} current={options.ratio} onSelect={(value) => onChange({ ratio: value as OptimizeTaskOptions['ratio'] })} />
      {options.ratio !== 'original' ? (
        <>
          <Choice label="适配方式" values={[["contain", "完整显示"], ["cover", "铺满裁切"]]} current={options.fit} onSelect={(value) => onChange({ fit: value as OptimizeTaskOptions['fit'] })} />
          {options.fit === 'contain' ? <Choice label="背景填充" values={[["white", "白色"], ["light-gray", "浅灰"]]} current={options.background} onSelect={(value) => onChange({ background: value as OptimizeTaskOptions['background'] })} /> : null}
        </>
      ) : null}
      <Choice label="最长边" values={[["1024", "1024"], ["1600", "1600"], ["2000", "2000"]]} current={String(options.maxEdge)} onSelect={(value) => onChange({ maxEdge: Number(value) as OptimizeTaskOptions['maxEdge'] })} />
      <Choice label="格式" values={[["jpg", "JPG"], ["png", "PNG"], ["webp", "WebP"]]} current={options.format} onSelect={(value) => onChange({ format: value as OptimizeTaskOptions['format'] })} />
      <Choice label="质量" values={[["80", "80"], ["90", "90"], ["100", "100"]]} current={String(options.quality)} onSelect={(value) => onChange({ quality: Number(value) })} />
      <button type="button" className="btn btn-primary" disabled={busy || !options.sourceAssetId} onClick={onRun}>
        {busy ? '优化中…' : '优化图片'}
      </button>
      {!options.sourceAssetId ? <div className="hint">请选择一张需要优化的商品图</div> : null}
    </div>
  );
}

function Choice({ label, values, current, onSelect }: { label: string; values: string[][]; current: string; onSelect(value: string): void }) {
  return <div className="field"><label className="field-label">{label}</label><div className="seg seg-wrap">{values.map(([value, text]) => <button key={value} type="button" className={`seg-btn${current === value ? ' is-active' : ''}`} onClick={() => onSelect(value)}>{text}</button>)}</div></div>;
}
