'use client';

import type { AssetRef } from '@/core/assets';
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
  busy: boolean;
  collageDoc: TemplateDocument | null;
  assets: AssetRef[];
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
  busy,
  collageDoc,
  assets,
  onChange,
  onCountChange,
  onCreateLayout,
  onReplaceSlot,
  onExport,
}: CollageControlsProps) {
  const imageSlots =
    collageDoc?.layers.filter((l) => l.type === 'image') ?? [];

  return (
    <div className="controls-body">
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
        <label className="field-label">布局变体数量（≤ 模板数）</label>
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
          disabled={busy || selectedCount === 0}
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
                {assets.map((a) => (
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
