// Adapted from voxlibris use-reader-sync-state.ts
// Tracks isSyncing / syncError / lastSyncTime state;
// deduplicates saves by signature within the session.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getReaderProgressSignature,
  type ReaderProgressPayload,
  type ReaderProgressSnapshot,
} from "./reader-progress-core";

interface MutationCallbacks {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

interface UseReaderSyncStateOptions {
  saveProgress: (payload: ReaderProgressPayload, callbacks?: MutationCallbacks) => void;
  errorResetMs?: number;
}

export function useReaderSyncState({
  saveProgress,
  errorResetMs = 3000,
}: UseReaderSyncStateOptions) {
  const LOCAL_SIGNATURE_TTL_MS = 1000 * 60 * 60;
  const LOCAL_SIGNATURE_LIMIT = 100;
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localProgressSignaturesRef = useRef<Map<string, number>>(new Map());

  const pruneLocalProgressSignatures = useCallback((now: number) => {
    for (const [signature, timestamp] of localProgressSignaturesRef.current.entries()) {
      if (now - timestamp > LOCAL_SIGNATURE_TTL_MS) {
        localProgressSignaturesRef.current.delete(signature);
      }
    }

    if (localProgressSignaturesRef.current.size <= LOCAL_SIGNATURE_LIMIT) {
      return;
    }

    const signatures = [...localProgressSignaturesRef.current.entries()]
      .sort((left, right) => left[1] - right[1]);

    while (signatures.length > LOCAL_SIGNATURE_LIMIT) {
      const oldest = signatures.shift();
      if (!oldest) break;
      localProgressSignaturesRef.current.delete(oldest[0]);
    }
  }, [LOCAL_SIGNATURE_LIMIT, LOCAL_SIGNATURE_TTL_MS]);

  const rememberLocalProgress = useCallback((payload: ReaderProgressPayload) => {
    const now = Date.now();
    pruneLocalProgressSignatures(now);
    localProgressSignaturesRef.current.set(getReaderProgressSignature(payload), now);
  }, [pruneLocalProgressSignatures]);

  const isLocalSessionProgress = useCallback((progress: ReaderProgressSnapshot) => {
    const signature = getReaderProgressSignature(progress);
    const timestamp = localProgressSignaturesRef.current.get(signature);
    if (!timestamp) {
      return false;
    }

    const now = Date.now();
    if (now - timestamp > LOCAL_SIGNATURE_TTL_MS) {
      localProgressSignaturesRef.current.delete(signature);
      return false;
    }

    return true;
  }, [LOCAL_SIGNATURE_TTL_MS]);

  const saveWithSync = useCallback((payload: ReaderProgressPayload) => {
    console.log('[ReaderSyncState] Starting sync:', {
      chapterId: payload.currentChapterId,
      progressPercent: payload.progressPercent,
    });
    
    setIsSyncing(true);
    setSyncError(null);
    rememberLocalProgress(payload);

    saveProgress(payload, {
      onSuccess: () => {
        console.log('[ReaderSyncState] Sync successful');
        setIsSyncing(false);
        setLastSyncTime(Date.now());
      },
      onError: (error) => {
        console.error('[ReaderSyncState] Sync failed:', error);
        setIsSyncing(false);
        setSyncError(error instanceof Error ? error.message : "Ошибка сохранения прогресса");
        if (errorTimeoutRef.current) {
          clearTimeout(errorTimeoutRef.current);
        }
        errorTimeoutRef.current = setTimeout(() => setSyncError(null), errorResetMs);
      },
    });
  }, [errorResetMs, rememberLocalProgress, saveProgress]);

  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
    };
  }, []);

  return {
    rememberLocalProgress,
    saveWithSync,
    isLocalSessionProgress,
    isSyncing,
    syncError,
    lastSyncTime,
  };
}
