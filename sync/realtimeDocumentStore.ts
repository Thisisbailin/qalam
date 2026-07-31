const DB_NAME = "stylo-realtime-projects";
const STORE_NAME = "documents";
const epochKey = (key: string) => `${key}:epoch`;
const confirmedKey = (key: string) => `${key}:confirmed`;

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

export const deleteRealtimeDocument = async (key: string) => {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.objectStore(STORE_NAME).delete(epochKey(key));
      transaction.objectStore(STORE_NAME).delete(confirmedKey(key));
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
