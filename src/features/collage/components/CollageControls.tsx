'use client';

import type { AssetRef } from '@/core/assets';
import type { ProductIntelligenceRecord } from '@/core/intelligence';
import type { CollageTaskOptions } from '@/core/tasks';
import type { TemplateDocument } from '@/core/templates';

/**
 * 组合卖点图控制面板。
 * 拼图完全确定性（无 AI 调用）：模板选择 → 布局 → 画布编辑 → 导出 PNG。
 */

interface CollageControlsProps {
  options: CollageTaskOptions;
  count: number;
  templates: TemplateDocument[];
  selectedCount: number;
  selectedAssetIds: string[];
  busy: boolean;
  collageDoc: TemplateDocument | null;
  assets: AssetRef[];
  intelligence: ProductIntelligenceRecord | null;
  onChange(patch: Partial<CollageTaskOptions>): void;
  onCountChange(n: number): void;
  onCreateLayout(): void;
  onReplaceSlot(slotIndex: number, assetId: string): void;
  onExport(): void;
}

export function CollageControls({
  options,
  count,
  templates,
  selectedCount,
  selectedAssetIds,
  busy,
  collageDoc,
  assets,
  intelligence,
  onChange,
  onCountChange,
  onCreateLayout,
  onReplaceSlot,
  onExport,
}: CollageControlsProps) {
  const imageSlots =
    collageDoc?.layers.filter((l) => l.type === 'image') ?? [];
  const suggestions = intelligence?.plan.collage ?? null;
  const hasReferenceSelection = selectedAssetIds.some(
    (id) => assets.find((asset) => asset.id === id)?.role === 'reference',
  );

  function applyRecommendedCopy() {
    const title = suggestions?.titleOptions[0]?.text ?? '';
    const sellingPoints = (suggestions?.sellingPoints ?? []).slice(0, 3).map((item) => item.text);
    onChange({
      title,
      includeTitle: Boolean(title),
      sellingPoints,
      includeSellingPoints: sellingPoints.length > 0,
    });
  }

  return (
    <div className="controls-body">
      <div className="field suggestion-panel">
        <label className="field-label">AI 文案建议</label>
        {suggestions ? (
          <>
            <div className="suggestion-chips">
              {suggestions.titleOptions.map((claim) => (
                <button key={claim.text} type="button" onClick={() => onChange({ title: claim.text, includeTitle: true })}>{claim.text}</button>
              ))}
            </div>
            <div className="selling-suggestions">
              {suggestions.sellingPoints.map((point) => (
                <button
                  key={point.text}
                  type="button"
                  onClick={() => {
                    const current = (options.sellingPoints ?? []).filter(Boolean);
                    onChange({
                      sellingPoints: [...new Set([...current, point.text])].slice(0, 3),
                      includeSellingPoints: true,
                    });
                  }}
                >
                  <span>{point.text}</span><small>有图片依据</small>
                </button>
              ))}
            </div>
            <button type="button" className="btn" onClick={applyRecommendedCopy}>应用推荐文案</button>
          </>
        ) : <div className="hint">AI 文案建议会在需要时自动准备；也可以直接手动填写。</div>}
      </div>

      <div className="field">
        <label className="field-label">布局模板</label>
        <div className="template-list">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`template-card${options.templateId === t.id ? ' is-active' : ''}`}
              onClick={() => onChange({ templateId: t.id })}
            >
              <div className="template-name">{t.name}</div>
              <div className="template-dims">
                {t.width}×{t.height} · 图片槽 {t.layers.filter((l) => l.type === 'image').length}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label">可编辑方案数量（≤ 模板数）</label>
        <div className="seg">
          {[1, 2, 3].map((n) => (
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
        <label className="field-label">
          <input
            type="checkbox"
            checked={options.includeTitle}
            onChange={(e) => onChange({ includeTitle: e.target.checked })}
          />
          主标题
        </label>
        {options.includeTitle && (
          <input
            className="input"
            placeholder="输入标题文字"
            value={options.title ?? ''}
            maxLength={60}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        )}
      </div>

      <div className="field">
        <label className="field-label">
          <input
            type="checkbox"
            checked={options.includeSellingPoints}
            onChange={(e) => onChange({ includeSellingPoints: e.target.checked })}
          />
          卖点标签
        </label>
        {options.includeSellingPoints && (
          <div className="sp-list">
            {(options.sellingPoints ?? ['', '', '']).map((sp, i) => (
              <input
                key={i}
                className="input"
                placeholder={`卖点 ${i + 1}`}
                value={sp}
                maxLength={40}
                onChange={(e) => {
                  const next = [...(options.sellingPoints ?? ['', '', ''])];
                  next[i] = e.target.value;
                  onChange({ sellingPoints: next });
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="controls-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || selectedCount === 0 || hasReferenceSelection}
          onClick={onCreateLayout}
        >
          {busy ? '创建中…' : '创建布局'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!collageDoc}
          onClick={onExport}
        >
          导出 PNG
        </button>
        {selectedCount === 0 && (
          <div className="hint">请先在左侧选择商品图片</div>
        )}
        {hasReferenceSelection ? (
          <div className="hint">
            参考图仅用于视觉方向，请取消选择参考图后再创建组合卖点图。
          </div>
        ) : null}
      </div>

      {imageSlots.length > 0 && (
        <div className="field">
          <label className="field-label">替换槽位图片</label>
          {imageSlots.map((slot) => (
            <div key={slot.id} className="slot-row">
              <span className="slot-label">槽位 {slot.slotIndex + 1}</span>
              <select
                className="input"
                value={slot.assetId ?? ''}
                onChange={(e) => {
                  if (e.target.value) onReplaceSlot(slot.slotIndex, e.target.value);
                }}
              >
                <option value="">未选择</option>
                {assets.filter((asset) => asset.role !== 'reference').map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
