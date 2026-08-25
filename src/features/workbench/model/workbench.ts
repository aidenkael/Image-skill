'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetRef, AssetRole } from '@/core/assets';
import type {
  CollageTaskOptions,
  HeroTaskOptions,
  OptimizeTaskOptions,
  TaskKind,
  TaskRecord,
} from '@/core/tasks';
import type { TemplateDocument } from '@/core/templates';
import { WorkspaceDraftSchema } from '@/core/workspaces';
import { listAssets, patchAssetRole, uploadAssets } from '@/features/assets/model/api';
import { createTask, listTasks } from '@/features/workbench/model/api';
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
  busy: boolean;
  error: string | null;
  notice: string | null;

  upload(files: File[]): Promise<void>;
  toggleAsset(id: string): void;
  clearSelection(): void;
  setRole(id: string, role: AssetRole): Promise<void>;
  setKind(kind: TaskKind): void;
  patchHeroOptions(patch: Partial<HeroTaskOptions>): void;
  setHeroCount(n: number): void;
  patchCollageOptions(patch: Partial<CollageTaskOptions>): void;
  setCollageCount(n: number): void;
  setCollageVariants(variants: TemplateDocument[]): void;
  setActiveCollageVariant(index: number): void;
  replaceActiveCollageVariant(doc: TemplateDocument): void;
  runHero(): Promise<TaskRecord | null>;
  patchOptimizeOptions(patch: Partial<OptimizeTaskOptions>): void;
  runOptimize(): Promise<TaskRecord | null>;
  createCollageTask(): Promise<TaskRecord | null>;
  setNotice(message: string): void;
  clearStatus(): void;
}

const EMPTY_DRAFT = WorkspaceDraftSchema.parse({});

/** runHero 完成后的状态更新集（字段缺省表示不改动对应状态） */
export interface HeroRunStatePatch {
  tasks: TaskRecord[];
  latestHeroTask: TaskRecord;
  latestHeroTaskId: string;
  error?: string | null;
  notice?: string | null;
}

/**
 * 计算 runHero 完成后的状态更新：
 * - 异步结果已不属于活动工作区（工作区已切换）时返回 null，陈旧结果一律丢弃；
 * - 否则无论任务成功还是失败，该任务都成为当前最新 Hero 任务，
 *   保证 latestHeroTask / latestHeroTaskId（草稿持久化）与错误提示指向同一任务。
 */
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
  if (task.status === 'failed') {
    patch.error = task.error ?? '生成失败';
  } else if (task.status === 'succeeded') {
    patch.notice = `氛围主图生成完成，共 ${task.result?.outputs.length ?? 0} 张`;
  }
  return patch;
}

export function restoreSelectedAssetIds(
  selectedAssetIds: string[],
  assets: AssetRef[],
): string[] {
  const availableIds = new Set(assets.map((asset) => asset.id));
  return selectedAssetIds.filter((id) => availableIds.has(id));
}

export function resolveExecutableSourceAssetId(
  sourceAssetId: string,
  assets: AssetRef[],
): string {
  return assets.some(
    (asset) => asset.id === sourceAssetId && asset.role !== 'reference',
  )
    ? sourceAssetId
    : '';
}

export function sourceIdAfterRoleChange(
  sourceAssetId: string,
  changedAssetId: string,
  role: AssetRole,
): string {
  return role === 'reference' && sourceAssetId === changedAssetId
    ? ''
    : sourceAssetId;
}

export function useWorkbench(workspaceId: string | null): WorkbenchModel {
  const [assets, setAssets] = useState<AssetRef[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [kind, setKindState] = useState<TaskKind>(EMPTY_DRAFT.kind);
  const [heroOptions, setHeroOptionsState] = useState<HeroTaskOptions>(EMPTY_DRAFT.heroOptions);
  const [heroCount, setHeroCountState] = useState(EMPTY_DRAFT.heroCount);
  const [collageOptions, setCollageOptionsState] =
    useState<CollageTaskOptions>(EMPTY_DRAFT.collageOptions);
  const [collageCount, setCollageCountState] = useState(EMPTY_DRAFT.collageCount);
  const [collageVariants, setCollageVariantsState] = useState<TemplateDocument[]>([]);
  const [activeCollageVariant, setActiveCollageVariantState] = useState(0);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [latestHeroTask, setLatestHeroTask] = useState<TaskRecord | null>(null);
  const [latestHeroTaskId, setLatestHeroTaskId] = useState<string | null>(null);
  const [optimizeOptions, setOptimizeOptionsState] = useState<OptimizeTaskOptions>(EMPTY_DRAFT.optimizeOptions);
  const [latestOptimizeTask, setLatestOptimizeTask] = useState<TaskRecord | null>(null);
  const [latestOptimizeTaskId, setLatestOptimizeTaskId] = useState<string | null>(null);
  const [hydratedWorkspaceId, setHydratedWorkspaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const activeWorkspaceRef = useRef<string | null>(workspaceId);
  const hydratedWorkspaceRef = useRef<string | null>(hydratedWorkspaceId);
  activeWorkspaceRef.current = workspaceId;
  hydratedWorkspaceRef.current = hydratedWorkspaceId;

  useEffect(() => {
    const version = ++requestVersionRef.current;
    let ignore = false;

    setAssets([]);
    setSelectedAssetIds([]);
    setKindState(EMPTY_DRAFT.kind);
    setHeroOptionsState(EMPTY_DRAFT.heroOptions);
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
    setHydratedWorkspaceId(null);
    setBusy(false);
    setError(null);
    setNotice(null);

    if (!workspaceId) return () => undefined;

    void Promise.all([
      listAssets(workspaceId),
      listTasks(workspaceId),
      getWorkspaceDraft(workspaceId),
    ])
      .then(([assetList, taskList, draft]) => {
        if (ignore || requestVersionRef.current !== version) return;
        const selectedIds = restoreSelectedAssetIds(draft.selectedAssetIds, assetList);
        const restoredHeroOptions = {
          ...draft.heroOptions,
          sourceAssetId: resolveExecutableSourceAssetId(
            draft.heroOptions.sourceAssetId,
            assetList,
          ),
        };
        const savedHeroTask = draft.latestHeroTaskId
          ? taskList.find(
              (task) => task.id === draft.latestHeroTaskId && task.request.kind === 'hero',
            )
          : null;
        const fallbackHeroTask = taskList.find((task) => task.request.kind === 'hero') ?? null;
        const restoredHeroTask = savedHeroTask ?? fallbackHeroTask;
        const restoredOptimizeOptions = {
          ...draft.optimizeOptions,
          sourceAssetId: resolveExecutableSourceAssetId(
            draft.optimizeOptions.sourceAssetId,
            assetList,
          ),
        };
        const savedOptimizeTask = draft.latestOptimizeTaskId
          ? taskList.find(
              (task) => task.id === draft.latestOptimizeTaskId && task.request.kind === 'optimize',
            )
          : null;
        const fallbackOptimizeTask = taskList.find((task) => task.request.kind === 'optimize') ?? null;
        const restoredOptimizeTask = savedOptimizeTask ?? fallbackOptimizeTask;
        const activeVariant =
          draft.collageVariants.length === 0
            ? 0
            : Math.min(draft.activeCollageVariant, draft.collageVariants.length - 1);

        setAssets(assetList);
        setTasks(taskList);
        setSelectedAssetIds(selectedIds);
        setKindState(draft.kind);
        setHeroOptionsState(restoredHeroOptions);
        setHeroCountState(draft.heroCount);
        setCollageOptionsState(draft.collageOptions);
        setCollageCountState(draft.collageCount);
        setCollageVariantsState(draft.collageVariants);
        setActiveCollageVariantState(activeVariant);
        setLatestHeroTask(restoredHeroTask);
        setLatestHeroTaskId(restoredHeroTask?.id ?? null);
        setOptimizeOptionsState(restoredOptimizeOptions);
        setLatestOptimizeTask(restoredOptimizeTask);
        setLatestOptimizeTaskId(restoredOptimizeTask?.id ?? null);
        setHydratedWorkspaceId(workspaceId);
      })
      .catch((reason: unknown) => {
        if (!ignore && requestVersionRef.current === version) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      ignore = true;
    };
  }, [workspaceId]);

  const hydrated = workspaceId !== null && hydratedWorkspaceId === workspaceId;

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
    const timer = window.setTimeout(() => {
      void saveWorkspaceDraft(workspaceId, draft).catch((reason: unknown) => {
        if (activeWorkspaceRef.current === workspaceId) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    workspaceId,
    hydrated,
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
  ]);

  const upload = useCallback(async (files: File[]) => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (
      !currentWorkspaceId ||
      hydratedWorkspaceRef.current !== currentWorkspaceId ||
      files.length === 0
    ) return;
    setBusy(true);
    setError(null);
    try {
      const created = await uploadAssets(currentWorkspaceId, files);
      if (activeWorkspaceRef.current !== currentWorkspaceId) return;
      setAssets((current) => [...created, ...current]);
      setSelectedAssetIds((current) =>
        [...new Set([...current, ...created.map((asset) => asset.id)])].slice(0, 9),
      );
      setNotice(`已上传 ${created.length} 张图片`);
    } catch (reason) {
      if (activeWorkspaceRef.current === currentWorkspaceId) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (activeWorkspaceRef.current === currentWorkspaceId) setBusy(false);
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

  const setRole = useCallback(async (id: string, role: AssetRole) => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (!currentWorkspaceId || hydratedWorkspaceRef.current !== currentWorkspaceId) return;
    try {
      const updated = await patchAssetRole(currentWorkspaceId, id, role);
      if (activeWorkspaceRef.current !== currentWorkspaceId) return;
      setAssets((current) => current.map((asset) => (asset.id === id ? updated : asset)));
      setHeroOptionsState((current) => ({
        ...current,
        sourceAssetId: sourceIdAfterRoleChange(current.sourceAssetId, id, updated.role),
      }));
      setOptimizeOptionsState((current) => ({
        ...current,
        sourceAssetId: sourceIdAfterRoleChange(current.sourceAssetId, id, updated.role),
      }));
    } catch (reason) {
      if (activeWorkspaceRef.current === currentWorkspaceId) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }, []);

  const setKind = useCallback((nextKind: TaskKind) => {
    setKindState(nextKind);
    setError(null);
    setNotice(null);
  }, []);

  const patchHeroOptions = useCallback((patch: Partial<HeroTaskOptions>) => {
    setHeroOptionsState((current) => ({ ...current, ...patch }));
  }, []);

  const patchCollageOptions = useCallback((patch: Partial<CollageTaskOptions>) => {
    setCollageOptionsState((current) => ({ ...current, ...patch }));
  }, []);

  const patchOptimizeOptions = useCallback((patch: Partial<OptimizeTaskOptions>) => {
    setOptimizeOptionsState((current) => ({ ...current, ...patch }));
  }, []);

  const replaceActiveCollageVariant = useCallback(
    (doc: TemplateDocument) => {
      setCollageVariantsState((current) =>
        current.map((variant, index) => (index === activeCollageVariant ? doc : variant)),
      );
    },
    [activeCollageVariant],
  );

  const runHero = useCallback(async (): Promise<TaskRecord | null> => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (!currentWorkspaceId || hydratedWorkspaceRef.current !== currentWorkspaceId) return null;
    const sourceAssetId = heroOptions.sourceAssetId;
    const sourceAsset = assets.find((asset) => asset.id === sourceAssetId);
    if (!sourceAsset || sourceAsset.role === 'reference') {
      setError('请在右侧明确选择一张源商品图片');
      return null;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const task = await createTask(currentWorkspaceId, {
        kind: 'hero',
        assetIds: [sourceAssetId],
        count: heroCount,
        options: heroOptions,
      });
      const taskList = await listTasks(currentWorkspaceId);
      const patch = heroRunStatePatch(
        activeWorkspaceRef.current,
        currentWorkspaceId,
        task,
        taskList,
      );
      if (!patch) return null;
      setTasks(patch.tasks);
      setLatestHeroTask(patch.latestHeroTask);
      setLatestHeroTaskId(patch.latestHeroTaskId);
      if (patch.error !== undefined) setError(patch.error);
      if (patch.notice !== undefined) setNotice(patch.notice);
      return task;
    } catch (reason) {
      if (activeWorkspaceRef.current === currentWorkspaceId) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      return null;
    } finally {
      if (activeWorkspaceRef.current === currentWorkspaceId) setBusy(false);
    }
  }, [assets, heroCount, heroOptions]);

  const createCollageTask = useCallback(async (): Promise<TaskRecord | null> => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (!currentWorkspaceId || hydratedWorkspaceRef.current !== currentWorkspaceId) return null;
    if (selectedAssetIds.length === 0) {
      setError('请先在左侧选择商品图片');
      return null;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const task = await createTask(currentWorkspaceId, {
        kind: 'collage',
        assetIds: selectedAssetIds,
        count: collageCount,
        options: collageOptions,
      });
      const taskList = await listTasks(currentWorkspaceId);
      if (activeWorkspaceRef.current !== currentWorkspaceId) return null;
      setTasks(taskList);
      if (task.status === 'failed') {
        setError(task.error ?? '布局创建失败');
        return null;
      }
      return task;
    } catch (reason) {
      if (activeWorkspaceRef.current === currentWorkspaceId) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      return null;
    } finally {
      if (activeWorkspaceRef.current === currentWorkspaceId) setBusy(false);
    }
  }, [collageCount, collageOptions, selectedAssetIds]);

  const runOptimize = useCallback(async (): Promise<TaskRecord | null> => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (!currentWorkspaceId || hydratedWorkspaceRef.current !== currentWorkspaceId) return null;
    const sourceAsset = assets.find((asset) => asset.id === optimizeOptions.sourceAssetId);
    if (!sourceAsset || sourceAsset.role === 'reference') {
      setError('请选择一张需要优化的商品图');
      return null;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const task = await createTask(currentWorkspaceId, {
        kind: 'optimize',
        assetIds: [optimizeOptions.sourceAssetId],
        count: 1,
        options: optimizeOptions,
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
      if (activeWorkspaceRef.current === currentWorkspaceId) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      return null;
    } finally {
      if (activeWorkspaceRef.current === currentWorkspaceId) setBusy(false);
    }
  }, [assets, optimizeOptions]);

  const clearStatus = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const setNoticeMessage = useCallback((message: string) => {
    setError(null);
    setNotice(message);
  }, []);

  return {
    assets: hydrated ? assets : [],
    selectedAssetIds: hydrated ? selectedAssetIds : [],
    kind: hydrated ? kind : EMPTY_DRAFT.kind,
    heroOptions: hydrated ? heroOptions : EMPTY_DRAFT.heroOptions,
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
    busy: busy || (workspaceId !== null && !hydrated),
    error,
    notice,
    upload,
    toggleAsset,
    clearSelection,
    setRole,
    setKind,
    patchHeroOptions,
    setHeroCount: setHeroCountState,
    patchCollageOptions,
    setCollageCount: setCollageCountState,
    setCollageVariants: setCollageVariantsState,
    setActiveCollageVariant: setActiveCollageVariantState,
    replaceActiveCollageVariant,
    runHero,
    patchOptimizeOptions,
    runOptimize,
    createCollageTask,
    setNotice: setNoticeMessage,
    clearStatus,
  };
}
