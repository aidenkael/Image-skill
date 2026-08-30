'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetRef, AssetRole } from '@/core/assets';
import type { HeroPlanRecord } from '@/core/hero-workflow';
import type {
  CollageTaskOptions,
  HeroTaskOptions,
  OptimizeTaskOptions,
  TaskKind,
  TaskRecord,
} from '@/core/tasks';
import type { TemplateDocument } from '@/core/templates';
import { WorkspaceDraftSchema, type WorkspaceDraft } from '@/core/workspaces';
import {
  listAssets,
  patchAssetRole,
  removeAsset as removeAssetRequest,
  uploadAssets,
} from '@/features/assets/model/api';
import {
  removeAssetFromCollageDocument,
  sanitizeCollageDocumentAssets,
} from '@/features/collage/model/collage';
import { createHeroPlan, getHeroPlan } from '@/features/hero/model/api';
import { createTask, getTask, listTasks } from '@/features/workbench/model/api';
import { getWorkspaceDraft, saveWorkspaceDraft } from '@/features/workspaces/model/api';

export interface WorkbenchModel {
  assets: AssetRef[];
  selectedAssetIds: string[];
  kind: TaskKind;
  heroOptions: HeroTaskOptions;
  heroCount: number;
  collageOptions: CollageTaskOptions;
  collageCount: number;
  collageVariants: TemplateDocument[];
  activeCollageVariant: number;
  tasks: TaskRecord[];
  latestHeroTask: TaskRecord | null;
  optimizeOptions: OptimizeTaskOptions;
  latestOptimizeTask: TaskRecord | null;
  hydrated: boolean;
  uploading: boolean;
  heroBusy: boolean;
  heroPlan: HeroPlanRecord | null;
  heroPlanLoading: boolean;
  collageBusy: boolean;
  optimizeBusy: boolean;
  assetMutatingIds: Set<string>;
  error: string | null;
  notice: string | null;

  upload(files: File[]): Promise<void>;
  toggleAsset(id: string): void;
  clearSelection(): void;
  setRole(id: string, role: AssetRole): Promise<AssetRef | null>;
  removeAsset(id: string): Promise<boolean>;
  setKind(kind: TaskKind): void;
  patchHeroOptions(patch: Partial<HeroTaskOptions>): void;
  setHeroCount(n: number): void;
  patchCollageOptions(patch: Partial<CollageTaskOptions>): void;
  setCollageCount(n: number): void;
  setCollageVariants(variants: TemplateDocument[]): void;
  setActiveCollageVariant(index: number): void;
  replaceActiveCollageVariant(doc: TemplateDocument): void;
  runHero(): Promise<TaskRecord | null>;
  generateHeroPlan(): Promise<void>;
  patchOptimizeOptions(patch: Partial<OptimizeTaskOptions>): void;
  runOptimize(): Promise<TaskRecord | null>;
  createCollageTask(): Promise<TaskRecord | null>;
  setNotice(message: string): void;
  clearStatus(): void;
}

const EMPTY_DRAFT = WorkspaceDraftSchema.parse({});

function toHeroTaskOptions(draft: { planId?: string | null; [key: string]: unknown }): HeroTaskOptions {
  const { planId, ...rest } = draft;
  return { ...rest, ...(planId ? { planId } : {}) } as HeroTaskOptions;
}

export class OrderedDraftWriter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private latest: WorkspaceDraft | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly save: (draft: WorkspaceDraft) => Promise<unknown>,
    private readonly onError: (error: unknown) => void,
    private readonly delay = 400,
  ) {}

  schedule(draft: WorkspaceDraft): void {
    this.latest = draft;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const draft = this.latest;
    this.latest = null;
    if (!draft) return this.chain;
    this.chain = this.chain
      .catch(() => undefined)
      .then(() => this.save(draft))
      .then(() => undefined)
      .catch((error) => {
        this.onError(error);
      });
    return this.chain;
  }
}

export interface HeroRunStatePatch {
  tasks: TaskRecord[];
  latestHeroTask: TaskRecord;
  latestHeroTaskId: string;
  error?: string | null;
  notice?: string | null;
}

export function heroRunStatePatch(
  activeWorkspaceId: string | null,
  requestWorkspaceId: string,
  task: TaskRecord,
  taskList: TaskRecord[],
): HeroRunStatePatch | null {
  if (activeWorkspaceId !== requestWorkspaceId) return null;
  const patch: HeroRunStatePatch = {
    tasks: taskList,
    latestHeroTask: task,
    latestHeroTaskId: task.id,
  };
  if (task.status === 'failed') patch.error = task.error ?? '生成失败';
  if (task.status === 'succeeded') {
    patch.notice = `氛围主图生成完成，共 ${task.result?.outputs.length ?? 0} 张`;
  }
  return patch;
}

export function restoreSelectedAssetIds(selectedAssetIds: string[], assets: AssetRef[]): string[] {
  const availableIds = new Set(assets.map((asset) => asset.id));
  return selectedAssetIds.filter((id) => availableIds.has(id));
}

export function resolveExecutableSourceAssetId(sourceAssetId: string, assets: AssetRef[]): string {
  return assets.some((asset) => asset.id === sourceAssetId && asset.role !== 'reference')
    ? sourceAssetId
    : '';
}

export function sourceIdAfterRoleChange(
  sourceAssetId: string,
  changedAssetId: string,
  role: AssetRole,
): string {
  return role === 'reference' && sourceAssetId === changedAssetId ? '' : sourceAssetId;
}

export function sanitizeCollageVariants(
  variants: TemplateDocument[],
  assets: AssetRef[],
): TemplateDocument[] {
  return variants.map((doc) => sanitizeCollageDocumentAssets(doc, assets));
}

export function resolveActiveCollageVariant(
  activeIndex: number,
  variants: TemplateDocument[],
): number {
  return variants.length === 0 ? 0 : Math.min(activeIndex, variants.length - 1);
}

export function replaceActiveCollageVariantInList(
  variants: TemplateDocument[],
  activeIndex: number,
  doc: TemplateDocument,
  assets: AssetRef[],
): TemplateDocument[] {
  const sanitized = sanitizeCollageDocumentAssets(doc, assets);
  return variants.map((variant, index) => index === activeIndex ? sanitized : variant);
}

export function removeAssetFromCollageVariants(
  variants: TemplateDocument[],
  assetId: string,
): TemplateDocument[] {
  return variants.map((doc) => removeAssetFromCollageDocument(doc, assetId));
}

export function useWorkbench(workspaceId: string | null): WorkbenchModel {
  const [assets, setAssets] = useState<AssetRef[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [kind, setKindState] = useState<TaskKind>(EMPTY_DRAFT.kind);
  const [heroOptions, setHeroOptionsState] = useState<HeroTaskOptions>(toHeroTaskOptions(EMPTY_DRAFT.heroOptions));
  const [heroCount, setHeroCountState] = useState(EMPTY_DRAFT.heroCount);
  const [collageOptions, setCollageOptionsState] = useState<CollageTaskOptions>(EMPTY_DRAFT.collageOptions);
  const [collageCount, setCollageCountState] = useState(EMPTY_DRAFT.collageCount);
  const [collageVariants, setCollageVariantsState] = useState<TemplateDocument[]>([]);
  const [activeCollageVariant, setActiveCollageVariantState] = useState(0);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [latestHeroTask, setLatestHeroTask] = useState<TaskRecord | null>(null);
  const [latestHeroTaskId, setLatestHeroTaskId] = useState<string | null>(null);
  const [optimizeOptions, setOptimizeOptionsState] = useState<OptimizeTaskOptions>(EMPTY_DRAFT.optimizeOptions);
  const [latestOptimizeTask, setLatestOptimizeTask] = useState<TaskRecord | null>(null);
  const [latestOptimizeTaskId, setLatestOptimizeTaskId] = useState<string | null>(null);
  const [heroPlan, setHeroPlan] = useState<HeroPlanRecord | null>(null);
  const [heroPlanLoading, setHeroPlanLoading] = useState(false);
  const [hydratedWorkspaceId, setHydratedWorkspaceId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [heroSubmitting, setHeroSubmitting] = useState(false);
  const [collageBusy, setCollageBusy] = useState(false);
  const [optimizeBusy, setOptimizeBusy] = useState(false);
  const [assetMutatingIds, setAssetMutatingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const activeWorkspaceRef = useRef<string | null>(workspaceId);
  const hydratedWorkspaceRef = useRef<string | null>(hydratedWorkspaceId);
  const assetsRef = useRef<AssetRef[]>(assets);
  const activeCollageVariantRef = useRef(activeCollageVariant);
  const heroSubmitGuardsRef = useRef(new Set<string>());
  const draftWritersRef = useRef(new Map<string, OrderedDraftWriter>());
  activeWorkspaceRef.current = workspaceId;
  hydratedWorkspaceRef.current = hydratedWorkspaceId;
  assetsRef.current = assets;
  activeCollageVariantRef.current = activeCollageVariant;

  useEffect(() => {
    const version = ++requestVersionRef.current;
    let ignore = false;
    setAssets([]);
    setSelectedAssetIds([]);
    setKindState(EMPTY_DRAFT.kind);
    setHeroOptionsState(toHeroTaskOptions(EMPTY_DRAFT.heroOptions));
    setHeroCountState(EMPTY_DRAFT.heroCount);
    setCollageOptionsState(EMPTY_DRAFT.collageOptions);
    setCollageCountState(EMPTY_DRAFT.collageCount);
    setCollageVariantsState([]);
    setActiveCollageVariantState(0);
    setTasks([]);
    setLatestHeroTask(null);
    setLatestHeroTaskId(null);
    setOptimizeOptionsState(EMPTY_DRAFT.optimizeOptions);
    setLatestOptimizeTask(null);
    setLatestOptimizeTaskId(null);
    setHeroPlan(null);
    setHeroPlanLoading(false);
    setHydratedWorkspaceId(null);
    setUploading(false);
    setHeroSubmitting(false);
    setCollageBusy(false);
    setOptimizeBusy(false);
    setAssetMutatingIds(new Set());
    setError(null);
    setNotice(null);

    if (!workspaceId) return () => undefined;
    void Promise.all([
      listAssets(workspaceId),
      listTasks(workspaceId),
      getWorkspaceDraft(workspaceId),
      getHeroPlan(workspaceId),
    ])
      .then(([assetList, taskList, draft, plan]) => {
        if (ignore || requestVersionRef.current !== version) return;
        const restoredHeroOptions = toHeroTaskOptions({
          ...draft.heroOptions,
          sourceAssetId: resolveExecutableSourceAssetId(draft.heroOptions.sourceAssetId, assetList),
        });
        const savedHeroTask = draft.latestHeroTaskId
          ? taskList.find((task) => task.id === draft.latestHeroTaskId && task.request.kind === 'hero')
          : null;
        const restoredHeroTask = savedHeroTask ?? taskList.find((task) => task.request.kind === 'hero') ?? null;
        const restoredOptimizeOptions = {
          ...draft.optimizeOptions,
          sourceAssetId: resolveExecutableSourceAssetId(draft.optimizeOptions.sourceAssetId, assetList),
        };
        const savedOptimizeTask = draft.latestOptimizeTaskId
          ? taskList.find((task) => task.id === draft.latestOptimizeTaskId && task.request.kind === 'optimize')
          : null;
        const restoredOptimizeTask = savedOptimizeTask ?? taskList.find((task) => task.request.kind === 'optimize') ?? null;
        const restoredVariants = sanitizeCollageVariants(draft.collageVariants, assetList);

        assetsRef.current = assetList;
        setAssets(assetList);
        setTasks(taskList);
        setSelectedAssetIds(restoreSelectedAssetIds(draft.selectedAssetIds, assetList));
        setKindState(draft.kind);
        setHeroOptionsState(restoredHeroOptions);
        setHeroCountState(draft.heroCount);
        setCollageOptionsState(draft.collageOptions);
        setCollageCountState(draft.collageCount);
        setCollageVariantsState(restoredVariants);
        setActiveCollageVariantState(resolveActiveCollageVariant(draft.activeCollageVariant, restoredVariants));
        setLatestHeroTask(restoredHeroTask);
        setLatestHeroTaskId(restoredHeroTask?.id ?? null);
        setOptimizeOptionsState(restoredOptimizeOptions);
        setLatestOptimizeTask(restoredOptimizeTask);
        setLatestOptimizeTaskId(restoredOptimizeTask?.id ?? null);
        setHeroPlan(plan);
        setHydratedWorkspaceId(workspaceId);
      })
      .catch((reason: unknown) => {
        if (!ignore && requestVersionRef.current === version) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => { ignore = true; };
  }, [workspaceId]);

  const hydrated = workspaceId !== null && hydratedWorkspaceId === workspaceId;
  const heroBusy = heroSubmitting || latestHeroTask?.status === 'running';

  useEffect(() => {
    if (!workspaceId) return;
    return () => { void draftWritersRef.current.get(workspaceId)?.flush(); };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !hydrated) return;
    const draft = WorkspaceDraftSchema.parse({
      kind,
      selectedAssetIds,
      heroOptions,
      heroCount,
      collageOptions,
      collageCount,
      collageVariants,
      activeCollageVariant,
      latestHeroTaskId,
      optimizeOptions,
      latestOptimizeTaskId,
    });
    let writer = draftWritersRef.current.get(workspaceId);
    if (!writer) {
      writer = new OrderedDraftWriter(
        (next) => saveWorkspaceDraft(workspaceId, next),
        (reason) => {
          if (activeWorkspaceRef.current === workspaceId) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        },
      );
      draftWritersRef.current.set(workspaceId, writer);
    }
    writer.schedule(draft);
  }, [
    workspaceId, hydrated, kind, selectedAssetIds, heroOptions, heroCount,
    collageOptions, collageCount, collageVariants, activeCollageVariant,
    latestHeroTaskId, optimizeOptions, latestOptimizeTaskId,
  ]);

  useEffect(() => {
    if (!workspaceId || !hydrated || latestHeroTask?.status !== 'running') return;
    const taskId = latestHeroTask.id;
    const version = requestVersionRef.current;
    const timer = window.setInterval(() => {
      void getTask(workspaceId, taskId).then((task) => {
        if (
          requestVersionRef.current !== version ||
          activeWorkspaceRef.current !== workspaceId
        ) return;
        setLatestHeroTask(task);
        setLatestHeroTaskId(task.id);
        setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
        if (task.status === 'failed') setError(task.error ?? '生成失败');
        if (task.status === 'succeeded') {
          setNotice(`氛围主图生成完成，共 ${task.result?.outputs.length ?? 0} 张`);
        }
      }).catch((reason: unknown) => {
        if (activeWorkspaceRef.current === workspaceId) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [hydrated, latestHeroTask?.id, latestHeroTask?.status, workspaceId]);

  const upload = useCallback(async (files: File[]) => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (!currentWorkspaceId || hydratedWorkspaceRef.current !== currentWorkspaceId || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadAssets(currentWorkspaceId, files);
      if (activeWorkspaceRef.current !== currentWorkspaceId) return;
      assetsRef.current = result.assets;
      setAssets(result.assets);
      setSelectedAssetIds((current) =>
        [...new Set([...current, ...result.createdIds])].slice(0, 9),
      );
      setNotice(`已上传 ${result.createdIds.length} 张图片`);
    } catch (reason) {
      if (activeWorkspaceRef.current === currentWorkspaceId) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (activeWorkspaceRef.current === currentWorkspaceId) setUploading(false);
    }
  }, []);

  const toggleAsset = useCallback((id: string) => {
    setSelectedAssetIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 9) {
        setError('单个商品最多选择 9 张图片');
        return current;
      }
      return [...current, id];
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedAssetIds([]), []);

  const markAssetMutation = useCallback((id: string, active: boolean) => {
    setAssetMutatingIds((current) => {
      const next = new Set(current);
      if (active) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const setRole = useCallback(async (id: string, role: AssetRole): Promise<AssetRef | null> => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (!currentWorkspaceId || hydratedWorkspaceRef.current !== currentWorkspaceId) return null;
    markAssetMutation(id, true);
    try {
      const nextAssets = await patchAssetRole(currentWorkspaceId, id, role);
      if (activeWorkspaceRef.current !== currentWorkspaceId) return null;
      assetsRef.current = nextAssets;
      setAssets(nextAssets);
      const updated = nextAssets.find((asset) => asset.id === id) ?? null;
      if (!updated) return null;
      setHeroOptionsState((current) => ({
        ...current,
        sourceAssetId: sourceIdAfterRoleChange(current.sourceAssetId, id, updated.role),
      }));
      setOptimizeOptionsState((current) => ({
        ...current,
        sourceAssetId: sourceIdAfterRoleChange(current.sourceAssetId, id, updated.role),
      }));
      setCollageVariantsState((current) => sanitizeCollageVariants(current, nextAssets));
      return updated;
    } catch (reason) {
      if (activeWorkspaceRef.current === currentWorkspaceId) setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      markAssetMutation(id, false);
    }
  }, [markAssetMutation]);

  const removeAsset = useCallback(async (id: string): Promise<boolean> => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (!currentWorkspaceId || hydratedWorkspaceRef.current !== currentWorkspaceId) return false;
    markAssetMutation(id, true);
    setError(null);
    try {
      const nextAssets = await removeAssetRequest(currentWorkspaceId, id);
      if (activeWorkspaceRef.current !== currentWorkspaceId) return false;
      assetsRef.current = nextAssets;
      setAssets(nextAssets);
      setSelectedAssetIds((current) => current.filter((item) => item !== id));
      setHeroOptionsState((current) => ({
        ...current,
        sourceAssetId: current.sourceAssetId === id ? '' : current.sourceAssetId,
      }));
      setOptimizeOptionsState((current) => ({
        ...current,
        sourceAssetId: current.sourceAssetId === id ? '' : current.sourceAssetId,
      }));
      setCollageVariantsState((current) =>
        sanitizeCollageVariants(removeAssetFromCollageVariants(current, id), nextAssets),
      );
      setNotice('图片已移除');
      return true;
    } catch (reason) {
      if (activeWorkspaceRef.current === currentWorkspaceId) setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      markAssetMutation(id, false);
    }
  }, [markAssetMutation]);

  const setKind = useCallback((nextKind: TaskKind) => {
    setKindState(nextKind);
    setError(null);
    setNotice(null);
  }, []);
  const patchHeroOptions = useCallback((patch: Partial<HeroTaskOptions>) => setHeroOptionsState((current) => ({ ...current, ...patch })), []);
  const patchCollageOptions = useCallback((patch: Partial<CollageTaskOptions>) => setCollageOptionsState((current) => ({ ...current, ...patch })), []);
  const patchOptimizeOptions = useCallback((patch: Partial<OptimizeTaskOptions>) => setOptimizeOptionsState((current) => ({ ...current, ...patch })), []);
  const setCollageVariants = useCallback((variants: TemplateDocument[]) => setCollageVariantsState(sanitizeCollageVariants(variants, assetsRef.current)), []);
  const replaceActiveCollageVariant = useCallback((doc: TemplateDocument) => {
    setCollageVariantsState((current) => replaceActiveCollageVariantInList(current, activeCollageVariantRef.current, doc, assetsRef.current));
  }, []);

  const generateHeroPlan = useCallback(async () => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (!currentWorkspaceId || hydratedWorkspaceRef.current !== currentWorkspaceId) return;
    const sourceAsset = assetsRef.current.find((asset) => asset.id === heroOptions.sourceAssetId);
    if (!sourceAsset || sourceAsset.role === 'reference') {
      setError('请先选择一张源商品图片');
      return;
    }
    setHeroPlanLoading(true);
    setError(null);
    setNotice(null);
    try {
      const record = await createHeroPlan(currentWorkspaceId, {
        sourceAssetId: sourceAsset.id,
        ratio: heroOptions.ratio,
        creativeMode: heroOptions.creativeMode,
        creativeIntent: heroOptions.creativeMode === 'custom' ? heroOptions.creativeIntent?.trim() : undefined,
        humanPresence: heroOptions.humanPresence,
        creativeLevel: heroOptions.creativeLevel,
      });
      if (activeWorkspaceRef.current !== currentWorkspaceId) return;
      setHeroPlan(record);
      setHeroOptionsState((current) => ({ ...current, planId: record.id }));
    } catch (reason) {
      if (activeWorkspaceRef.current === currentWorkspaceId) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (activeWorkspaceRef.current === currentWorkspaceId) setHeroPlanLoading(false);
    }
  }, [heroOptions]);

  const runHero = useCallback(async (): Promise<TaskRecord | null> => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (!currentWorkspaceId || hydratedWorkspaceRef.current !== currentWorkspaceId) return null;
    if (heroSubmitGuardsRef.current.has(currentWorkspaceId)) return null;
    const sourceAsset = assets.find((asset) => asset.id === heroOptions.sourceAssetId);
    if (!sourceAsset || sourceAsset.role === 'reference') {
      setError('请在右侧明确选择一张源商品图片');
      return null;
    }
    heroSubmitGuardsRef.current.add(currentWorkspaceId);
    setHeroSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const { planId, ...restOptions } = heroOptions;
      const task = await createTask(currentWorkspaceId, {
        kind: 'hero',
        assetIds: [sourceAsset.id],
        count: heroCount,
        options: { ...restOptions, ...(planId ? { planId } : {}) },
      });
      const taskList = await listTasks(currentWorkspaceId);
      const patch = heroRunStatePatch(activeWorkspaceRef.current, currentWorkspaceId, task, taskList);
      if (!patch) return null;
      setTasks(patch.tasks);
      setLatestHeroTask(patch.latestHeroTask);
      setLatestHeroTaskId(patch.latestHeroTaskId);
      if (patch.error !== undefined) setError(patch.error);
      if (patch.notice !== undefined) setNotice(patch.notice);
      return task;
    } catch (reason) {
      if (activeWorkspaceRef.current === currentWorkspaceId) setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      heroSubmitGuardsRef.current.delete(currentWorkspaceId);
      if (activeWorkspaceRef.current === currentWorkspaceId) setHeroSubmitting(false);
    }
  }, [assets, heroCount, heroOptions]);

  const createCollageTask = useCallback(async (): Promise<TaskRecord | null> => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (!currentWorkspaceId || hydratedWorkspaceRef.current !== currentWorkspaceId) return null;
    if (selectedAssetIds.length === 0) { setError('请先在左侧选择商品图片'); return null; }
    setCollageBusy(true);
    setError(null);
    setNotice(null);
    try {
      const task = await createTask(currentWorkspaceId, {
        kind: 'collage', assetIds: selectedAssetIds, count: collageCount, options: collageOptions,
      });
      const taskList = await listTasks(currentWorkspaceId);
      if (activeWorkspaceRef.current !== currentWorkspaceId) return null;
      setTasks(taskList);
      if (task.status === 'failed') { setError(task.error ?? '布局创建失败'); return null; }
      return task;
    } catch (reason) {
      if (activeWorkspaceRef.current === currentWorkspaceId) setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      if (activeWorkspaceRef.current === currentWorkspaceId) setCollageBusy(false);
    }
  }, [collageCount, collageOptions, selectedAssetIds]);

  const runOptimize = useCallback(async (): Promise<TaskRecord | null> => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (!currentWorkspaceId || hydratedWorkspaceRef.current !== currentWorkspaceId) return null;
    const sourceAsset = assets.find((asset) => asset.id === optimizeOptions.sourceAssetId);
    if (!sourceAsset || sourceAsset.role === 'reference') { setError('请选择一张需要优化的商品图'); return null; }
    setOptimizeBusy(true);
    setError(null);
    setNotice(null);
    try {
      const task = await createTask(currentWorkspaceId, {
        kind: 'optimize', assetIds: [sourceAsset.id], count: 1, options: optimizeOptions,
      });
      const taskList = await listTasks(currentWorkspaceId);
      if (activeWorkspaceRef.current !== currentWorkspaceId) return null;
      setTasks(taskList);
      setLatestOptimizeTask(task);
      setLatestOptimizeTaskId(task.id);
      if (task.status === 'failed') setError(task.error ?? '图片优化失败');
      else setNotice('图片优化完成，可在中间区域下载');
      return task;
    } catch (reason) {
      if (activeWorkspaceRef.current === currentWorkspaceId) setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      if (activeWorkspaceRef.current === currentWorkspaceId) setOptimizeBusy(false);
    }
  }, [assets, optimizeOptions]);

  return {
    assets: hydrated ? assets : [],
    selectedAssetIds: hydrated ? selectedAssetIds : [],
    kind: hydrated ? kind : EMPTY_DRAFT.kind,
    heroOptions: hydrated ? heroOptions : toHeroTaskOptions(EMPTY_DRAFT.heroOptions),
    heroCount: hydrated ? heroCount : EMPTY_DRAFT.heroCount,
    collageOptions: hydrated ? collageOptions : EMPTY_DRAFT.collageOptions,
    collageCount: hydrated ? collageCount : EMPTY_DRAFT.collageCount,
    collageVariants: hydrated ? collageVariants : [],
    activeCollageVariant: hydrated ? activeCollageVariant : 0,
    tasks: hydrated ? tasks : [],
    latestHeroTask: hydrated ? latestHeroTask : null,
    optimizeOptions: hydrated ? optimizeOptions : EMPTY_DRAFT.optimizeOptions,
    latestOptimizeTask: hydrated ? latestOptimizeTask : null,
    hydrated,
    uploading: uploading || (workspaceId !== null && !hydrated),
    heroBusy,
    heroPlan: hydrated ? heroPlan : null,
    heroPlanLoading,
    collageBusy,
    optimizeBusy,
    assetMutatingIds,
    error,
    notice,
    upload,
    toggleAsset,
    clearSelection,
    setRole,
    removeAsset,
    setKind,
    patchHeroOptions,
    setHeroCount: setHeroCountState,
    patchCollageOptions,
    setCollageCount: setCollageCountState,
    setCollageVariants,
    setActiveCollageVariant: setActiveCollageVariantState,
    replaceActiveCollageVariant,
    runHero,
    generateHeroPlan,
    patchOptimizeOptions,
    runOptimize,
    createCollageTask,
    setNotice: (message) => { setError(null); setNotice(message); },
    clearStatus: () => { setError(null); setNotice(null); },
  };
}
