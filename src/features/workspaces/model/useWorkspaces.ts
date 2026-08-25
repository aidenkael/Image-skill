'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Workspace } from '@/core/workspaces';
import { createWorkspace as createWorkspaceRequest, listWorkspaces } from './api';

const ACTIVE_WORKSPACE_KEY = 'image-skill.active-workspace';

export interface WorkspacesModel {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  loading: boolean;
  creating: boolean;
  error: string | null;
  createWorkspace(name: string): Promise<Workspace | null>;
  selectWorkspace(workspaceId: string): void;
}

export function useWorkspaces(): WorkspacesModel {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    void listWorkspaces()
      .then((items) => {
        if (ignore) return;
        setWorkspaces(items);
        const stored = window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
        const nextId =
          stored && items.some((workspace) => workspace.id === stored)
            ? stored
            : (items[0]?.id ?? null);
        setActiveWorkspaceId(nextId);
        if (nextId) {
          window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, nextId);
        } else {
          window.localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const createWorkspace = useCallback(async (name: string): Promise<Workspace | null> => {
    setCreating(true);
    setError(null);
    try {
      const created = await createWorkspaceRequest(name);
      setWorkspaces((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setActiveWorkspaceId(created.id);
      window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, created.id);
      return created;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setCreating(false);
    }
  }, []);

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      if (!workspaces.some((workspace) => workspace.id === workspaceId)) return;
      setActiveWorkspaceId(workspaceId);
      window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
      setError(null);
    },
    [workspaces],
  );

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );

  return {
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    loading,
    creating,
    error,
    createWorkspace,
    selectWorkspace,
  };
}
