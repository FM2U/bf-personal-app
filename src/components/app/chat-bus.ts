/**
 * Opening the AI chat from anywhere ("Ask the AI" in the sidebar, "Ask AI about this" in page and window headers,
 * "Suggest a next step" on a suggestion line). Browser only.
 */
import type { ChatContext } from "@/lib/ai/context";

export type { ChatContext };

export const OPEN_CHAT_EVENT = "bf-open-ai-chat";

export type OpenChatDetail = {
  /** The page or record the chat is about. null: a general chat. */
  context?: ChatContext | null;
  /** Sent at once (for example "Suggest one next step for this item"). */
  prompt?: string;
  /** Opened from inside a window: the chat opens inside that window, beside its content. */
  inWindow?: boolean;
};

export function openChat(detail: OpenChatDetail = {}) {
  window.dispatchEvent(new CustomEvent<OpenChatDetail>(OPEN_CHAT_EVENT, { detail }));
}

/** Set by the chat panel: whether it is open inside a window, and how to close it (Escape in a window closes the chat first). */
export const chatState: { openInWindow: boolean; close: (() => void) | null } = { openInWindow: false, close: null };
