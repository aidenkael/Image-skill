'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AssetRef, AssetRole } from '@/core/assets';
import type {
  CollageTaskOptions,
  HeroTaskOptions,
  TaskKind,
  TaskRecord,
} from '@/core/tasks';
import { listAssets, uploadAssets, patchAssetRole } from '@/features/assets/model/api';
import { listTasks, createTask } from '@/features/workbench/model/api';

/**
 * 工作台前端状态（单页面应用，无 Redux/Zustand）。
 * 任务切换时各自维护 hero/collage 专属选项，互不覆盖。
 */

export interface WorkbenchModel {
  assets: AssetRef[];
  selectedAssetIds: string[];
  kind: TaskKind;
  heroOptions: HeroTaskOptions;
  heroCount: number;
  collageOptions: CollageTaskOptions;
  collageCount: number;
  tasks: TaskRecord[];
  latestHeroTask: TaskRecord | null;
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
  runHero(): Promise<TaskRecord | null>;
  createCollageTask(): Promise<TaskRecord | null>;
  setNotice(message: string): void;
  clearStatus(): void;
}

const DEFAULT_HERO_OPTIONS: HeroTaskOptions = {
  sourceAssetId: '',
  ratio: '1:1',
  person: 'auto',
  sceneMode: 'auto',
};

const DEFAULT_COLLAGE_OPTIONS: CollageTaskOptions = {
  templateId: 'left-hero-right-three',
  includeTitle: true,
  title: '',
  includeSellingPoints: true,
  sellingPoints: ['', '', ''],
};

export function useWorkbench(): WorkbenchModel {
  const [assets, setAssets] = useState<AssetRef[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [kind, setKindState] = useState<TaskKind>('hero');
  const [heroOptions, setHeroOptionsState] = useState<HeroTaskOptions>(DEFAULT_HERO_OPTIONS);
  const [heroCount, setHeroCountState] = useState(1);
  const [collageOptions, setCollageOptionsState] =
    useState<CollageTaskOptions>(DEFAULT_COLLAGE_OPTIONS);
  const [collageCount, setCollageCountState] = useState(1);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [latestHeroTask, setLatestHeroTask] = useState<TaskRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [assetList, taskList] = await Promise.all([listAssets(), listTasks()]);
      setAssets(assetList);
      setTasks(taskList);
      setSelectedAssetIds((prev) =>
        prev.filter((id) => assetList.some((a) => a.id === id)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        const created = await uploadAssets(files);
        setAssets((prev) => [...created, ...prev]);
        setSelectedAssetIds((prev) => [
          ...new Set([...prev, ...created.map((a) => a.id)]),
        ]);
        setNotice(`已上传 ${created.length} 张图片`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const toggleAsset = useCallback((id: string) => {
    setSelectedAssetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const clearSelection = useCallback(() => setSelectedAssetIds([]), []);

  const setRole = useCallback(async (id: string, role: AssetRole) => {
    try {
      const updated = await patchAssetRole(id, role);
      setAssets((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const setKind = useCallback((k: TaskKind) => {
    setKindState(k);
    setError(null);
    setNotice(null);
  }, []);

  const patchHeroOptions = useCallback((patch: Partial<HeroTaskOptions>) => {
    setHeroOptionsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const patchCollageOptions = useCallback((patch: Partial<CollageTaskOptions>) => {
    setCollageOptionsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const runHero = useCallback(async (): Promise<TaskRecord | null> => {
    const sourceAssetId = heroOptions.sourceAssetId;
    if (!sourceAssetId || !assets.some((asset) => asset.id === sourceAssetId)) {
      setError('请在右侧明确选择一张源商品图片');
      return null;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const task = await createTask({
        kind: 'hero',
        assetIds: [sourceAssetId],
        count: heroCount,
        options: heroOptions,
      });
      setLatestHeroTask(task);
      setTasks(await listTasks());
      if (task.status === 'failed') {
        setError(task.error ?? '生成失败');
      } else if (task.status === 'succeeded') {
        const n = task.result?.outputs.length ?? 0;
        setNotice(`氛围主图生成完成，共 ${n} 张`);
      }
      return task;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [assets, heroCount, heroOptions]);

  const createCollageTask = useCallback(async (): Promise<TaskRecord | null> => {
    if (selectedAssetIds.length === 0) {
      setError('请先在左侧选择商品图片');
      return null;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const task = await createTask({
        kind: 'collage',
        assetIds: selectedAssetIds,
        count: collageCount,
        options: collageOptions,
      });
      setTasks(await listTasks());
      if (task.status === 'failed') {
        setError(task.error ?? '布局创建失败');
        return null;
      }
      return task;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [selectedAssetIds, collageCount, collageOptions]);

  const clearStatus = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const setNoticeMessage = useCallback((message: string) => {
    setError(null);
    setNotice(message);
  }, []);

  return {
    assets,
    selectedAssetIds,
    kind,
    heroOptions,
    heroCount,
    collageOptions,
    collageCount,
    tasks,
    latestHeroTask,
    busy,
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
    runHero,
    createCollageTask,
    setNotice: setNoticeMessage,
    clearStatus,
  };
}
