'use client';

import { useEffect, useState } from 'react';
import { getSystemStatus } from './api';

export function useSystemStatus() {
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    let ignore = false;
    void getSystemStatus()
      .then((status) => {
        if (!ignore) setAiConfigured(status.aiConfigured);
      })
      .catch(() => {
        if (!ignore) setAiConfigured(false);
      });
    return () => {
      ignore = true;
    };
  }, []);
  return { aiConfigured };
}
