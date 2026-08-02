import assert from "node:assert/strict";
import { test } from "node:test";
import {
  consumeRealtimeTicket,
  issueRealtimeTicket,
} from "../functions/api/_realtimeTicket";
import { normalizeRealtimeTicketScope } from "../utils/realtimeTicketScope";

type TicketRow = {
  token_hash: string;
  user_id: string;
  scope: string;
  issued_at: number;
  expires_at: number;
  consumed_at: number | null;
};

const createTicketDatabase = () => {
  const rows = new Map<string, TicketRow>();
  const prepare = (sql: string) => {
    const statement = {
      bindings: [] as unknown[],
      bind(...bindings: unknown[]) {
        this.bindings = bindings;
        return this;
      },
      async first<T>() {
        if (!sql.includes("UPDATE realtime_connection_tickets")) return null;
        const [now, tokenHash, scope] = this.bindings as [number, string, string];
        const row = rows.get(tokenHash);
        if (!row || row.scope !== scope || row.consumed_at !== null || row.expires_at < now) return null;
        row.consumed_at = now;
        return { user_id: row.user_id } as T;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        return { meta: { changes: 0 } };
      },
      sql,
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements: Array<ReturnType<typeof prepare>>) {
      for (const statement of statements) {
        if (statement.sql.includes("DELETE FROM realtime_connection_tickets")) {
          const [now, retention] = statement.bindings as [number, number];
          for (const [hash, row] of rows) {
            if (row.expires_at < now || (row.consumed_at !== null && row.consumed_at < retention)) {
              rows.delete(hash);
            }
          }
        }
        if (statement.sql.includes("INSERT INTO realtime_connection_tickets")) {
          const [tokenHash, userId, scope, issuedAt, expiresAt] = statement.bindings;
          rows.set(String(tokenHash), {
            token_hash: String(tokenHash),
            user_id: String(userId),
            scope: String(scope),
            issued_at: Number(issuedAt),
            expires_at: Number(expiresAt),
            consumed_at: null,
          });
        }
      }
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
};

test("realtime ticket scopes are canonical and reject route confusion", () => {
  assert.equal(
    normalizeRealtimeTicketScope("/api/project-realtime?projectId=project-a"),
    "/api/project-realtime?projectId=project-a",
  );
  assert.equal(
    normalizeRealtimeTicketScope("/api/project-realtime?extra=1&projectId=project-a"),
    "",
  );
  assert.equal(
    normalizeRealtimeTicketScope("/api/project-realtime?projectId=a&projectId=b"),
    "",
  );
  assert.equal(normalizeRealtimeTicketScope("/api/account-projects-realtime?projectId=a"), "");
  assert.equal(normalizeRealtimeTicketScope("https://attacker.invalid/api/project-realtime?projectId=a"), "");
});

test("realtime tickets are scoped, opaque, and consumed exactly once", async () => {
  const db = createTicketDatabase();
  const path = "/api/project-realtime?projectId=project-a";
  const issued = await issueRealtimeTicket(db as any, "user-1", path);
  assert.match(issued.ticket, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await consumeRealtimeTicket(
    db as any,
    issued.ticket,
    `https://stylo.test${path}`,
  ), "user-1");
  assert.equal(await consumeRealtimeTicket(db as any, issued.ticket, path), null);

  const other = await issueRealtimeTicket(db as any, "user-1", path);
  assert.equal(await consumeRealtimeTicket(
    db as any,
    other.ticket,
    "/api/account-projects-realtime",
  ), null);
});
