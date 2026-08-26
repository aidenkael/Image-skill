'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AIConnectionCapability,
  AIProfileInput,
  AISettingsPublic,
  ActiveAIProfilesInput,
} from '@/core/system';
import {
  createAIProfile,
  deleteAIProfile,
  getAISettings,
  setActiveAIProfiles,
  testAIProfile,
  updateAIProfile,
} from './api';

export function useAISettings() {
  const [settings, setSettings] = useState<AISettingsPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const apply = useCallback(async (request: Promise<AISettingsPublic>) => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const next = await request;
      if (version === requestVersion.current) {
        setSettings(next);
        setError(null);
      }
      return next;
    } catch (reason) {
      if (version === requestVersion.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      throw reason;
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => apply(getAISettings()), [apply]);
  const createProfile = useCallback((input: AIProfileInput) => apply(createAIProfile(input)), [apply]);
  const updateProfile = useCallback((id: string, input: AIProfileInput) => apply(updateAIProfile(id, input)), [apply]);
  const deleteProfile = useCallback((id: string) => apply(deleteAIProfile(id)), [apply]);
  const setActiveProfiles = useCallback((input: ActiveAIProfilesInput) => apply(setActiveAIProfiles(input)), [apply]);
  const testProfile = useCallback((id: string, capability: AIConnectionCapability) => testAIProfile(id, capability), []);

  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);
  return {
    settings, loading, error, refresh, createProfile, updateProfile, deleteProfile,
    setActiveProfiles, testProfile,
  };
}

export const useSystemStatus = useAISettings;
