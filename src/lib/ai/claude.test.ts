import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: { anthropicKey: "test-key", anthropicModel: "mock-model", aiMonthlyCapUsd: 25, aiInputPricePerMTok: 3, aiOutputPricePerMTok: 15 },
  isAIConfigured: () => true,
}));

/** The scripted replies of the fake API, one per call, and every request it received. */
const replies: { text: string; stop: string }[] = [];
const requests: { max_tokens: number; system?: string; messages: { role: string; content: string }[] }[] = [];
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (req: { max_tokens: number; system?: string; messages: { role: string; content: string }[] }) => {
        requests.push(req);
        const r = replies.shift();
        if (!r) throw new Error("no scripted reply left");
        return { id: "msg", type: "message", role: "assistant", model: "mock-model", content: [{ type: "text", text: r.text }], stop_reason: r.stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
      },
    };
  },
}));

import { AI_REPLY_CUT_OFF, AIInvalidReply, callForJson } from "./claude";
import { buyerInstructions, GENERAL_RULES_LINE, WRITING_RULES } from "./instructions";
import { defaultBuyBoxSettings } from "@/lib/work/buy-box";
import type { SupabaseClient } from "@supabase/supabase-js";

/** A stand-in for the database: no spending this month, no cap setting, and inserts that succeed. */
const sb = {
  from: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      maybeSingle: async () => ({ data: null }),
      insert: async () => ({ data: null, error: null }),
      then: (resolve: (v: { data: unknown[] }) => void) => resolve({ data: [] }),
    };
    return chain;
  },
} as unknown as SupabaseClient;

const validate = (v: unknown) => {
  const steps = (v as { steps?: unknown }).steps;
  return Array.isArray(steps) ? ({ ok: true, value: steps as string[] } as const) : ({ ok: false, error: "no steps list" } as const);
};
const call = () => callForJson<string[]>({ sb, ownerId: "owner", purpose: "ask_next_steps", prompt: "TASK: next_steps", maxTokens: 600, shape: "items", validate });

describe("callForJson and replies cut off by the length limit (Edit batch B round 2)", () => {
  beforeEach(() => {
    replies.length = 0;
    requests.length = 0;
  });

  it("retries once with double the limit and a note to keep it short when the stop reason is max_tokens", async () => {
    replies.push({ text: '{"steps": [{"text": "Email the broker", "reason": "Quiet', stop: "max_tokens" }, { text: '{"steps": ["Email the broker"]}', stop: "end_turn" });
    await expect(call()).resolves.toEqual(["Email the broker"]);
    expect(requests.map((r) => r.max_tokens)).toEqual([600, 1200]);
    expect(requests[1].messages).toHaveLength(1);
    expect(requests[1].messages[0].content).toContain("Keep it short");
  });

  it("treats a bracketed fragment with an ordinary stop reason as cut off too, and retries", async () => {
    replies.push({ text: '{"bullets": ["**Send first:** the Dalton follow-up, then hol', stop: "end_turn" }, { text: '{"steps": ["Send the Dalton follow-up"]}', stop: "end_turn" });
    await expect(call()).resolves.toEqual(["Send the Dalton follow-up"]);
    expect(requests.map((r) => r.max_tokens)).toEqual([600, 1200]);
  });

  it("gives the cut-off message, not the fragment, when the retry is cut off as well", async () => {
    replies.push({ text: '{"steps": [', stop: "max_tokens" }, { text: '{"steps": [{"text": "a"', stop: "max_tokens" });
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AIInvalidReply);
    expect((err as AIInvalidReply).cutOff).toBe(true);
    expect((err as AIInvalidReply).message).toBe(AI_REPLY_CUT_OFF);
    expect(requests).toHaveLength(2);
  });

  it("still takes full JSON on the first call, and still asks once more with the problems when the value fails the check", async () => {
    replies.push({ text: '```json\n{"steps": ["Read the CIM"]}\n```', stop: "end_turn" });
    await expect(call()).resolves.toEqual(["Read the CIM"]);
    expect(requests).toHaveLength(1);
    requests.length = 0;
    replies.push({ text: '{"items": ["Read the CIM"]}', stop: "end_turn" }, { text: '{"steps": ["Read the CIM"]}', stop: "end_turn" });
    await expect(call()).resolves.toEqual(["Read the CIM"]);
    expect(requests).toHaveLength(2);
    expect(requests[1].max_tokens).toBe(600);
    expect(requests[1].messages).toHaveLength(3);
    expect(requests[1].messages[2].content).toContain("no steps list");
  });
});

describe("the writing rules are sent once per click (push D fix)", () => {
  beforeEach(() => {
    replies.length = 0;
    requests.length = 0;
  });
  const once = (r: (typeof requests)[number]) => [r.system ?? "", ...r.messages.map((m) => m.content)].join("\n").split(WRITING_RULES).length - 1;
  it("a deal click and another page's click each carry them once, in the system prompt", async () => {
    for (const prompt of [`TASK: next_steps\n${buyerInstructions({ buyBox: defaultBuyBoxSettings(), stage: "after_cim", financing: null }, "next_steps")}`, `TASK: next_steps\n${GENERAL_RULES_LINE}`]) {
      replies.push({ text: '{"steps": ["Email the broker"]}', stop: "end_turn" });
      await callForJson<string[]>({ sb, ownerId: "owner", purpose: "ask_next_steps", prompt, maxTokens: 600, shape: "items", validate });
    }
    expect(requests).toHaveLength(2);
    for (const r of requests) {
      expect(once(r)).toBe(1);
      expect(r.system).toContain(WRITING_RULES);
    }
  });
});
