'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import type { Workspace } from '@/core/workspaces';

interface WorkspaceSwitcherProps {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  creating: boolean;
  createOpen: boolean;
  error: string | null;
  onCreateOpenChange(open: boolean): void;
  onCreate(name: string): Promise<Workspace | null>;
  onSelect(workspaceId: string): void;
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  creating,
  createOpen,
  error,
  onCreateOpenChange,
  onCreate,
  onSelect,
}: WorkspaceSwitcherProps) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

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
