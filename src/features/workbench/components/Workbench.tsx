'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetRole } from '@/core/assets';
import { assetUrl } from '@/core/results';
import type { TemplateDocument } from '@/core/templates';
import { AssetPanel } from '@/features/assets/components/AssetPanel';
import { CollageControls } from '@/features/collage/components/CollageControls';
import type { CollageEditorHandle } from '@/features/collage/components/CollageEditor';
import {
  buildCollageDocument,
  collageDocumentUsesForbiddenAsset,
  getCollageTemplate,
  listCollageTemplates,
  removeAssetFromCollageDocument,
  sanitizeCollageDocumentAssets,
} from '@/features/collage/model/collage';
import { HeroControls } from '@/features/hero/components/HeroControls';
import { ProductInsightBar } from '@/features/intelligence/components/ProductInsightBar';
import { useProductIntelligence } from '@/features/intelligence/model/useProductIntelligence';
import { OptimizeControls } from '@/features/optimize/components/OptimizeControls';
import { useAISettings } from '@/features/system/model/useSystemStatus';
import { CanvasArea } from '@/features/workbench/components/CanvasArea';
import { WorkbenchHeader } from '@/features/workbench/components/WorkbenchHeader';
import { useWorkbench } from '@/features/workbench/model/workbench';
import { useWorkspaces } from '@/features/workspaces/model/useWorkspaces';

export function Workbench() {
  const workspaces = useWorkspaces();
  const wb = useWorkbench(workspaces.activeWorkspaceId);
  const intelligence = useProductIntelligence(workspaces.activeWorkspaceId, wb.assets);
  const aiSettings = useAISettings();
  const collageEditorRef = useRef<CollageEditorHandle | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const templates = listCollageTemplates();
  const workspaceId = workspaces.activeWorkspaceId;
  const collageDoc = wb.collageVariants[wb.activeCollageVariant] ?? null;
  const freshIntelligence = intelligence.fresh ? intelligence.record : null;
  const lockedAssetIds = new Set<string>();
  for (const id of intelligence.lockedAssetIds) lockedAssetIds.add(id);
  if (wb.latestHeroTask?.status === 'running') {
    for (const id of wb.latestHeroTask.request.assetIds) lockedAssetIds.add(id);
  } else if (wb.heroBusy && wb.heroOptions.sourceAssetId) {
    lockedAssetIds.add(wb.heroOptions.sourceAssetId);
  }
  const currentBusy = wb.kind === 'hero'
    ? wb.heroBusy
    : wb.kind === 'collage'
      ? wb.collageBusy
      : wb.optimizeBusy;

  useEffect(() => {
    if (wb.hydrated && wb.kind === 'detail') wb.setKind('hero');
  }, [wb.hydrated, wb.kind, wb.setKind]);

  useEffect(() => {
    if (!workspaceId || !wb.hydrated || wb.kind !== 'collage' || !collageDoc) return;
    void collageEditorRef.current?.createLayout(collageDoc);
    // 文档内容变化由 onDocumentChange 回传，不能因此重建 Fabric 画布。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, wb.hydrated, wb.kind, wb.activeCollageVariant]);

  const handleAnalyze = useCallback(async () => {
    await intelligence.analyze(wb.selectedAssetIds);
  }, [intelligence, wb]);

  const handleCreateLayout = useCallback(async () => {
    const task = await wb.createCollageTask();
    if (!task || task.status !== 'succeeded' || !task.result) return;
    const variants = task.result.outputs.flatMap((output) => {
      if (output.kind !== 'collage') return [];
      const template = getCollageTemplate(output.templateId);
      if (!template) return [];
      return [buildCollageDocument(template, wb.selectedAssetIds, {
        title: wb.collageOptions.title ?? '',
        includeTitle: wb.collageOptions.includeTitle,
        sellingPoints: wb.collageOptions.sellingPoints ?? [],
        includeSellingPoints: wb.collageOptions.includeSellingPoints,
      })];
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

  const handleSelectCollageVariant = useCallback(async (nextIndex: number) => {
    if (nextIndex === wb.activeCollageVariant) return;
    const next = wb.collageVariants[nextIndex];
    if (!next) return;
    wb.setActiveCollageVariant(nextIndex);
    await collageEditorRef.current?.createLayout(next);
  }, [wb]);

  const handleSetRole = useCallback(async (id: string, role: AssetRole) => {
    const updated = await wb.setRole(id, role);
    if (!updated || updated.role !== 'reference') return;
    const editor = collageEditorRef.current;
    const currentDoc = editor?.getDocument();
    if (!editor || !currentDoc) return;
    const sanitized = removeAssetFromCollageDocument(currentDoc, updated.id);
    wb.replaceActiveCollageVariant(sanitized);
    await editor.createLayout(sanitized);
  }, [wb]);

  const handleRemoveAsset = useCallback(async (id: string) => {
    const removed = await wb.removeAsset(id);
    if (!removed) return;
    const editor = collageEditorRef.current;
    const currentDoc = editor?.getDocument();
    if (!editor || !currentDoc) return;
    const sanitized = removeAssetFromCollageDocument(currentDoc, id);
    wb.replaceActiveCollageVariant(sanitized);
    await editor.createLayout(sanitized);
  }, [wb]);

  const handleExport = useCallback(async () => {
    try {
      const editor = collageEditorRef.current;
      const currentDoc = editor?.getDocument();
      if (!editor || !currentDoc) {
        wb.setNotice('导出失败，请稍后重试');
        return;
      }
      if (collageDocumentUsesForbiddenAsset(currentDoc, wb.assets)) {
        const sanitized = sanitizeCollageDocumentAssets(currentDoc, wb.assets);
        wb.replaceActiveCollageVariant(sanitized);
        await editor.createLayout(sanitized);
        wb.setNotice('方案中有已失效或参考图片，已移除，请确认后重新导出。');
        return;
      }
      await editor.exportPNG(`collage-variant-${wb.activeCollageVariant + 1}.png`);
      wb.setNotice('当前方案已导出 PNG');
    } catch {
      wb.setNotice('导出失败，请稍后重试');
    }
  }, [wb]);

  const handleReplaceSlot = useCallback(async (slotIndex: number, assetId: string) => {
    if (!workspaceId || !collageDoc) return;
    const asset = wb.assets.find((item) => item.id === assetId);
    if (!asset || asset.role === 'reference') return;
    const slotLayer = collageDoc.layers.find(
      (layer) => layer.type === 'image' && layer.slotIndex === slotIndex,
    );
    if (!slotLayer || slotLayer.type !== 'image') return;
    await collageEditorRef.current?.replaceSlotImage(
      slotLayer.id,
      assetUrl(workspaceId, assetId),
      assetId,
    );
  }, [collageDoc, wb.assets, workspaceId]);

  const handleCollageDocumentChange = useCallback(
    (document: TemplateDocument) => wb.replaceActiveCollageVariant(document),
    [wb],
  );

  return (
    <div className="workbench">
      <WorkbenchHeader
        workspaces={workspaces}
        kind={wb.kind}
        hydrated={wb.hydrated}
        createOpen={createOpen}
        aiSettings={aiSettings.settings}
        aiLoading={aiSettings.loading}
        aiActions={{
          createProfile: aiSettings.createProfile,
          updateProfile: aiSettings.updateProfile,
          deleteProfile: aiSettings.deleteProfile,
          setActiveProfiles: aiSettings.setActiveProfiles,
          testProfile: aiSettings.testProfile,
        }}
        heroRunning={wb.heroBusy}
        onCreateOpenChange={setCreateOpen}
        onKindChange={wb.setKind}
      />

      {!workspaceId ? (
        <div className="workbench-body workspace-empty-body">
          <section className="workspace-empty">
            <h1>{workspaces.loading ? '正在加载商品…' : '还没有商品'}</h1>
            {!workspaces.loading ? (
              <>
                <p>新建一个商品后即可上传素材并开始制作。</p>
                <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>新建商品</button>
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
            uploading={wb.uploading}
            lockedIds={lockedAssetIds}
            mutatingIds={wb.assetMutatingIds}
            onUpload={wb.upload}
            onToggle={wb.toggleAsset}
            onSetRole={(id, role) => void handleSetRole(id, role)}
            onRemove={(id) => void handleRemoveAsset(id)}
          />

          <main className="center-column">
            <ProductInsightBar
              assetCount={wb.assets.length}
              selectedCount={wb.selectedAssetIds.length}
              record={intelligence.record}
              loading={intelligence.loading}
              analyzing={intelligence.analyzing}
              error={intelligence.error}
              fresh={intelligence.fresh}
              hasUnanalyzedAssets={intelligence.hasUnanalyzedAssets}
              aiConfigured={Boolean(aiSettings.settings?.activeVisionProfileId)}
              onAnalyze={() => void handleAnalyze()}
            />
            {wb.assets.length === 0 ? (
              <section className="canvas-area empty-upload-state">
                <div><strong>先上传商品图片</strong><span>建议准备正面主图和能看清商品细节的图片。</span></div>
              </section>
            ) : (
              <CanvasArea
                workspaceId={workspaceId}
                kind={wb.kind === 'detail' ? 'hero' : wb.kind}
                latestTask={wb.kind === 'hero' ? wb.latestHeroTask : wb.kind === 'optimize' ? wb.latestOptimizeTask : null}
                collageEditorRef={collageEditorRef}
                collageVariantCount={wb.collageVariants.length}
                activeCollageVariant={wb.activeCollageVariant}
                onSelectCollageVariant={(index) => void handleSelectCollageVariant(index)}
                onCollageDocumentChange={handleCollageDocumentChange}
              />
            )}
          </main>

          <aside className="panel controls-panel">
            <div className="panel-title">
              {wb.kind === 'hero' ? '氛围主图设置' : wb.kind === 'collage' ? '组合卖点图设置' : '简单优化设置'}
            </div>
            {wb.kind === 'hero' ? (
              <HeroControls
                workspaceId={workspaceId}
                options={wb.heroOptions}
                assets={wb.assets}
                intelligence={freshIntelligence}
                count={wb.heroCount}
                busy={wb.heroBusy}
                aiConfigured={Boolean(aiSettings.settings?.activeImageProfileId)}
                onChange={wb.patchHeroOptions}
                onCountChange={wb.setHeroCount}
                onGenerate={() => void wb.runHero()}
              />
            ) : null}
            {wb.kind === 'collage' ? (
              <CollageControls
                options={wb.collageOptions}
                count={wb.collageCount}
                templates={templates}
                selectedCount={wb.selectedAssetIds.length}
                selectedAssetIds={wb.selectedAssetIds}
                busy={wb.collageBusy}
                collageDoc={collageDoc}
                assets={wb.assets}
                intelligence={freshIntelligence}
                onChange={wb.patchCollageOptions}
                onCountChange={wb.setCollageCount}
                onCreateLayout={() => void handleCreateLayout()}
                onReplaceSlot={(index, id) => void handleReplaceSlot(index, id)}
                onExport={() => void handleExport()}
              />
            ) : null}
            {wb.kind === 'optimize' ? (
              <OptimizeControls options={wb.optimizeOptions} assets={wb.assets} busy={wb.optimizeBusy} onChange={wb.patchOptimizeOptions} onRun={() => void wb.runOptimize()} />
            ) : null}
            <StatusBar busy={currentBusy} error={wb.error ?? aiSettings.error} notice={wb.notice} />
          </aside>
        </div>
      )}
    </div>
  );
}

function StatusBar({ busy, error, notice }: { busy: boolean; error: string | null; notice: string | null }) {
  return <div className="status-bar">{busy ? <div className="status-loading">处理中…</div> : null}{error ? <div className="status-error">{error}</div> : null}{notice ? <div className="status-notice">{notice}</div> : null}</div>;
}
