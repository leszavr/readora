import { useEffect, useRef, useState } from "react";
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

/**
 * Как useLocalStorageState, но ключ изолирован по секции: каждая секция
 * (библиотека, подарочные, полка) хранит независимые настройки.
 * Секция "library" использует исходные ключи (обратная совместимость).
 */
export function useSectionLocalStorageState<T>(
  section: string,
  key: string,
  fallback: T,
): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = section === "library" ? `readora.library.${key}` : `readora.${section}.${key}`;
  const [value, setValue] = useState<T>(() => readStoredValue(storageKey, fallback));
  const loadedKeyRef = useRef(storageKey);

  useEffect(() => {
    if (loadedKeyRef.current !== storageKey) {
      // Смена секции: перечитываем сохранённое значение, ничего не пишем.
      loadedKeyRef.current = storageKey;
      setValue(readStoredValue(storageKey, fallback));
      return;
    }
    if (globalThis.localStorage === undefined) return;
    try {
      globalThis.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Ignore quota/private mode errors.
    }
    // fallback намеренно не в зависимостях: используется только при чтении
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, value]);

  return [value, setValue];
}
