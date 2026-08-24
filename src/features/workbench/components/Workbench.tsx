'use client';

import { useCallback, useRef, useState } from 'react';
import type { TaskKind } from '@/core/tasks';
import { useWorkbench } from '@/features/workbench/model/workbench';
import { AssetPanel } from '@/features/assets/components/AssetPanel';
import { HeroControls } from '@/features/hero/components/HeroControls';
import { CollageControls } from '@/features/collage/components/CollageControls';
import { CollageEditorHandle } from '@/features/collage/components/CollageEditor';
import { CanvasArea } from '@/features/workbench/components/CanvasArea';
import { LaterPhasePanel } from '@/features/workbench/components/LaterPhasePanel';
import { DetailPlaceholder } from '@/features/detail/components/DetailPlaceholder';
import { buildCollageDocument, getCollageTemplate, listCollageTemplates } from '@/features/collage/model/collage';
import type { TemplateDocument } from '@/core/templates';

const TASK_TABS: Array<{ kind: TaskKind; label: string }> = [
  { kind: 'hero', label: '氛围主图' },
  { kind: 'collage', label: '组合卖点图' },
  { kind: 'detail', label: '详情页图' },
  { kind: 'optimize', label: '简单优化' },
];

export function Workbench() {
  const wb = useWorkbench();
  const collageEditorRef = useRef<CollageEditorHandle | null>(null);
  const [collageVariants, setCollageVariants] = useState<TemplateDocument[]>([]);
  const [activeCollageVariant, setActiveCollageVariant] = useState(0);
  const templates = listCollageTemplates();
  const collageDoc = collageVariants[activeCollageVariant] ?? null;

  const handleCreateLayout = useCallback(async () => {
    const task = await wb.createCollageTask();
    if (!task || task.status !== 'succeeded' || !task.result) return;
    const variants = task.result.outputs.flatMap((output) => {
      if (output.kind !== 'collage') return [];
      const template = getCollageTemplate(output.templateId);
      if (!template) return [];
      return [
        buildCollageDocument(template, wb.selectedAssetIds, {
          title: wb.collageOptions.title ?? '',
          includeTitle: wb.collageOptions.includeTitle,
          sellingPoints: wb.collageOptions.sellingPoints ?? [],
          includeSellingPoints: wb.collageOptions.includeSellingPoints,
        }),
      ];
    });
    if (variants.length !== task.request.count) {
      wb.setNotice('服务端返回的布局方案不完整，请重新创建');
      return;
    }
    setCollageVariants(variants);
    setActiveCollageVariant(0);
    await collageEditorRef.current?.createLayout(variants[0]);
    wb.setNotice(
      `已创建 ${variants.length} 个独立方案：可分别编辑、切换并导出 PNG`,
    );
  }, [wb]);

  const handleSelectCollageVariant = useCallback(
    async (nextIndex: number) => {
      if (nextIndex === activeCollageVariant) return;
      const current = collageEditorRef.current?.getDocument();
      const nextVariants = collageVariants.map((doc, index) =>
        index === activeCollageVariant && current ? current : doc,
      );
      const next = nextVariants[nextIndex];
      if (!next) return;
      setCollageVariants(nextVariants);
      setActiveCollageVariant(nextIndex);
      await collageEditorRef.current?.createLayout(next);
    },
    [activeCollageVariant, collageVariants],
  );

  const handleExport = useCallback(async () => {
    try {
      await collageEditorRef.current?.exportPNG(
        `collage-variant-${activeCollageVariant + 1}.png`,
      );
    } catch (e) {
      // 导出失败由编辑器抛出；此处仅兜底
      void e;
    }
  }, [activeCollageVariant]);

  const handleReplaceSlot = useCallback(
    async (slotIndex: number, assetId: string) => {
      const doc = collageDoc;
      if (!doc) return;
      const slotLayer = doc.layers.find(
        (l) => l.type === 'image' && l.slotIndex === slotIndex,
      );
      if (!slotLayer || slotLayer.type !== 'image') return;
      await collageEditorRef.current?.replaceSlotImage(
        slotLayer.id,
        `/api/assets/${assetId}`,
        assetId,
      );
      setCollageVariants((prev) =>
        prev.map((variant, variantIndex) =>
          variantIndex === activeCollageVariant
            ? {
                ...variant,
                layers: variant.layers.map((layer) =>
                  layer.type === 'image' && layer.id === slotLayer.id
                    ? { ...layer, assetId, contentTransform: undefined }
                    : layer,
                ),
              }
            : variant,
        ),
      );
    },
    [activeCollageVariant, collageDoc],
  );

  return (
    <div className="workbench">
      <header className="app-header">
        <div className="app-brand">商品视觉工作台</div>
        <nav className="task-tabs">
          {TASK_TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              className={`tab${wb.kind === tab.kind ? ' is-active' : ''}`}
              onClick={() => wb.setKind(tab.kind)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="workbench-body">
        <AssetPanel
          assets={wb.assets}
          selectedIds={wb.selectedAssetIds}
          busy={wb.busy}
          onUpload={wb.upload}
          onToggle={wb.toggleAsset}
          onSetRole={wb.setRole}
        />

        {wb.kind === 'hero' && (
          <>
            <CanvasArea
              kind="hero"
              latestHeroTask={wb.latestHeroTask}
              collageEditorRef={collageEditorRef}
            />
            <aside className="panel controls-panel">
              <div className="panel-title">氛围主图设置</div>
              <HeroControls
                options={wb.heroOptions}
                assets={wb.assets}
                count={wb.heroCount}
                busy={wb.busy}
                onChange={wb.patchHeroOptions}
                onCountChange={wb.setHeroCount}
                onGenerate={() => void wb.runHero()}
              />
              <StatusBar busy={wb.busy} error={wb.error} notice={wb.notice} />
            </aside>
          </>
        )}

        {wb.kind === 'collage' && (
          <>
            <CanvasArea
              kind="collage"
              latestHeroTask={null}
              collageEditorRef={collageEditorRef}
              collageVariantCount={collageVariants.length}
              activeCollageVariant={activeCollageVariant}
              onSelectCollageVariant={(index) => void handleSelectCollageVariant(index)}
            />
            <aside className="panel controls-panel">
              <div className="panel-title">组合卖点图设置</div>
              <CollageControls
                options={wb.collageOptions}
                count={wb.collageCount}
                templates={templates}
                selectedCount={wb.selectedAssetIds.length}
                busy={wb.busy}
                collageDoc={collageDoc}
                assets={wb.assets}
                onChange={wb.patchCollageOptions}
                onCountChange={wb.setCollageCount}
                onCreateLayout={() => void handleCreateLayout()}
                onReplaceSlot={(i, id) => void handleReplaceSlot(i, id)}
                onExport={() => void handleExport()}
              />
              <StatusBar busy={wb.busy} error={wb.error} notice={wb.notice} />
            </aside>
          </>
        )}

        {wb.kind === 'detail' && (
          <>
            <DetailPlaceholder />
            <aside className="panel controls-panel">
              <div className="panel-title">详情页图设置</div>
              <div className="later-panel-body">V2 阶段开放</div>
            </aside>
          </>
        )}

        {wb.kind === 'optimize' && (
          <>
            <LaterPhasePanel
              title="简单优化"
              note="简单优化为 V2 阶段能力：V1 仅保留任务契约（TaskKind='optimize'），不做批量界面/队列/SKU 导入。"
            />
            <aside className="panel controls-panel">
              <div className="panel-title">简单优化设置</div>
              <div className="later-panel-body">V2 阶段开放</div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

function StatusBar({
  busy,
  error,
  notice,
}: {
  busy: boolean;
  error: string | null;
  notice: string | null;
}) {
  return (
    <div className="status-bar">
      {busy && <div className="status-loading">处理中…</div>}
      {error && <div className="status-error">{error}</div>}
      {notice && <div className="status-notice">{notice}</div>}
    </div>
  );
}
