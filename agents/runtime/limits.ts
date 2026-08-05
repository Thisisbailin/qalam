export const AGENT_PROTOCOL_VERSION = 2 as const;

export const AGENT_TRANSPORT_LIMITS = {
  requestBytes: 256 * 1024,
  frameBytes: 64 * 1024,
  streamBytes: 8 * 1024 * 1024,
  eventCount: 5_000,
  bufferedTextChars: 512 * 1024,
  idleTimeoutMs: 30_000,
  overallTimeoutMs: 5 * 60_000,
  modelTimeoutMs: 3 * 60_000,
  toolTimeoutMs: 20_000,
  toolResponseBytes: 1024 * 1024,
  serverQueueBytes: 1024 * 1024,
  deltaFlushMs: 50,
} as const;

export const createAbortError = (message: string) => {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
};

export const throwIfAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : createAbortError(String(signal.reason || "Agent operation aborted"));
};

export const withAbortAndTimeout = async <T>(
  operation: Promise<T>,
  options: { signal?: AbortSignal; timeoutMs: number; timeoutMessage: string }
): Promise<T> => {
  const { signal, timeoutMs, timeoutMessage } = options;
  throwIfAborted(signal);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(createAbortError(timeoutMessage)), timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    abortHandler = () => reject(
      signal.reason instanceof Error
        ? signal.reason
        : createAbortError(String(signal.reason || "Agent operation aborted"))
    );
    signal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([operation, timeout, aborted]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
};
