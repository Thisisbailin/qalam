import {
  parseRealtimeMutationEnvelope,
  type RealtimeMutationEnvelope,
} from "../collaboration/realtimeMutation";

const DB_NAME = "stylo-realtime-projects";
const STORE_NAME = "documents";
const epochKey = (key: string) => `${key}:epoch`;
const confirmedKey = (key: string) => `${key}:confirmed`;
const outboxKey = (key: string) => `${key}:outbox`;
const rejectedKey = (key: string) => `${key}:rejected`;

export type RealtimeStoredOutboxEntry = {
  opId: string;
  update: Uint8Array;
  mutation?: RealtimeMutationEnvelope;
};

export type RealtimeStoredRejectedEntry = RealtimeStoredOutboxEntry & {
  error: string;
  rejectedAt: number;
  epoch: number;
};

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("Unable to open realtime project store"));
});

export const readRealtimeDocument = async (key: string) => {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => {
        const value = request.result;
        resolve(value instanceof ArrayBuffer ? new Uint8Array(value) : null);
      };
      request.onerror = () => reject(request.error || new Error("Unable to read realtime project"));
    });
  } finally {
    database.close();
  }
};

export const writeRealtimeDocument = async (key: string, value: Uint8Array) => {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(
        value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
        key,
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Unable to persist realtime project"));
      transaction.onabort = () => reject(transaction.error || new Error("Realtime project persistence aborted"));
    });
  } finally {
    database.close();
  }
};

export const readRealtimeDocumentEpoch = async (key: string) => {
  if (typeof indexedDB === "undefined") return 0;
  const database = await openDatabase();
  try {
    return await new Promise<number>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(epochKey(key));
      request.onsuccess = () => {
        const value = Number(request.result);
        resolve(Number.isSafeInteger(value) && value >= 0 ? value : 0);
      };
      request.onerror = () => reject(request.error || new Error("Unable to read realtime project epoch"));
    });
  } finally {
    database.close();
  }
};

export const writeRealtimeDocumentEpoch = async (key: string, epoch: number) => {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(epoch, epochKey(key));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Unable to persist realtime project epoch"));
      transaction.onabort = () => reject(transaction.error || new Error("Realtime project epoch persistence aborted"));
    });
  } finally {
    database.close();
  }
};

export const writeRealtimeDocumentState = async (
  key: string,
  value: Uint8Array,
  epoch: number,
  confirmedValue?: Uint8Array,
) => {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.put(
        value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
        key,
      );
      store.put(epoch, epochKey(key));
      if (confirmedValue) {
        store.put(
          confirmedValue.buffer.slice(
            confirmedValue.byteOffset,
            confirmedValue.byteOffset + confirmedValue.byteLength,
          ),
          confirmedKey(key),
        );
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Unable to persist realtime project state"));
      transaction.onabort = () => reject(transaction.error || new Error("Realtime project state persistence aborted"));
    });
  } finally {
    database.close();
  }
};

export const readRealtimeConfirmedDocument = async (key: string) => {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(confirmedKey(key));
      request.onsuccess = () => {
        const value = request.result;
        resolve(value instanceof ArrayBuffer ? new Uint8Array(value) : null);
      };
      request.onerror = () => reject(request.error || new Error("Unable to read confirmed realtime project"));
    });
  } finally {
    database.close();
  }
};

export const readRealtimeDocumentOutbox = async (
  key: string,
): Promise<RealtimeStoredOutboxEntry[]> => {
  if (typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  try {
    return await new Promise<RealtimeStoredOutboxEntry[]>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(outboxKey(key));
      request.onsuccess = () => {
        const value = request.result;
        if (!Array.isArray(value)) {
          resolve([]);
          return;
        }
        resolve(value.flatMap((entry): RealtimeStoredOutboxEntry[] => {
          if (!entry || typeof entry !== "object") return [];
          const candidate = entry as { opId?: unknown; update?: unknown; mutation?: unknown };
          const update = candidate.update instanceof ArrayBuffer
            ? new Uint8Array(candidate.update)
            : candidate.update instanceof Uint8Array
              ? new Uint8Array(candidate.update)
              : null;
          const mutation = candidate.mutation === undefined
            ? null
            : parseRealtimeMutationEnvelope(candidate.mutation);
          return typeof candidate.opId === "string"
            && candidate.opId.length > 0
            && update?.byteLength
            ? [{
                opId: candidate.opId,
                update,
                // Mutation metadata is an optional proof/optimization. A
                // malformed or future-version envelope must degrade to the
                // opaque Yjs path, never make the durable user update vanish.
                ...(mutation?.ok ? { mutation: mutation.value } : {}),
              }]
            : [];
        }));
      };
      request.onerror = () => reject(request.error || new Error("Unable to read realtime project outbox"));
    });
  } finally {
    database.close();
  }
};

export const writeRealtimeDocumentOutbox = async (
  key: string,
  entries: RealtimeStoredOutboxEntry[],
) => {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      if (entries.length === 0) {
        store.delete(outboxKey(key));
      } else {
        store.put(entries.map((entry) => ({
          opId: entry.opId,
          ...(entry.mutation ? { mutation: entry.mutation } : {}),
          update: entry.update.buffer.slice(
            entry.update.byteOffset,
            entry.update.byteOffset + entry.update.byteLength,
          ),
        })), outboxKey(key));
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Unable to persist realtime project outbox"));
      transaction.onabort = () => reject(transaction.error || new Error("Realtime project outbox persistence aborted"));
    });
  } finally {
    database.close();
  }
};

export const readRealtimeRejectedUpdates = async (
  key: string,
): Promise<RealtimeStoredRejectedEntry[]> => {
  if (typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  try {
    return await new Promise<RealtimeStoredRejectedEntry[]>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(rejectedKey(key));
      request.onsuccess = () => {
        const value = request.result;
        if (!Array.isArray(value)) {
          resolve([]);
          return;
        }
        resolve(value.flatMap((entry): RealtimeStoredRejectedEntry[] => {
          if (!entry || typeof entry !== "object") return [];
          const candidate = entry as Record<string, unknown>;
          const update = candidate.update instanceof ArrayBuffer
            ? new Uint8Array(candidate.update)
            : candidate.update instanceof Uint8Array
              ? new Uint8Array(candidate.update)
              : null;
          const rejectedAt = Number(candidate.rejectedAt);
          const epoch = Number(candidate.epoch);
          return typeof candidate.opId === "string"
            && candidate.opId.length > 0
            && typeof candidate.error === "string"
            && update?.byteLength
            && Number.isSafeInteger(rejectedAt)
            && rejectedAt > 0
            && Number.isSafeInteger(epoch)
            && epoch >= 0
            ? [{
                opId: candidate.opId,
                update,
                error: candidate.error,
                rejectedAt,
                epoch,
              }]
            : [];
        }));
      };
      request.onerror = () => reject(request.error || new Error("Unable to read rejected realtime updates"));
    });
  } finally {
    database.close();
  }
};

/**
 * Commits the crash-recovery boundary in one IndexedDB transaction. The local
 * checkpoint, cloud-confirmed checkpoint, epoch fence, and durable outbox must
 * describe the same instant; splitting these writes can resurrect stale state
 * after a process or power failure.
 */
export const writeRealtimeDocumentSessionState = async (
  key: string,
  value: Uint8Array,
  epoch: number,
  confirmedValue: Uint8Array,
  entries: RealtimeStoredOutboxEntry[],
  rejectedEntries: RealtimeStoredRejectedEntry[],
) => {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.put(
        value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
        key,
      );
      store.put(epoch, epochKey(key));
      store.put(
        confirmedValue.buffer.slice(
          confirmedValue.byteOffset,
          confirmedValue.byteOffset + confirmedValue.byteLength,
        ),
        confirmedKey(key),
      );
      if (entries.length === 0) {
        store.delete(outboxKey(key));
      } else {
        store.put(entries.map((entry) => ({
          opId: entry.opId,
          ...(entry.mutation ? { mutation: entry.mutation } : {}),
          update: entry.update.buffer.slice(
            entry.update.byteOffset,
            entry.update.byteOffset + entry.update.byteLength,
          ),
        })), outboxKey(key));
      }
      if (rejectedEntries.length === 0) {
        store.delete(rejectedKey(key));
      } else {
        store.put(rejectedEntries.map((entry) => ({
          opId: entry.opId,
          error: entry.error,
          rejectedAt: entry.rejectedAt,
          epoch: entry.epoch,
          update: entry.update.buffer.slice(
            entry.update.byteOffset,
            entry.update.byteOffset + entry.update.byteLength,
          ),
        })), rejectedKey(key));
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(
        transaction.error || new Error("Unable to persist realtime project session state"),
      );
      transaction.onabort = () => reject(
        transaction.error || new Error("Realtime project session persistence aborted"),
      );
    });
  } finally {
    database.close();
  }
};

export const deleteRealtimeDocument = async (key: string) => {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.objectStore(STORE_NAME).delete(epochKey(key));
      transaction.objectStore(STORE_NAME).delete(confirmedKey(key));
      transaction.objectStore(STORE_NAME).delete(outboxKey(key));
      transaction.objectStore(STORE_NAME).delete(rejectedKey(key));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Unable to clear realtime project"));
    });
  } finally {
    database.close();
  }
};

export const resetRealtimeDocuments = async () => {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Unable to reset realtime project store"));
      transaction.onabort = () => reject(transaction.error || new Error("Realtime project reset aborted"));
    });
  } finally {
    database.close();
  }
};
