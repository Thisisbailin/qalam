import { createStableId } from "../../../utils/id";
import type { ChatMessage, Message } from "./types";

export type ConversationRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

export type ConversationState = {
  activeId: string;
  items: ConversationRecord[];
};

export const buildConversationTitle = (messages: Message[]) => {
  const firstUser = messages.find((message) =>
    message.role === "user" && (message as ChatMessage).text?.trim()
  ) as ChatMessage | undefined;
  if (!firstUser) return "新对话";
  const text = firstUser.text.trim();
  return text.length > 20 ? `${text.slice(0, 20)}...` : text;
};

export const createConversationRecord = (messages: Message[] = []): ConversationRecord => {
  const now = Date.now();
  return {
    id: createStableId("chat"),
    title: buildConversationTitle(messages),
    createdAt: now,
    updatedAt: now,
    messages,
  };
};

export const updateConversationMessages = (
  previous: ConversationState,
  conversationId: string,
  updater: Message[] | ((messages: Message[]) => Message[]),
  maxMessages = 120,
) => {
  const index = previous.items.findIndex((item) => item.id === conversationId);
  if (index < 0) return { state: previous, messages: [] as Message[] };
  const items = [...previous.items];
  const current = items[index];
  const currentMessages = Array.isArray(current.messages) ? current.messages : [];
  const nextMessages = (typeof updater === "function" ? updater(currentMessages) : updater).slice(-maxMessages);
  items[index] = {
    ...current,
    title: current.title && current.title !== "新对话" ? current.title : buildConversationTitle(nextMessages),
    messages: nextMessages,
    updatedAt: Date.now(),
  };
  return { state: { ...previous, items }, messages: nextMessages };
};
