'use client';

import type { TaskKind } from '@/core/tasks';
import type { WorkspacesModel } from '@/features/workspaces/model/useWorkspaces';
import { WorkspaceSwitcher } from '@/features/workspaces/components/WorkspaceSwitcher';
import { AIStatusBadge } from '@/features/system/components/AIStatusBadge';

const TASK_TABS: Array<{ kind: Extract<TaskKind, 'hero' | 'collage' | 'optimize'>; label: string }> = [
  { kind: 'hero', label: '氛围主图' },
  { kind: 'collage', label: '组合卖点图' },
  { kind: 'optimize', label: '简单优化' },
];

interface WorkbenchHeaderProps {
  workspaces: WorkspacesModel;
  kind: TaskKind;
  hydrated: boolean;
  createOpen: boolean;
  aiConfigured: boolean | null;
  onCreateOpenChange(open: boolean): void;
  onKindChange(kind: TaskKind): void;
}

export function WorkbenchHeader({
  workspaces,
  kind,
  hydrated,
  createOpen,
  aiConfigured,
  onCreateOpenChange,
  onKindChange,
}: WorkbenchHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-brand">商品视觉工作台</div>
      <WorkspaceSwitcher
        workspaces={workspaces.workspaces}
        activeWorkspaceId={workspaces.activeWorkspaceId}
        creating={workspaces.creating}
        createOpen={createOpen}
        error={workspaces.error}
        onCreateOpenChange={onCreateOpenChange}
        onCreate={workspaces.createWorkspace}
        onSelect={workspaces.selectWorkspace}
      />
      <nav className="task-tabs" aria-label="视觉任务">
        {TASK_TABS.map((tab) => (
          <button key={tab.kind} type="button" className={`tab${kind === tab.kind ? ' is-active' : ''}`} disabled={!workspaces.activeWorkspaceId || !hydrated} onClick={() => onKindChange(tab.kind)}>{tab.label}</button>
        ))}
        <span className="future-tab">详情页图 · 后续</span>
      </nav>
      <AIStatusBadge aiConfigured={aiConfigured} />
    </header>
  );
}
