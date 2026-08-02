import { encodeWebSocketCredential } from "../utils/websocketAuth";

export type AccountTokenProvider = (options?: { skipCache?: boolean }) => Promise<string | null>;

export class SyncTransportError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number | null; retryable?: boolean } = {}) {
    super(message);
    this.name = "SyncTransportError";
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

const readResponseError = async (response: Response) => {
  const raw = await response.text().catch(() => "");
  if (!raw) return `HTTP ${response.status}`;
  try {
    const payload = JSON.parse(raw) as { detail?: unknown; error?: unknown };
    const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
    const error = typeof payload.error === "string" ? payload.error.trim() : "";
    if (detail || error) return [error, detail].filter(Boolean).join(": ").slice(0, 500);
  } catch {
    // Infrastructure errors can be HTML or plain text.
  }
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500) || `HTTP ${response.status}`;
};

const combineAbortSignals = (signals: Array<AbortSignal | undefined>) => {
  const activeSignals = Array.from(new Set(
    signals.filter((signal): signal is AbortSignal => Boolean(signal))
  ));
  if (activeSignals.length === 0) return { signal: undefined, cleanup: () => undefined };
  if (activeSignals.length === 1) return { signal: activeSignals[0], cleanup: () => undefined };
  const controller = new AbortController();
  const abort = () => controller.abort();
  activeSignals.forEach((signal) => {
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  return {
    signal: controller.signal,
    cleanup: () => activeSignals.forEach((signal) => signal.removeEventListener("abort", abort)),
  };
};

const awaitWithAbort = <T>(promise: Promise<T>, signal: AbortSignal | undefined) => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Account sync session was disposed", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Account sync session was disposed", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
};

const isRetryableStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

/**
 * One authenticated HTTP boundary for one account scope.
 * Disposing the session invalidates every in-flight request from that account.
 */
export class AccountApiSession {
  private readonly controller = new AbortController();
  private leaseCount = 0;
  private leaseGeneration = 0;

  constructor(
    readonly accountScope: string,
    private readonly getToken: AccountTokenProvider,
    readonly deviceId: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly resolveUrl: (path: string) => string = (path) => path,
    private readonly requestTimeoutMs = 10_000,
  ) {}

  get signal() {
    return this.controller.signal;
  }

  dispose() {
    this.controller.abort();
  }

  /**
   * Keeps a memoized session alive across React StrictMode's synthetic cleanup.
   * The final release disposes in a microtask, giving an immediate remount a
   * chance to acquire a new lease without reusing an aborted session.
   */
  retain() {
    this.signal.throwIfAborted();
    this.leaseCount += 1;
    this.leaseGeneration += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leaseCount = Math.max(0, this.leaseCount - 1);
      const releaseGeneration = ++this.leaseGeneration;
      queueMicrotask(() => {
        if (this.leaseCount === 0 && this.leaseGeneration === releaseGeneration) {
          this.dispose();
        }
      });
    };
  }

  async request(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    this.signal.throwIfAborted();
    const timeoutController = new AbortController();
    const timeout = this.requestTimeoutMs > 0
      ? setTimeout(() => timeoutController.abort(), this.requestTimeoutMs)
      : null;
    const combined = combineAbortSignals([
      this.signal,
      signal,
      init.signal ?? undefined,
      timeoutController.signal,
    ]);
    const requestSignal = combined.signal;
    const callerAborted = () =>
      this.signal.aborted || signal?.aborted === true || init.signal?.aborted === true;

    const execute = async (skipCache: boolean) => {
      try {
        const token = await awaitWithAbort(
          this.getToken(skipCache ? { skipCache: true } : undefined),
          requestSignal
        );
        requestSignal?.throwIfAborted();
        if (!token) {
          throw new SyncTransportError("无法取得当前账户的认证令牌。", { status: 401 });
        }
        const response = await this.fetchImpl.call(
          globalThis,
          this.resolveUrl(path),
          {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init.headers).entries()),
              authorization: `Bearer ${token}`,
              "x-device-id": this.deviceId,
            },
            signal: requestSignal,
          },
        );
        return response;
      } catch (error) {
        if (callerAborted()) {
          throw new DOMException("Account sync session was disposed", "AbortError");
        }
        if (timeoutController.signal.aborted) {
          throw new SyncTransportError(`请求超时（${this.requestTimeoutMs}ms）。`, {
            retryable: true,
          });
        }
        if (error instanceof SyncTransportError) throw error;
        throw new SyncTransportError(
          error instanceof Error ? error.message : "网络请求失败。",
          { retryable: true }
        );
      }
    };

    try {
      let response = await execute(false);
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel().catch(() => undefined);
        response = await execute(true);
      }
      return response;
    } finally {
      if (timeout) clearTimeout(timeout);
      combined.cleanup();
    }
  }

  async openWebSocket(path: string, applicationProtocol: string) {
    this.signal.throwIfAborted();
    const ticketResponse = await this.request("/api/realtime-ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    await requireOkResponse(ticketResponse, "无法取得实时连接票据");
    const payload = await parseJsonResponse<{ ticket?: unknown }>(
      ticketResponse,
      "无法解析实时连接票据",
    );
    const ticket = typeof payload.ticket === "string" ? payload.ticket : "";
    if (!ticket) throw new SyncTransportError("实时连接票据为空。", { status: 502 });
    const resolved = this.resolveUrl(path);
    const base = typeof window !== "undefined" ? window.location.href : "http://localhost/";
    const url = new URL(resolved, base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return new WebSocket(url, [applicationProtocol, encodeWebSocketCredential(ticket)]);
  }
}

export const requireOkResponse = async (response: Response, action: string) => {
  if (response.ok) return response;
  throw new SyncTransportError(`${action}: ${await readResponseError(response)}`, {
    status: response.status,
    retryable: isRetryableStatus(response.status),
  });
};

export const parseJsonResponse = async <T>(response: Response, action: string): Promise<T> => {
  try {
    return await response.json() as T;
  } catch {
    throw new SyncTransportError(`${action}: 服务端返回了无效 JSON。`, {
      status: response.status,
    });
  }
};
