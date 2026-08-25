'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetRef } from '@/core/assets';
import {
  isIntelligenceFresh,
  type ProductIntelligenceRecord,
} from '@/core/intelligence';
import { analyzeProduct, getProductIntelligence } from './api';

export function useProductIntelligence(workspaceId: string | null, assets: AssetRef[]) {
  const [record, setRecord] = useState<ProductIntelligenceRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(0);
  const activeWorkspaceRef = useRef(workspaceId);
  activeWorkspaceRef.current = workspaceId;

  useEffect(() => {
    const version = ++versionRef.current;
    setRecord(null);
    setError(null);
    setAnalyzing(false);
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void getProductIntelligence(workspaceId)
      .then((next) => {
        if (versionRef.current === version) setRecord(next);
      })
      .catch((reason: unknown) => {
        if (versionRef.current === version) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (versionRef.current === version) setLoading(false);
      });
  }, [workspaceId]);

  const analyze = useCallback(async (assetIds: string[]) => {
    const currentWorkspaceId = activeWorkspaceRef.current;
    if (!currentWorkspaceId) return null;
    setAnalyzing(true);
    setError(null);
    try {
      const next = await analyzeProduct(currentWorkspaceId, assetIds);
      if (activeWorkspaceRef.current !== currentWorkspaceId) return null;
      setRecord(next);
      return next;
    } catch (reason) {
      if (activeWorkspaceRef.current === currentWorkspaceId) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      return null;
    } finally {
      if (activeWorkspaceRef.current === currentWorkspaceId) setAnalyzing(false);
    }
  }, []);

  const fresh = record ? isIntelligenceFresh(record, assets) : false;
  const hasUnanalyzedAssets = useMemo(() => {
    if (!record) return false;
    const analyzed = new Set(record.assetSnapshot.map((item) => item.id));
    return assets.some((asset) => !analyzed.has(asset.id));
  }, [assets, record]);

  return { record, loading, analyzing, error, fresh, hasUnanalyzedAssets, analyze };
}
