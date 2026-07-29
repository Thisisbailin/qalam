// Keep authoritative rows comfortably below Cloudflare D1 and Durable Object
// SQLite's 2,000,000-byte row/BLOB limit.
export const REALTIME_UPDATE_MAX_BYTES = 8_000_000;
export const REALTIME_PROJECT_MAX_BYTES = 1_700_000;
