import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

const DATABASE_NAME = "stylo-agent-state-v2";
const STORE_NAME = "state";
const CHANNEL_NAME = "stylo-agent-state-sync-v2";

type StoredState<T> = { key: string; value: T; updatedAt: number; sourceId: string };

let databasePromise: Promise<IDBDatabase> | null = null;

const openDatabase = () => {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open Agent state database"));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
};

const readState = async <T>(key: string): Promise<StoredState<T> | null> => {
  const database = await openDatabase();
  return await new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as StoredState<T> | undefined) || null);
    request.onerror = () => reject(request.error || new Error("Unable to read Agent state"));
  });
};

const writeState = async <T>(record: StoredState<T>) => {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Unable to write Agent state"));
    transaction.onabort = () => reject(transaction.error || new Error("Agent state write aborted"));
  });
};

type Options<T> = {
  key: string;
  initialValue: T;
  deserializeLegacy?: (value: string) => T;
  debounceMs?: number;
};

export function useAsyncPersistedState<T>({
  key,
  initialValue,
  deserializeLegacy = JSON.parse,
  debounceMs = 600,
}: Options<T>): [T, Dispatch<SetStateAction<T>>] {
  const deserializeLegacyRef = useRef(deserializeLegacy);
  deserializeLegacyRef.current = deserializeLegacy;
  const [state, setState] = useState<T>(initialValue);
  const stateRef = useRef(state);
  stateRef.current = state;
  const initialValueRef = useRef(initialValue);
  initialValueRef.current = initialValue;
  const hydratedRef = useRef(false);
  const suppressedStateRef = useRef<{ value: T } | null>(null);
  const sourceIdRef = useRef(`async-state-${Math.random().toString(36).slice(2)}`);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localMutationVersionRef = useRef(0);
  const setPersistedState = useCallback<Dispatch<SetStateAction<T>>>((value) => {
    localMutationVersionRef.current += 1;
    setState((previous) => {
      const next = typeof value === "function"
        ? (value as (current: T) => T)(previous)
        : value;
      stateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    hydratedRef.current = false;
    const hydrationMutationVersion = localMutationVersionRef.current;
    suppressedStateRef.current = { value: initialValueRef.current };
    setState(initialValueRef.current);
    const hydrate = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (cancelled) return;
      let legacyValue: string | null = null;
      let fallbackValue = initialValueRef.current;
      try {
        legacyValue = localStorage.getItem(key);
        if (legacyValue !== null) fallbackValue = deserializeLegacyRef.current(legacyValue);
      } catch {}
      if (typeof indexedDB === "undefined") {
        hydratedRef.current = true;
        setState(fallbackValue);
        console.warn(`IndexedDB unavailable; ${key} will remain memory-only for this session.`);
        return;
      }
      try {
        const stored = await readState<T>(key);
        if (cancelled) return;
        if (localMutationVersionRef.current !== hydrationMutationVersion) {
          suppressedStateRef.current = null;
          hydratedRef.current = true;
          await writeState({
            key,
            value: stateRef.current,
            updatedAt: Date.now(),
            sourceId: sourceIdRef.current,
          });
          if (legacyValue !== null) {
            try { localStorage.removeItem(key); } catch {}
          }
          return;
        }
        const hydratedValue = stored ? stored.value : fallbackValue;
        suppressedStateRef.current = { value: hydratedValue };
        setState(hydratedValue);
        if (!stored && legacyValue !== null) {
          await writeState({
            key,
            value: fallbackValue,
            updatedAt: Date.now(),
            sourceId: sourceIdRef.current,
          });
          try { localStorage.removeItem(key); } catch {}
        }
      } catch (error) {
        console.warn(`Unable to hydrate asynchronous state ${key}`, error);
      } finally {
        hydratedRef.current = true;
      }
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [key]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<{ key?: string; sourceId?: string }>) => {
      if (event.data?.key !== key || event.data.sourceId === sourceIdRef.current) return;
      void readState<T>(key).then((stored) => {
        if (!stored || stored.sourceId === sourceIdRef.current) return;
        suppressedStateRef.current = { value: stored.value };
        setState(stored.value);
      }).catch(() => undefined);
    };
    return () => channel.close();
  }, [key]);

  useEffect(() => {
    if (!hydratedRef.current || typeof indexedDB === "undefined") return;
    if (suppressedStateRef.current && Object.is(suppressedStateRef.current.value, state)) {
      suppressedStateRef.current = null;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const record: StoredState<T> = {
        key,
        value: stateRef.current,
        updatedAt: Date.now(),
        sourceId: sourceIdRef.current,
      };
      void writeState(record).then(() => {
        if (typeof BroadcastChannel === "undefined") return;
        const channel = new BroadcastChannel(CHANNEL_NAME);
        channel.postMessage({ key, sourceId: sourceIdRef.current });
        channel.close();
      }).catch((error) => console.warn(`Unable to persist asynchronous state ${key}`, error));
    }, debounceMs);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state, key, debounceMs]);

  return [state, setPersistedState];
}
