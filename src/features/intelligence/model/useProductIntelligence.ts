'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetRef } from '@/core/assets';
import {
  isIntelligenceFresh,
  type ProductIntelligenceRecord,
  type ProductIntelligenceRun,
} from '@/core/intelligence';
import {
  analyzeProduct,
  getProductIntelligence,
  type ProductIntelligenceSnapshot,
} from './api';

export function useProductIntelligence(workspaceId: string | null, assets: AssetRef[]) {
  const [record, setRecord] = useState<ProductIntelligenceRecord | null>(null);
  const [run, setRun] = useState<ProductIntelligenceRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedAssetIds, setSubmittedAssetIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(0);
  const activeWorkspaceRef = useRef(workspaceId);
  activeWorkspaceRef.current = workspaceId;

  const applySnapshot = useCallback((snapshot: ProductIntelligenceSnapshot) => {
    setRecord(snapshot.intelligence);
    setRun(snapshot.run);
    setError(snapshot.run?.status === 'failed' ? (snapshot.run.error ?? '商品分析失败') : null);
    setSubmittedAssetIds(snapshot.run?.status === 'running' ? snapshot.run.assetIds : []);
  }, []);

  useEffect(() => {
    const version = ++versionRef.current;
    setRecord(null);
    setRun(null);
    setError(null);
    setSubmitting(false);
    setSubmittedAssetIds([]);
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void getProductIntelligence(workspaceId)
      .then((snapshot) => {
        if (versionRef.current === version) applySnapshot(snapshot);
      })
      .catch((reason: unknown) => {
        if (versionRef.current === version) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (versionRef.current === version) setLoading(false);
      });
  }, [applySnapshot, workspaceId]);

  useEffect(() => {
    if (!workspaceId || run?.status !== 'running') return;
    const version = versionRef.current;
    const timer = window.setInterval(() => {
      void getProductIntelligence(workspaceId)
        .then((snapshot) => {
          if (
            versionRef.current === version &&
            activeWorkspaceRef.current === workspaceId
          ) {
            applySnapshot(snapshot);
          }
        })
        .catch((reason: unknown) => {
          if (
            versionRef.current === version &&
            activeWorkspaceRef.current === workspaceId
          ) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        });
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [applySnapshot, run?.status, workspaceId]);

  const analyze = useCallback(async (assetIds: string[]) => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (!currentWorkspaceId || submitting || run?.status === 'running') return null;
    setSubmitting(true);
    setSubmittedAssetIds(assetIds);
    setError(null);
    try {
      const snapshot = await analyzeProduct(currentWorkspaceId, assetIds);
      if (activeWorkspaceRef.current !== currentWorkspaceId) return null;
      applySnapshot(snapshot);
      return snapshot.intelligence;
    } catch (reason) {
      if (activeWorkspaceRef.current === currentWorkspaceId) {
        setError(reason instanceof Error ? reason.message : String(reason));
        void getProductIntelligence(currentWorkspaceId).then(applySnapshot).catch(() => undefined);
      }
      return null;
    } finally {
      if (activeWorkspaceRef.current === currentWorkspaceId) setSubmitting(false);
    }
  }, [applySnapshot, run?.status, submitting]);

  const fresh = record ? isIntelligenceFresh(record, assets) : false;
  const hasUnanalyzedAssets = useMemo(() => {
    if (!record) return false;
    const analyzed = new Set(record.assetSnapshot.map((item) => item.id));
    return assets.some((asset) => !analyzed.has(asset.id));
  }, [assets, record]);

  return {
    record,
    run,
    loading,
    analyzing: submitting || run?.status === 'running',
    lockedAssetIds: submittedAssetIds,
    error,
    fresh,
    hasUnanalyzedAssets,
    analyze,
  };
}
