'use client';

import { useCallback, useRef } from 'react';
import type { AssetRef, AssetRole } from '@/core/assets';
import { ASSET_ROLES } from '@/core/assets';
import { assetUrl } from '@/core/results';

/**
 * 左侧资源面板：拖拽/点选上传、缩略图网格、选中/取消、角色修正。
 */

interface AssetPanelProps {
  workspaceId: string;
  assets: AssetRef[];
  selectedIds: string[];
  busy: boolean;
  onUpload(files: File[]): void;
  onToggle(id: string): void;
  onSetRole(id: string, role: AssetRole): void;
}

const ROLE_LABELS: Record<AssetRole, string> = {
  primary: '主图',
  front: '正面',
  back: '背面',
  side: '侧面',
  inside: '内部',
  detail: '细节',
  size: '尺寸图',
  reference: '参考图',
  unknown: '未分类',
};

export function AssetPanel({
  workspaceId,
  assets,
  selectedIds,
  busy,
  onUpload,
  onToggle,
  onSetRole,
}: AssetPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      onUpload(Array.from(fileList));
    },
    [onUpload],
  );

  return (
    <aside className="panel assets-panel">
      <div className="panel-title">
        商品素材
        <span className="panel-sub">{assets.length} 张 · 已选 {selectedIds.length}</span>
      </div>

      <div
        className="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => {
          if (!busy) inputRef.current?.click();
        }}
      >
        {busy ? '上传中…' : '拖拽图片到此处，或点击选择（JPEG/PNG/WebP）'}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={busy}
          hidden
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <div className="asset-grid">
        {assets.length === 0 && <div className="empty-hint">暂无图片，请先上传商品图</div>}
        {assets.map((asset) => {
          const selected = selectedIds.includes(asset.id);
          return (
            <div
              key={asset.id}
              className={`asset-card${selected ? ' is-selected' : ''}`}
              onClick={() => onToggle(asset.id)}
              title={asset.name}
            >
              <img
                src={assetUrl(workspaceId, asset.id, 'thumb')}
                alt={asset.name}
                loading="lazy"
                className="asset-thumb"
              />
              <div className="asset-info">
                <div className="asset-name">{asset.name}</div>
                <div className="asset-dims">
                  {asset.width}×{asset.height}
                </div>
              </div>
              <select
                className="asset-role"
                value={asset.role}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onSetRole(asset.id, e.target.value as AssetRole)}
              >
                {ASSET_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              {selected && <div className="asset-check">✓</div>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
