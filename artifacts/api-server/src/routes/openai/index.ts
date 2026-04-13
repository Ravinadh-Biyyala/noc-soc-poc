import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db, conversations as conversationsTable, messages as messagesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  CreateOpenaiConversationBody,
  SendOpenaiMessageBody,
  GetOpenaiConversationParams,
  DeleteOpenaiConversationParams,
  ListOpenaiMessagesParams,
  SendOpenaiMessageParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

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

  const conversation = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id))
    .limit(1);
  if (!conversation.length) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  await db.insert(messagesTable).values({
    conversationId: id,
    role: "user",
    content: body.content,
  });

  const existingMessages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(messagesTable.createdAt);

  const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system" as const,
      content: `You are Broker Copilot, an AI analytics assistant for INVEX Insurance USA — a $187M premium U.S. insurance brokerage. You speak with authority on insurance broker metrics and help producers, managers, and executives understand performance data.

BROKERAGE CONTEXT (2023 vs 2022):
- Written Premium: $187.4M (+11.4% YoY from $168.2M)
- Commission Revenue: $28.1M (+11.4% YoY)
- Policies Bound: 8,234 (+10.4% YoY)
- Renewal Rate: 91.2%
- Quote-to-Bind Rate: 34.2%
- Retention Ratio: 93.4%
- Loss Ratio: 48.7%
- Average Premium per Policy: $22,758
- Active in 42 states
- Top States: CA ($34.2M), TX ($28.9M), NY ($24.1M), FL ($19.8M), IL ($14.3M)
- Top Producer: Sarah Mitchell ($32.4M written premium, 96% retention)
- Fastest Growing Lines: Cyber (+33.9%), Commercial Property (+13.7%)
- Top Carrier: Hartford Financial ($42.3M placed, 3.2 day turnaround)

AVAILABLE DASHBOARDS:
- Executive Summary (/) — Written Premium, Commission Revenue, Policies Bound, Renewal Rate, Quote-to-Bind, YoY Growth, Top States, Premium Trends, Policy Mix, USA Geographic Heat Map
- Sales Performance (/sales) — Sales Funnel (Lead->Qualified->Quoted->Bound->Renewed), Producer Leaderboard, Bind Trends, Account Size Distribution, Closing Ratio, Avg Days to Bind
- Product Analytics (/products) — Line of Business performance (Commercial Property, GL, Commercial Auto, Workers Comp, Cyber, Professional Liability), Carrier Performance, Premium by Line Trends
- Renewals & Retention (/renewals) — Renewal Rate, Retention Ratio, Retained vs Lost Premium, Premium at Risk (30/60/90 day), Churn by Producer, Churn by Line of Business
- Claims & Risk (/claims) — Open/Closed Claims, Claim Frequency, Avg Incurred Loss, Loss Ratio, Claims by Line, Claims by State, Recent Claims Table

RESPONSE RULES:
1. For simple metric questions, answer directly with the specific number. Example: "What's our renewal rate?" -> "Your renewal rate is 91.2%, up from 89.8% in 2022."
2. For trend/visual questions, provide context AND suggest the dashboard: include [NAVIGATE:/route] in your response. Example: "Show me premium trends" -> explain the trend + [NAVIGATE:/]
3. When asked to create a new dashboard or analysis, include [CREATE_DASHBOARD:Dashboard Title] in your response and describe what it would contain.
4. Use **bold** for key metrics and important terms.
5. Keep responses concise but insightful — you are a premium analytics copilot, not a chatbot.
6. Always use proper insurance broker terminology: Written Premium, Gross Written Premium (GWP), Earned Premium, Quote-to-Bind, Loss Ratio, Retention Ratio, Book of Business, Producer, Bind Rate, etc.
7. When comparing years, always reference 2023 vs 2022 data.
8. If asked about a specific state, producer, carrier, or line of business, provide the specific data you know.`,
    },
    ...existingMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: chatMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    await db.insert(messagesTable).values({
      conversationId: id,
      role: "assistant",
      content: fullResponse,
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    req.log.error({ error }, "OpenAI streaming error");
    res.write(`data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`);
    res.end();
  }
});

export default router;
