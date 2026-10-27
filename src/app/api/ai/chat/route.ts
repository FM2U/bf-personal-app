import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { getOwner } from "@/lib/auth";
import { AI_SYSTEM_BASE, AIInvalidReply, AIUnavailable, CHAT_LENGTH_RULE, MESSAGE_FORMAT_RULE, callClaude, cleanText, textOf } from "@/lib/ai/claude";
import { createInitiativeDraft, UpdateNeeded } from "@/lib/initiative/server";
import { AI_TOOLS, runTool } from "@/lib/ai/tools";
import { loadCtx } from "@/lib/engine/helpers";
import type { Row } from "@/lib/types";

export const maxDuration = 120;

/** Chat panel endpoint. The AI can read app data through tools and can only propose changes. */
export async function POST(req: Request) {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { supabase: sb, ownerId } = owner;
  const body = (await req.json().catch(() => ({}))) as { message?: string; conversationId?: string | null; pagePath?: string };
  const message = String(body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "Type a message first." }, { status: 400 });

  let conversationId = body.conversationId ?? null;
  if (!conversationId) {
    const { data } = await sb.from("ai_conversations").insert({ owner_id: ownerId, title: message.slice(0, 80) }).select("id").single();
    conversationId = data?.id ?? null;
  }
  const { data: past } = conversationId
    ? await sb.from("ai_messages").select("role,content").eq("conversation_id", conversationId).order("created_at").limit(30)
    : { data: [] };
  await sb.from("ai_messages").insert({ owner_id: ownerId, conversation_id: conversationId, role: "user", content: message, page_path: body.pagePath ?? null });

  // Chat command: "Start an initiative: ..." drafts an initiative (the same as Plan, Start an initiative).
  const command = message.match(/^\s*(?:\/initiative|start an initiative|new initiative)\s*[:,-]?\s*([\s\S]*)$/i);
  if (command) {
    const description = command[1].trim();
    if (description.length < 8) {
      const reply = "- **Start an initiative:** add a sentence or more after the colon. Example: Start an initiative: weekly meal plan, shop once a week, cook on Sunday.";
      await sb.from("ai_messages").insert({ owner_id: ownerId, conversation_id: conversationId, role: "assistant", content: reply });
      return NextResponse.json({ reply, conversationId, proposals: [] });
    }
    try {
      const draftId = await createInitiativeDraft(sb, ownerId, description, "chat");
      const reply = "- **Draft ready:** the AI drafted the initiative.\n- **Next step:** open the setup, check each step, and press Approve selected on the last step.\n- **Nothing is saved** until you approve.";
      await sb.from("ai_messages").insert({ owner_id: ownerId, conversation_id: conversationId, role: "assistant", content: reply });
      return NextResponse.json({ reply, conversationId, proposals: [], link: { href: `/plan/initiatives/drafts/${draftId}?step=name`, label: "Open the setup" } });
    } catch (e) {
      const text = e instanceof AIUnavailable || e instanceof AIInvalidReply || e instanceof UpdateNeeded ? e.message : "The AI request failed. Try again.";
      return NextResponse.json({ error: text, conversationId }, { status: e instanceof AIUnavailable && e.reason !== "error" ? 403 : 500 });
    }
  }

  const ctx = await loadCtx(sb, ownerId);
  const path = body.pagePath ?? "/";
  const recordMatch = path.match(/^\/records\/([a-z_]+)\/([0-9a-f-]{36})/);
  const system = `${AI_SYSTEM_BASE}
${CHAT_LENGTH_RULE}
Exception: when Bram asks for an email or message draft, write the draft itself using this format instead:
${MESSAGE_FORMAT_RULE}
Today is ${ctx.today}. Bram is on the screen ${path}.${recordMatch ? ` The record on screen is table "${recordMatch[1]}" id "${recordMatch[2]}". Read it with get_record when relevant.` : ""}
Use the tools to read data before answering questions about numbers. Never claim a change was saved: use propose_change, then tell Bram to approve it on the AI proposals page.`;

  const messages: Anthropic.MessageParam[] = [
    ...((past ?? []) as Row[]).map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content) })),
    { role: "user", content: message },
  ];
  const proposals: string[] = [];
  try {
    let reply = "";
    for (let round = 0; round < 6; round++) {
      const msg = await callClaude({ sb, ownerId, purpose: "chat", system, messages, tools: AI_TOOLS, maxTokens: 1500 });
      const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (msg.stop_reason !== "tool_use" || !toolUses.length) {
        reply = textOf(msg);
        break;
      }
      messages.push({ role: "assistant", content: msg.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const out = await runTool(sb, ownerId, ctx.today, tu.name, (tu.input ?? {}) as Row, conversationId);
        if (tu.name === "propose_change" && out && typeof out === "object" && "proposal_id" in out) proposals.push(String((out as Row).proposal_id));
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 30000) });
      }
      messages.push({ role: "user", content: results });
      if (round === 5) reply = "I stopped after several data lookups. Ask a narrower question.";
    }
    reply = cleanText(reply || "No answer.");
    await sb.from("ai_messages").insert({ owner_id: ownerId, conversation_id: conversationId, role: "assistant", content: reply, tool_calls: proposals.length ? { proposals } : null });
    return NextResponse.json({ reply, conversationId, proposals });
  } catch (e) {
    const text = e instanceof AIUnavailable ? e.message : "The AI request failed. Try again.";
    return NextResponse.json({ error: text, conversationId }, { status: e instanceof AIUnavailable && e.reason !== "error" ? 403 : 500 });
  }
}
