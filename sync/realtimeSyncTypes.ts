import type { SyncStatus } from "../types";

export type SyncStatusDetail = {
  lastSyncAt?: number;
  error?: string;
  pendingOps?: number;
  retryCount?: number;
  lastAttemptAt?: number;
};

export type SyncCodec<T> = {
  snapshot(value: T): T;
  fingerprint(value: T): string;
  byteLength?(value: T): number;
  validate(value: T): string | null;
  isEmpty(value: T): boolean;
  revision?(value: T): number | null;
};

export type RealtimeSyncLease = {
  expectedRevision: number;
  remoteVersion: number;
  release(): void;
};

export type SyncStatusListener = (
  status: SyncStatus,
  detail?: SyncStatusDetail,
) => void;
