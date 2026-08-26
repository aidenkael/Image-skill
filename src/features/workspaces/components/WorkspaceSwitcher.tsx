'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import type { Workspace } from '@/core/workspaces';

interface WorkspaceSwitcherProps {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  creating: boolean;
  deleting: boolean;
  createOpen: boolean;
  error: string | null;
  onCreateOpenChange(open: boolean): void;
  onCreate(name: string): Promise<Workspace | null>;
  onSelect(workspaceId: string): void;
  onDelete(): Promise<boolean>;
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  creating,
  deleting,
  createOpen,
  error,
  onCreateOpenChange,
  onCreate,
  onSelect,
  onDelete,
}: WorkspaceSwitcherProps) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);

  useEffect(() => {
    if (createOpen) inputRef.current?.focus();
  }, [createOpen]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await onCreate(name);
    if (!created) return;
    setName('');
    onCreateOpenChange(false);
  }

  return (
    <div className="workspace-switcher">
      {workspaces.length === 0 ? (
        <span className="workspace-current">尚未选择商品</span>
      ) : null}
      {workspaces.length > 0 ? (
        <select
          className="workspace-select"
          aria-label="选择商品"
          value={activeWorkspaceId ?? ''}
          onChange={(event) => onSelect(event.target.value)}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        className="workspace-create-button"
        onClick={() => onCreateOpenChange(!createOpen)}
      >
        新建商品
      </button>
      {activeWorkspaceId ? (
        deleteConfirming ? (
          <div className="workspace-delete-confirm">
            <span>商品素材、分析、任务和生成结果都会删除，且无法恢复。</span>
            <button
              type="button"
              className="workspace-danger-button"
              disabled={deleting}
              onClick={() => void onDelete().then((deleted) => deleted && setDeleteConfirming(false))}
            >
              {deleting ? '删除中…' : '确认删除'}
            </button>
            <button type="button" className="workspace-confirm-button" onClick={() => setDeleteConfirming(false)}>取消</button>
          </div>
        ) : (
          <button type="button" className="workspace-delete-button" onClick={() => setDeleteConfirming(true)}>删除当前商品</button>
        )
      ) : null}
      {createOpen ? (
        <form className="workspace-create-form" onSubmit={(event) => void submit(event)}>
          <input
            ref={inputRef}
            className="workspace-name-input"
            value={name}
            maxLength={80}
            placeholder="输入商品名称"
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="submit"
            className="workspace-confirm-button"
            disabled={creating || !name.trim()}
          >
            {creating ? '创建中…' : '创建'}
          </button>
          {error ? <span className="workspace-error">{error}</span> : null}
        </form>
      ) : null}
    </div>
  );
}
