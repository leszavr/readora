import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

function readStoredValue<T>(key: string, fallback: T): T {
  if (globalThis.localStorage === undefined) return fallback;

  try {
    const rawValue = globalThis.localStorage.getItem(key);
    if (rawValue == null) return fallback;
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}

export function useLocalStorageState<T>(key: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readStoredValue(key, fallback));

  useEffect(() => {
    if (globalThis.localStorage === undefined) return;
    try {
      globalThis.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore quota/private mode errors.
    }
  }, [key, value]);

  return [value, setValue];
}
