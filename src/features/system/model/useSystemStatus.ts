'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AISettingsStatus } from '@/core/system';
import { getSystemStatus } from './api';

export function useSystemStatus() {
  const [status, setStatus] = useState<AISettingsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await getSystemStatus();
      setStatus(next);
      setError(null);
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { status, error, refresh, setStatus };
}
