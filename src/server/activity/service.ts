import {
  getInFlightAnalysisAssetIds,
  getWorkspaceIntelligenceRun,
} from '@/server/intelligence/service';
import { getInFlightHeroAssetIds, listTasks } from '@/server/tasks/service';

export interface PaidActivity {
  running: boolean;
  lockedAssetIds: Set<string>;
}

export async function getPaidActivity(workspaceId: string): Promise<PaidActivity> {
  const [run, tasks] = await Promise.all([
    getWorkspaceIntelligenceRun(workspaceId),
    listTasks(workspaceId),
  ]);
  const lockedAssetIds = new Set<string>();
  for (const id of getInFlightAnalysisAssetIds(workspaceId)) lockedAssetIds.add(id);
  for (const id of getInFlightHeroAssetIds(workspaceId)) lockedAssetIds.add(id);
  if (run?.status === 'running') {
    for (const id of run.assetIds) lockedAssetIds.add(id);
  }
  for (const task of tasks) {
    if (task.request.kind !== 'hero' || task.status !== 'running') continue;
    for (const id of task.request.assetIds) lockedAssetIds.add(id);
  }
  return {
    running:
      getInFlightAnalysisAssetIds(workspaceId).length > 0 ||
      getInFlightHeroAssetIds(workspaceId).length > 0 ||
      run?.status === 'running' || tasks.some(
      (task) => task.request.kind === 'hero' && task.status === 'running',
    ),
    lockedAssetIds,
  };
}
