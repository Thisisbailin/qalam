import OpenAI from "openai";
import { RequestUsage, type AgentInputItem, type OpenAIResponsesCompactionArgs, type OpenAIResponsesCompactionAwareSession, type OpenAIResponsesCompactionResult, type Session } from "@openai/agents";
import { getUserId } from "./_auth";
import type { AgentSessionMessage } from "../../agents/runtime/types";
import { repairSessionToolTransactions, trimSessionItemsSafely } from "../../agents/runtime/sessionRepair";
import {
  AGENT_SESSION_LIMITS,
  compactAgentSessionItems,
  normalizeAgentSessionMessage,
  projectAgentItemsToSessionMessages,
  summarizeSessionToolOutput,
} from "../../agents/runtime/sessionProjection";

export type EnvWithDb = {
  DB: any;
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
};

type PersistedAgentSessionRecord = {
  items: AgentInputItem[];
  messages: AgentSessionMessage[];
  updatedAt: number;
};

const STORED_SESSION_ITEM_LIMIT = AGENT_SESSION_LIMITS.storedItems;
const STORED_SESSION_MESSAGE_LIMIT = AGENT_SESSION_LIMITS.storedMessages;

const cloneItem = <T,>(value: T): T => structuredClone(value);

const trimSessionItems = (items: AgentInputItem[], limit?: number) => {
  return trimSessionItemsSafely(items, limit);
};

const clipText = (value: string, limit: number) => {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...`;
};

const normalizeRecord = (row: any): PersistedAgentSessionRecord => {
  let items: AgentInputItem[] = [];
  let messages: AgentSessionMessage[] = [];
  try {
    const parsedItems = JSON.parse(String(row?.items || "[]"));
    if (Array.isArray(parsedItems)) {
      items = compactAgentSessionItems(
        parsedItems.filter((item) => item && typeof item === "object") as AgentInputItem[],
        { maxItems: STORED_SESSION_ITEM_LIMIT }
      );
    }
  } catch {}
  try {
    const parsedMessages = JSON.parse(String(row?.messages || "[]"));
    if (Array.isArray(parsedMessages)) {
      messages = (parsedMessages.map(normalizeAgentSessionMessage).filter(Boolean) as AgentSessionMessage[])
        .slice(-STORED_SESSION_MESSAGE_LIMIT);
    }
  } catch {}
  const updatedAt = typeof row?.updated_at === "number" ? row.updated_at : Number(row?.updated_at || Date.now());
  return { items, messages, updatedAt };
};

const readAgentSessionRecord = async (
  env: EnvWithDb,
  projectId: string,
  sessionKey: string,
  userId: string | null,
): Promise<PersistedAgentSessionRecord> => {
  const row = await env.DB.prepare(
    "SELECT items, messages, updated_at FROM agent_sessions WHERE session_key = ?1 AND project_id = ?2 AND user_id IS ?3"
  ).bind(sessionKey, projectId, userId).first();
  if (!row) return { items: [], messages: [], updatedAt: 0 };
  return normalizeRecord(row);
};

const compareAndSetAgentSessionRecord = async (
  env: EnvWithDb,
  projectId: string,
  sessionKey: string,
  sessionId: string,
  userId: string | null,
  expectedUpdatedAt: number,
  record: PersistedAgentSessionRecord
) => {
  const values = [
    sessionKey,
    sessionId,
    userId,
    projectId,
    JSON.stringify(record.items),
    JSON.stringify(record.messages),
    record.updatedAt,
  ];
  const result = expectedUpdatedAt === 0
    ? await env.DB.prepare(
        "INSERT INTO agent_sessions (session_key, session_id, user_id, project_id, items, messages, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(session_key) DO NOTHING"
      ).bind(...values).run()
    : await env.DB.prepare(
        "UPDATE agent_sessions SET session_id=?2, user_id=?3, project_id=?4, items=?5, messages=?6, updated_at=?7 WHERE session_key=?1 AND project_id=?4 AND user_id IS ?3 AND updated_at=?8"
      ).bind(...values, expectedUpdatedAt).run();
  return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
};

export const resolveAgentSessionOwner = async (request: Request, env: EnvWithDb) => {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.trim()) return null;
  return await getUserId(request, env as Required<Pick<EnvWithDb, "CLERK_SECRET_KEY">> & EnvWithDb);
};

export const createAgentSessionKey = (projectId: string, sessionId: string, userId?: string | null) => {
  const owner = userId ? `user:${userId}` : "anon";
  return `${owner}:project:${encodeURIComponent(projectId)}:session:${sessionId}`;
};

const LEGACY_AGENT_SESSION_PREFIX = "qalam:";
const CURRENT_AGENT_SESSION_PREFIX = "stylo:";

export const migrateLegacyD1AgentSession = async (
  env: EnvWithDb,
  projectId: string,
  sessionId: string,
  userId: string | null
) => {
  if (!sessionId.startsWith(CURRENT_AGENT_SESSION_PREFIX)) return false;
  const currentSessionKey = createAgentSessionKey(projectId, sessionId, userId);
  const current = await readAgentSessionRecord(env, projectId, currentSessionKey, userId);
  if (current.updatedAt > 0) return false;
  const legacySessionId = `${LEGACY_AGENT_SESSION_PREFIX}${sessionId.slice(CURRENT_AGENT_SESSION_PREFIX.length)}`;
  const legacySessionKey = createAgentSessionKey(projectId, legacySessionId, userId);
  const legacy = await readAgentSessionRecord(env, projectId, legacySessionKey, userId);
  if (legacy.updatedAt <= 0) return false;
  return compareAndSetAgentSessionRecord(
    env,
    projectId,
    currentSessionKey,
    sessionId,
    userId,
    0,
    { ...legacy, updatedAt: Math.max(Date.now(), legacy.updatedAt + 1) }
  );
};

export class D1EdgeSession implements Session {
  constructor(
    private readonly env: EnvWithDb,
    private readonly projectId: string,
    private readonly sessionId: string,
    private readonly sessionKey: string,
    private readonly userId: string | null
  ) {}

  async getSessionId(): Promise<string> {
    return this.sessionId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const record = await readAgentSessionRecord(this.env, this.projectId, this.sessionKey, this.userId);
    return trimSessionItems(record.items, limit);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    if (!items.length) return;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const existing = await readAgentSessionRecord(this.env, this.projectId, this.sessionKey, this.userId);
      const merged = [...existing.items, ...items.map(cloneItem)];
      const timestampBase = Date.now();
      const projectedMessages = projectAgentItemsToSessionMessages(items.map(cloneItem), timestampBase);
      const written = await compareAndSetAgentSessionRecord(
        this.env,
        this.projectId,
        this.sessionKey,
        this.sessionId,
        this.userId,
        existing.updatedAt,
        {
          items: compactAgentSessionItems(merged, { maxItems: STORED_SESSION_ITEM_LIMIT }),
          messages: [...existing.messages, ...projectedMessages].slice(-STORED_SESSION_MESSAGE_LIMIT),
          updatedAt: Math.max(timestampBase, existing.updatedAt + 1),
        }
      );
      if (written) return;
    }
    throw new Error("Agent session update conflicted repeatedly");
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const existing = await readAgentSessionRecord(this.env, this.projectId, this.sessionKey, this.userId);
      if (!existing.items.length) return undefined;
      const nextItems = existing.items.slice(0, -1);
      const removed = existing.items[existing.items.length - 1];
      const timestampBase = Date.now();
      const written = await compareAndSetAgentSessionRecord(
        this.env,
        this.projectId,
        this.sessionKey,
        this.sessionId,
        this.userId,
        existing.updatedAt,
        {
          items: nextItems,
          messages: projectAgentItemsToSessionMessages(nextItems, timestampBase).slice(-STORED_SESSION_MESSAGE_LIMIT),
          updatedAt: Math.max(timestampBase, existing.updatedAt + 1),
        }
      );
      if (written) return cloneItem(removed);
    }
    throw new Error("Agent session pop conflicted repeatedly");
  }

  async clearSession(): Promise<void> {
    await this.env.DB.prepare(
      "DELETE FROM agent_sessions WHERE session_key = ?1 AND project_id = ?2 AND user_id IS ?3"
    ).bind(this.sessionKey, this.projectId, this.userId).run();
  }

  async replaceItemsIfUnchanged(expectedItems: AgentInputItem[], nextItems: AgentInputItem[]): Promise<boolean> {
    const existing = await readAgentSessionRecord(this.env, this.projectId, this.sessionKey, this.userId);
    const expected = repairSessionToolTransactions(expectedItems);
    if (JSON.stringify(existing.items) !== JSON.stringify(expected)) return false;
    const normalizedNext = compactAgentSessionItems(nextItems, { maxItems: STORED_SESSION_ITEM_LIMIT });
    const updatedAt = Math.max(Date.now(), existing.updatedAt + 1);
    const result = await this.env.DB.prepare(
      "UPDATE agent_sessions SET items = ?1, messages = ?2, updated_at = ?3 WHERE session_key = ?4 AND project_id = ?5 AND user_id IS ?6 AND updated_at = ?7"
    )
      .bind(
        JSON.stringify(normalizedNext),
        JSON.stringify(projectAgentItemsToSessionMessages(normalizedNext, updatedAt).slice(-STORED_SESSION_MESSAGE_LIMIT)),
        updatedAt,
        this.sessionKey,
        this.projectId,
        this.userId,
        existing.updatedAt
      )
      .run();
    return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
  }
}

type CompareAndSwapSession = Session & {
  replaceItemsIfUnchanged?: (expectedItems: AgentInputItem[], nextItems: AgentInputItem[]) => Promise<boolean>;
};

const replaceSessionItemsAfterCompaction = async (
  session: Session,
  expectedItems: AgentInputItem[],
  nextItems: AgentInputItem[]
) => {
  const compareAndSwap = (session as CompareAndSwapSession).replaceItemsIfUnchanged;
  if (typeof compareAndSwap === "function") {
    return await compareAndSwap.call(session, expectedItems, nextItems);
  }
  const latestItems = await session.getItems();
  if (JSON.stringify(latestItems) !== JSON.stringify(expectedItems)) return false;
  await session.clearSession();
  await session.addItems(nextItems);
  return true;
};

export const readD1SessionMessages = async (
  env: EnvWithDb,
  projectId: string,
  sessionKey: string,
  userId: string | null,
) => {
  const record = await readAgentSessionRecord(env, projectId, sessionKey, userId);
  return record.messages;
};

const DEFAULT_COMPACTION_THRESHOLD = 12;
const DEFAULT_COMPACTION_TAIL_ITEMS = 8;
const MAX_COMPACTION_TRANSCRIPT_CHARS = 24_000;

const selectCompactionCandidateItems = (items: AgentInputItem[]) =>
  items.filter((item) => {
    if (!item || typeof item !== "object") return false;
    if ((item as any).type === "compaction") return false;
    return !((item as any).role === "user");
  });

const extractItemText = (item: AgentInputItem) => {
  if (!item || typeof item !== "object") return "";
  if ((item as any).type === "function_call_result") {
    const name = String((item as any).name || "tool");
    return `[tool:${name}] ${summarizeSessionToolOutput((item as any).output)}`.trim();
  }
  const content = (item as any).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (typeof (part as any).text === "string") return (part as any).text;
      if (typeof (part as any).transcript === "string") return (part as any).transcript;
      if (typeof (part as any).refusal === "string") return (part as any).refusal;
      if ((part as any).type === "input_image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
};

const serializeItemsForCompaction = (items: AgentInputItem[]) => {
  const entries = items
    .map((item, index) => {
      if (!item || typeof item !== "object") return "";
      const role = typeof (item as any).role === "string" ? (item as any).role : String((item as any).type || "item");
      const text = clipText(extractItemText(item), 4000);
      return text ? `${index + 1}. [${role}] ${text}` : "";
    })
    .filter(Boolean);
  const selected: string[] = [];
  let characters = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const separatorChars = selected.length ? 2 : 0;
    const remaining = MAX_COMPACTION_TRANSCRIPT_CHARS - characters - separatorChars;
    if (remaining <= 0) break;
    const selectedEntry = entry.length <= remaining
      ? entry
      : remaining <= 3
        ? entry.slice(0, remaining)
        : `${entry.slice(0, remaining - 3)}...`;
    selected.unshift(selectedEntry);
    characters += selectedEntry.length + separatorChars;
  }
  return selected.join("\n\n");
};

const extractResponseText = (response: any): string => {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const output = Array.isArray(response?.output) ? response.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    if ((item as any).type === "output_text" && typeof (item as any).text === "string") {
      parts.push((item as any).text);
    }
    if ((item as any).type === "message" && Array.isArray((item as any).content)) {
      for (const content of (item as any).content) {
        if (content?.type === "output_text" && typeof content.text === "string") {
          parts.push(content.text);
        }
      }
    }
  }
  return parts.join("\n").trim();
};

const buildCompactionSummaryItem = (summaryText: string): AgentInputItem =>
  ({
    type: "message",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text:
          "Session Summary\n" +
          "This is an auto-generated condensed memory of earlier turns. Use it as historical context; prefer newer turns when conflicts appear.\n\n" +
          summaryText.trim(),
      },
    ],
  }) as AgentInputItem;

type StyloResponsesCompactionSessionOptions = {
  underlyingSession: Session;
  model: string;
  apiKey: string;
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  threshold?: number;
  tailItems?: number;
};

export class StyloResponsesCompactionSession implements OpenAIResponsesCompactionAwareSession {
  private readonly client: OpenAI;
  private readonly threshold: number;
  private readonly tailItems: number;

  constructor(private readonly options: StyloResponsesCompactionSessionOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      defaultHeaders: options.defaultHeaders,
    });
    this.threshold = Math.max(4, options.threshold ?? DEFAULT_COMPACTION_THRESHOLD);
    this.tailItems = Math.max(4, options.tailItems ?? DEFAULT_COMPACTION_TAIL_ITEMS);
  }

  getSessionId(): Promise<string> {
    return this.options.underlyingSession.getSessionId();
  }

  getItems(limit?: number): Promise<AgentInputItem[]> {
    return this.options.underlyingSession.getItems(limit);
  }

  addItems(items: AgentInputItem[]): Promise<void> {
    return this.options.underlyingSession.addItems(items);
  }

  popItem(): Promise<AgentInputItem | undefined> {
    return this.options.underlyingSession.popItem();
  }

  clearSession(): Promise<void> {
    return this.options.underlyingSession.clearSession();
  }

  async runCompaction(args?: OpenAIResponsesCompactionArgs): Promise<OpenAIResponsesCompactionResult | null> {
    try {
      const sessionItems = await this.options.underlyingSession.getItems();
      if (sessionItems.length <= this.tailItems + 1) return null;

      const preservedTail = trimSessionItems(sessionItems, this.tailItems);
      const compactionSource = sessionItems.slice(0, Math.max(sessionItems.length - this.tailItems, 0));
      const compactionCandidateItems = selectCompactionCandidateItems(compactionSource);
      const shouldCompact = args?.force === true || compactionCandidateItems.length >= this.threshold;
      if (!shouldCompact || !compactionSource.length) return null;

      const transcript = serializeItemsForCompaction(compactionSource);
      if (!transcript.trim()) return null;

      const response = await this.client.responses.create({
        model: this.options.model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You are compacting earlier conversation history for an agent session. Produce a concise, durable summary of prior context. Preserve stable facts, accepted decisions, active constraints, unfinished tasks, and the latest successful/failed tool outcomes. Do not invent facts. Prefer bullet-like short lines over prose.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Summarize the following earlier conversation history for future agent turns.\n\n" +
                  transcript,
              },
            ],
          },
        ],
      });

      const summaryText = extractResponseText(response);
      if (!summaryText.trim()) return null;

      const replaced = await replaceSessionItemsAfterCompaction(this.options.underlyingSession, sessionItems, [
        buildCompactionSummaryItem(summaryText),
        ...preservedTail,
      ]);
      if (!replaced) return null;

      const usage = (response as any)?.usage || {};
      return {
        usage: new RequestUsage({
          inputTokens: Number(usage.inputTokens ?? usage.input_tokens ?? 0),
          outputTokens: Number(usage.outputTokens ?? usage.output_tokens ?? 0),
          totalTokens: Number(usage.totalTokens ?? usage.total_tokens ?? 0),
          inputTokensDetails: (usage.inputTokensDetails ?? usage.input_tokens_details ?? {}) as Record<string, number>,
          outputTokensDetails: (usage.outputTokensDetails ?? usage.output_tokens_details ?? {}) as Record<string, number>,
          endpoint: "responses.create",
        }),
      };
    } catch {
      return null;
    }
  }
}
