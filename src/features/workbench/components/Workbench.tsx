'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskKind } from '@/core/tasks';
import { assetUrl } from '@/core/results';
import { useWorkbench } from '@/features/workbench/model/workbench';
import { useWorkspaces } from '@/features/workspaces/model/useWorkspaces';
import { WorkspaceSwitcher } from '@/features/workspaces/components/WorkspaceSwitcher';
import { AssetPanel } from '@/features/assets/components/AssetPanel';
import { HeroControls } from '@/features/hero/components/HeroControls';
import { CollageControls } from '@/features/collage/components/CollageControls';
import { CollageEditorHandle } from '@/features/collage/components/CollageEditor';
import { CanvasArea } from '@/features/workbench/components/CanvasArea';
import { LaterPhasePanel } from '@/features/workbench/components/LaterPhasePanel';
import { DetailPlaceholder } from '@/features/detail/components/DetailPlaceholder';
import {
  buildCollageDocument,
  getCollageTemplate,
  listCollageTemplates,
} from '@/features/collage/model/collage';
import type { TemplateDocument } from '@/core/templates';

const TASK_TABS: Array<{ kind: TaskKind; label: string }> = [
  { kind: 'hero', label: '氛围主图' },
  { kind: 'collage', label: '组合卖点图' },
  { kind: 'detail', label: '详情页图' },
  { kind: 'optimize', label: '简单优化' },
];

export function Workbench() {
  const workspaces = useWorkspaces();
  const wb = useWorkbench(workspaces.activeWorkspaceId);
  const collageEditorRef = useRef<CollageEditorHandle | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const templates = listCollageTemplates();
  const workspaceId = workspaces.activeWorkspaceId;
  const collageDoc = wb.collageVariants[wb.activeCollageVariant] ?? null;

  useEffect(() => {
    if (!workspaceId || !wb.hydrated || wb.kind !== 'collage' || !collageDoc) return;
    void collageEditorRef.current?.createLayout(collageDoc);
    // 文档内容变化由 onDocumentChange 回传，不能因此重建 Fabric 画布。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, wb.hydrated, wb.kind, wb.activeCollageVariant]);

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
    wb.setCollageVariants(variants);
    wb.setActiveCollageVariant(0);
    await collageEditorRef.current?.createLayout(variants[0]);
    wb.setNotice(`已创建 ${variants.length} 个独立方案：可分别编辑、切换并导出 PNG`);
  }, [wb]);

  const handleSelectCollageVariant = useCallback(
    async (nextIndex: number) => {
      if (nextIndex === wb.activeCollageVariant) return;
      const next = wb.collageVariants[nextIndex];
      if (!next) return;
      wb.setActiveCollageVariant(nextIndex);
      await collageEditorRef.current?.createLayout(next);
    },
    [wb],
  );

  const handleExport = useCallback(async () => {
    try {
      await collageEditorRef.current?.exportPNG(
        `collage-variant-${wb.activeCollageVariant + 1}.png`,
      );
    } catch (reason) {
      void reason;
    }
  }, [wb.activeCollageVariant]);

  const handleReplaceSlot = useCallback(
    async (slotIndex: number, assetId: string) => {
      if (!workspaceId || !collageDoc) return;
      const slotLayer = collageDoc.layers.find(
        (layer) => layer.type === 'image' && layer.slotIndex === slotIndex,
      );
      if (!slotLayer || slotLayer.type !== 'image') return;
      await collageEditorRef.current?.replaceSlotImage(
        slotLayer.id,
        assetUrl(workspaceId, assetId),
        assetId,
      );
    },
    [collageDoc, workspaceId],
  );

  const handleCollageDocumentChange = useCallback(
    (doc: TemplateDocument) => wb.replaceActiveCollageVariant(doc),
    [wb],
  );

  return (
    <div className="workbench">
      <header className="app-header">
        <div className="app-brand">商品视觉工作台</div>
        <WorkspaceSwitcher
          workspaces={workspaces.workspaces}
          activeWorkspaceId={workspaces.activeWorkspaceId}
          activeWorkspace={workspaces.activeWorkspace}
          creating={workspaces.creating}
          createOpen={createOpen}
          error={workspaces.error}
          onCreateOpenChange={setCreateOpen}
          onCreate={workspaces.createWorkspace}
          onSelect={workspaces.selectWorkspace}
        />
        <nav className="task-tabs">
          {TASK_TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              className={`tab${wb.kind === tab.kind ? ' is-active' : ''}`}
              disabled={!workspaceId || !wb.hydrated}
              onClick={() => wb.setKind(tab.kind)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {!workspaceId ? (
        <div className="workbench-body workspace-empty-body">
          <section className="workspace-empty">
            <h1>{workspaces.loading ? '正在加载商品…' : '还没有商品'}</h1>
            {!workspaces.loading ? (
              <>
                <p>先新建一个商品，再上传素材和生成图片。</p>
                <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                  新建商品
                </button>
              </>
            ) : null}
          </section>
        </div>
      ) : (
        <div className="workbench-body">
          <AssetPanel
            workspaceId={workspaceId}
            assets={wb.assets}
            selectedIds={wb.selectedAssetIds}
            busy={wb.busy}
            onUpload={wb.upload}
            onToggle={wb.toggleAsset}
            onSetRole={wb.setRole}
          />

          {wb.kind === 'hero' ? (
            <>
              <CanvasArea
                workspaceId={workspaceId}
                kind="hero"
                latestHeroTask={wb.latestHeroTask}
                collageEditorRef={collageEditorRef}
              />
              <aside className="panel controls-panel">
                <div className="panel-title">氛围主图设置</div>
                <HeroControls
                  workspaceId={workspaceId}
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
          ) : null}

          {wb.kind === 'collage' ? (
            <>
              <CanvasArea
                workspaceId={workspaceId}
                kind="collage"
                latestHeroTask={null}
                collageEditorRef={collageEditorRef}
                collageVariantCount={wb.collageVariants.length}
                activeCollageVariant={wb.activeCollageVariant}
                onSelectCollageVariant={(index) => void handleSelectCollageVariant(index)}
                onCollageDocumentChange={handleCollageDocumentChange}
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
                  onReplaceSlot={(index, id) => void handleReplaceSlot(index, id)}
                  onExport={() => void handleExport()}
                />
                <StatusBar busy={wb.busy} error={wb.error} notice={wb.notice} />
              </aside>
            </>
          ) : null}

          {wb.kind === 'detail' ? (
            <>
              <DetailPlaceholder />
              <aside className="panel controls-panel">
                <div className="panel-title">详情页图设置</div>
                <div className="later-panel-body">V2 阶段开放</div>
              </aside>
            </>
          ) : null}

          {wb.kind === 'optimize' ? (
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
          ) : null}
        </div>
      )}
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
      {busy ? <div className="status-loading">处理中…</div> : null}
      {error ? <div className="status-error">{error}</div> : null}
      {notice ? <div className="status-notice">{notice}</div> : null}
    </div>
  );
}
