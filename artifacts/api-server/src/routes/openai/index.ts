import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  db,
  conversations as conversationsTable,
  messages as messagesTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  runDatasetQuery,
  loadProjectCopilotContext,
  renderProjectContextBlock,
} from "./agent-tools.js";
import {
  CreateOpenaiConversationBody,
  SendOpenaiMessageBody,
  GetOpenaiConversationParams,
  DeleteOpenaiConversationParams,
  ListOpenaiMessagesParams,
  SendOpenaiMessageParams,
} from "@workspace/api-zod";
import { buildSystemPrompt } from "../../config/prompt-builder.js";

// Convert inline AI bullets ("text. - bullet") to newline-separated format.
// No lookahead — punctuation + spaces + dash/em-dash + spaces is sufficient.
function normalizeMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/([.!?:,;])\s{1,4}[-–—]\s{1,4}/g, "$1\n- ")
    .replace(/\n{3,}/g, "\n\n");
}

// Strip the "[USER]\n" context-injection prefix the client prepends on the
// first message of a thread, leaving just what the user actually typed.
function rawUserText(content: string): string {
  return content.includes("\n\n[USER]\n") ? (content.split("\n\n[USER]\n").pop() ?? content) : content;
}

// Page-aware follow-up suggestions, grounded in the actual answer rather than a
// keyword guess on the client. One cheap, bounded, non-streaming call after the
// reply completes; returns [] on any failure so it never blocks the response.
const FOLLOWUP_TIMEOUT_MS = 10_000;

async function generateFollowups(userText: string, answer: string): Promise<string[]> {
  if (!answer.trim()) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FOLLOWUP_TIMEOUT_MS);
  try {
    const completion = await openai.chat.completions.create(
      {
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        max_completion_tokens: 200,
        messages: [
          {
            role: "system",
            content:
              "You suggest the next questions a user would ask a BI assistant. Ground every suggestion strictly in the " +
              "conversation provided — the specific entities, metrics and framing actually discussed. Never flip the framing " +
              "(e.g. do NOT suggest 'top performers' when the topic is underperformers). Return STRICT JSON only.",
          },
          {
            role: "user",
            content:
              `USER ASKED:\n${rawUserText(userText).slice(0, 800)}\n\n` +
              `ASSISTANT ANSWERED:\n${answer.slice(0, 1800)}\n\n` +
              `Propose 2-3 follow-up questions the user is most likely to ask NEXT. Each must be specific to the data above, ` +
              `<= 70 characters, phrased as the user would type it, and must not repeat what was already answered. ` +
              `Return JSON: {"questions": ["...", "..."]}.`,
          },
        ],
        response_format: { type: "json_object" },
      },
      { signal: controller.signal },
    );
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { questions?: unknown };
    const qs = Array.isArray(parsed.questions) ? parsed.questions : [];
    return qs
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .map((q) => q.trim())
      .slice(0, 3);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const router: IRouter = Router();

// ─── Agent tools (dataset query + frontend navigation) ───────────────────────

const DATASET_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "execute_dataset_query",
      description:
        "Run a SQL SELECT query on an uploaded dataset and return the results as JSON rows. Call this whenever the user asks a question about their imported or uploaded data.",
      parameters: {
        type: "object",
        properties: {
          datasetId: {
            type: "number",
            description: "Numeric ID of the dataset (from the UPLOADED DATASETS list in context). CRITICAL: the table name you use in the SQL must be the table name shown for THIS exact datasetId — they must come from the same dataset row.",
          },
          sql: {
            type: "string",
            description:
              "A valid SELECT query using the exact pg column names and the quoted table name from the SAME dataset entry as datasetId. Add LIMIT to avoid huge results (e.g. LIMIT 5 for top-N, LIMIT 1000 for full scans). Do NOT combine two LIMIT clauses.",
          },
        },
        required: ["datasetId", "sql"],
      },
    },
  },
];

const NAVIGATION_TOOL = {
  type: "function" as const,
  function: {
    name: "navigate_to_page",
    description:
      "Navigate the user's browser to a different page in the application. Use ONLY when the user explicitly asks to go somewhere, open a page, or switch views. Never call this unsolicited.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "URL path to navigate to (e.g. '/dashboards', '/projects', '/settings', '/governance', '/dashboards/claims').",
        },
        reason: {
          type: "string",
          description: "One-sentence explanation shown to the user as a toast notification.",
        },
      },
      required: ["path", "reason"],
    },
  },
};

const AGENT_TOOLS = [...DATASET_TOOLS, NAVIGATION_TOOL];

router.get("/openai/conversations", async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(conversationsTable)
    .orderBy(desc(conversationsTable.createdAt));
  res.json(
    rows.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt.toISOString(),
    }))
  );
});

router.post("/openai/conversations", async (req: Request, res: Response) => {
  const body = CreateOpenaiConversationBody.parse(req.body);
  const [conversation] = await db
    .insert(conversationsTable)
    .values({ title: body.title })
    .returning();
  req.log.info({ conversationId: conversation.id, title: conversation.title }, "Conversation created");
  res.status(201).json({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
  });
});

router.get("/openai/conversations/:id", async (req: Request, res: Response) => {
  const { id } = GetOpenaiConversationParams.parse({ id: Number(req.params.id) });
  const conversation = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id))
    .limit(1);
  if (!conversation.length) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(messagesTable.createdAt);
  res.json({
    id: conversation[0].id,
    title: conversation[0].title,
    createdAt: conversation[0].createdAt.toISOString(),
    messages: msgs.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

router.delete("/openai/conversations/:id", async (req: Request, res: Response) => {
  const { id } = DeleteOpenaiConversationParams.parse({ id: Number(req.params.id) });
  const conversation = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id))
    .limit(1);
  if (!conversation.length) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  await db.delete(messagesTable).where(eq(messagesTable.conversationId, id));
  await db.delete(conversationsTable).where(eq(conversationsTable.id, id));
  req.log.info({ conversationId: id }, "Conversation deleted");
  res.status(204).send();
});

router.get("/openai/conversations/:id/messages", async (req: Request, res: Response) => {
  const { id } = ListOpenaiMessagesParams.parse({ id: Number(req.params.id) });
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(messagesTable.createdAt);
  res.json(
    msgs.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }))
  );
});

router.post("/openai/conversations/:id/messages", async (req: Request, res: Response) => {
  const { id } = SendOpenaiMessageParams.parse({ id: Number(req.params.id) });
  const body = SendOpenaiMessageBody.parse(req.body);
  const workspaceId = typeof (req.body as { workspaceId?: number }).workspaceId === "number"
    ? (req.body as { workspaceId: number }).workspaceId
    : undefined;
  const projectCtx = workspaceId ? await loadProjectCopilotContext(workspaceId) : null;

  const conversation = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id))
    .limit(1);
  if (!conversation.length) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  // Fetch the last 20 messages before inserting the new one to build history
  const MAX_HISTORY = 20;
  const priorMessages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(messagesTable.createdAt);

  // Keep only the trailing MAX_HISTORY messages for context (avoids context-window overflow)
  const historyWindow = priorMessages.slice(-MAX_HISTORY);

  req.log.info(
    { conversationId: id, userMessageLen: body.content.length, historyMessages: priorMessages.length, windowSize: historyWindow.length },
    "Chat message received — starting stream"
  );
  const streamStart = Date.now();

  // Strip the dashboard context injection prefix before storing — keep only the raw user text.
  // The payload format is: "...\n\n[USER]\n{rawUserText}" when context is injected.
  const displayContent = body.content.includes("\n\n[USER]\n")
    ? (body.content.split("\n\n[USER]\n").pop() ?? body.content)
    : body.content;

  const baseSystemPrompt = await buildSystemPrompt();
  const systemPrompt = projectCtx
    ? `${baseSystemPrompt}\n\n${renderProjectContextBlock(projectCtx)}`
    : baseSystemPrompt;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...historyWindow.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: body.content },
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const MAX_TOOL_ITERATIONS = 3;
  const OPENAI_CALL_TIMEOUT_MS = 45_000;

  res.setTimeout(120_000, () => {
    res.write(`data: ${JSON.stringify({ error: "Request timed out — try again" })}\n\n`);
    res.end();
  });

  let fullResponse = "";

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const callController = new AbortController();
      const callTimeout = setTimeout(() => callController.abort(), OPENAI_CALL_TIMEOUT_MS);

      let accumulatedContent = "";
      let finishReason: string | null = null;
      const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();

      try {
        const stream = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
          max_completion_tokens: Number(process.env.OPENAI_MAX_TOKENS) || 8192,
          messages: chatMessages,
          tools: AGENT_TOOLS,
          tool_choice: "auto",
          stream: true,
        }, { signal: callController.signal });

        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          if (!choice) continue;

          const contentDelta = choice.delta?.content;
          if (contentDelta) {
            accumulatedContent += contentDelta;
            fullResponse += contentDelta;
            res.write(`data: ${JSON.stringify({ content: contentDelta })}\n\n`);
          }

          const tcDeltas = choice.delta?.tool_calls;
          if (tcDeltas) {
            for (const tc of tcDeltas) {
              const idx = tc.index ?? 0;
              if (!toolCallMap.has(idx)) toolCallMap.set(idx, { id: "", name: "", arguments: "" });
              const entry = toolCallMap.get(idx)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name += tc.function.name;
              if (tc.function?.arguments) entry.arguments += tc.function.arguments;
            }
          }

          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      } finally {
        clearTimeout(callTimeout);
      }

      if (finishReason !== "tool_calls" || toolCallMap.size === 0) break;

      res.write(`data: ${JSON.stringify({ status: "querying_database" })}\n\n`);

      const toolCallsArray = Array.from(toolCallMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => ({ id: tc.id, type: "function" as const, function: { name: tc.name, arguments: tc.arguments } }));

      chatMessages.push({ role: "assistant", content: accumulatedContent || null, tool_calls: toolCallsArray });

      for (const toolCall of toolCallsArray) {
        let toolResult: string;
        if (toolCall.function.name === "execute_dataset_query") {
          try {
            const args = JSON.parse(toolCall.function.arguments) as { datasetId: number; sql: string };
            req.log.info({ datasetId: args.datasetId, sql: args.sql }, "Tool: execute_dataset_query");
            const result = await runDatasetQuery(args.datasetId, args.sql, projectCtx);
            req.log.info({ datasetId: args.datasetId, rowCount: result.rowCount, error: result.error }, "Tool result");
            toolResult = JSON.stringify(result);
          } catch (err) {
            toolResult = JSON.stringify({ error: String(err), columns: [], rows: [], rowCount: 0 });
          }
        } else if (toolCall.function.name === "navigate_to_page") {
          try {
            const args = JSON.parse(toolCall.function.arguments) as { path: string; reason: string };
            req.log.info({ path: args.path }, "Tool: navigate_to_page");
            res.write(`data: ${JSON.stringify({ navigate: args.path, navigateReason: args.reason })}\n\n`);
            toolResult = JSON.stringify({ success: true, navigatedTo: args.path, message: `Navigation to ${args.path} initiated in the browser.` });
          } catch (err) {
            toolResult = JSON.stringify({ error: String(err) });
          }
        } else {
          toolResult = JSON.stringify({ error: "Unknown tool" });
        }
        chatMessages.push({ role: "tool", tool_call_id: toolCall.id, content: toolResult });
      }
    }

    // Only persist both messages after a successful stream — avoids orphaned user messages
    await db.insert(messagesTable).values([
      { conversationId: id, role: "user", content: displayContent },
      { conversationId: id, role: "assistant", content: fullResponse },
    ]);

    req.log.info(
      { conversationId: id, streamDurationMs: Date.now() - streamStart, responseLen: fullResponse.length },
      "Chat stream complete"
    );

    const followups = await generateFollowups(displayContent, fullResponse);
    if (followups.length) {
      res.write(`data: ${JSON.stringify({ followups })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    req.log.error({ err: error, conversationId: id, streamDurationMs: Date.now() - streamStart }, "OpenAI streaming error");
    res.write(`data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`);
    res.end();
  }
});

// Ephemeral chat — no DB storage. Frontend manages its own message history
// and passes it in the request body. Used by the right-rail chat panel.
// Supports agentic tool calling: the AI may call execute_dataset_query to run
// real SQL against uploaded datasets before producing its final response.
router.post("/openai/chat", async (req: Request, res: Response) => {
  const { messages: clientMessages = [], workspaceId } = req.body as {
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
    workspaceId?: number;
  };

  const projectCtx = workspaceId ? await loadProjectCopilotContext(Number(workspaceId)) : null;
  const baseSystemPrompt = await buildSystemPrompt();
  const systemPrompt = projectCtx
    ? `${baseSystemPrompt}\n\n${renderProjectContextBlock(projectCtx)}`
    : baseSystemPrompt;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...clientMessages,
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const MAX_TOOL_ITERATIONS = 3;
  const OPENAI_CALL_TIMEOUT_MS = 45_000;

  // Kill the SSE connection if the entire agentic flow takes too long
  res.setTimeout(120_000, () => {
    res.write(`data: ${JSON.stringify({ error: "Request timed out — try again" })}\n\n`);
    res.end();
  });

  try {
    let fullResponse = "";
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const callController = new AbortController();
      const callTimeout = setTimeout(() => callController.abort(), OPENAI_CALL_TIMEOUT_MS);

      let accumulatedContent = "";
      let finishReason: string | null = null;
      // Map from tool-call index → accumulated call info
      const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();

      try {
      const stream = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        max_completion_tokens: Number(process.env.OPENAI_MAX_TOKENS) || 8192,
        messages: chatMessages,
        tools: AGENT_TOOLS,
        tool_choice: "auto",
        stream: true,
      }, { signal: callController.signal });

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const contentDelta = choice.delta?.content;
        if (contentDelta) {
          accumulatedContent += contentDelta;
          fullResponse += contentDelta;
          res.write(`data: ${JSON.stringify({ content: contentDelta })}\n\n`);
        }

        // Accumulate tool call argument fragments across chunks
        const tcDeltas = choice.delta?.tool_calls;
        if (tcDeltas) {
          for (const tc of tcDeltas) {
            const idx = tc.index ?? 0;
            if (!toolCallMap.has(idx)) {
              toolCallMap.set(idx, { id: "", name: "", arguments: "" });
            }
            const entry = toolCallMap.get(idx)!;
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.arguments += tc.function.arguments;
          }
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      } finally {
        clearTimeout(callTimeout);
      }

      // No tool calls — content was already streamed, we are done
      if (finishReason !== "tool_calls" || toolCallMap.size === 0) break;

      // Notify the client we are hitting the database
      res.write(`data: ${JSON.stringify({ status: "querying_database" })}\n\n`);

      const toolCallsArray = Array.from(toolCallMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));

      // Append assistant message with tool_calls so the model sees its own request
      chatMessages.push({
        role: "assistant",
        content: accumulatedContent || null,
        tool_calls: toolCallsArray,
      });

      // Execute each tool call and append results
      for (const toolCall of toolCallsArray) {
        let toolResult: string;
        if (toolCall.function.name === "execute_dataset_query") {
          try {
            const args = JSON.parse(toolCall.function.arguments) as { datasetId: number; sql: string };
            req.log.info({ datasetId: args.datasetId, sql: args.sql }, "Tool: execute_dataset_query");
            const result = await runDatasetQuery(args.datasetId, args.sql, projectCtx);
            req.log.info({ datasetId: args.datasetId, rowCount: result.rowCount, error: result.error }, "Tool result");
            toolResult = JSON.stringify(result);
          } catch (err) {
            toolResult = JSON.stringify({ error: String(err), columns: [], rows: [], rowCount: 0 });
          }
        } else if (toolCall.function.name === "navigate_to_page") {
          try {
            const args = JSON.parse(toolCall.function.arguments) as { path: string; reason: string };
            req.log.info({ path: args.path }, "Tool: navigate_to_page");
            res.write(`data: ${JSON.stringify({ navigate: args.path, navigateReason: args.reason })}\n\n`);
            toolResult = JSON.stringify({ success: true, navigatedTo: args.path, message: `Navigation to ${args.path} initiated in the browser.` });
          } catch (err) {
            toolResult = JSON.stringify({ error: String(err) });
          }
        } else {
          toolResult = JSON.stringify({ error: "Unknown tool" });
        }

        chatMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }
      // Loop: next iteration streams the follow-up response (with tool results in context)
    }

    // Send server-normalized final text so the client can reliably render bullets.
    // This runs on the complete response ONCE — eliminates any client-side regex fragility.
    const normalized = normalizeMarkdown(fullResponse);
    if (normalized !== fullResponse) {
      res.write(`data: ${JSON.stringify({ finalText: normalized })}\n\n`);
    }

    const lastUser = [...clientMessages].reverse().find((m) => m.role === "user")?.content ?? "";
    const followups = await generateFollowups(lastUser, fullResponse);
    if (followups.length) {
      res.write(`data: ${JSON.stringify({ followups })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    req.log.error({ err: error }, "Ephemeral chat streaming error");
    res.write(`data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`);
    res.end();
  }
});

export default router;

