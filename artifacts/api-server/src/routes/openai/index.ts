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
import { executiveData } from "../dashboard/data/executive.js";
import { salesData } from "../dashboard/data/sales.js";
import { productData } from "../dashboard/data/products.js";
import { renewalsData } from "../dashboard/data/renewals.js";
import { claimsData } from "../dashboard/data/claims.js";
import { geographyData } from "../dashboard/data/geography.js";

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

function buildDataContext(): string {
  const stateMonthly = executiveData.stateMonthlyPremium.map(s => {
    const total2023 = s.monthly.filter(m => m.date.includes('2023')).reduce((sum, m) => sum + m.value, 0);
    const total2024 = s.monthly.filter(m => m.date.includes('2024')).reduce((sum, m) => sum + m.value, 0);
    const total2025 = s.monthly.filter(m => m.date.includes('2025')).reduce((sum, m) => sum + m.value, 0);
    return `${s.stateName} (${s.state}): 2023=$${(total2023/1e6).toFixed(1)}M, 2024=$${(total2024/1e6).toFixed(1)}M, 2025=$${(total2025/1e6).toFixed(1)}M`;
  }).join('; ');

  const producerMonthly = executiveData.producerMonthlyPremium.map(p => {
    const total = p.monthly.reduce((sum, m) => sum + m.value, 0);
    return `${p.producer}: 2025 Total=$${(total/1e6).toFixed(1)}M`;
  }).join('; ');

  const lineMonthly = executiveData.lineMonthlyPremium.map(l => {
    const total = l.monthly.reduce((sum, m) => sum + m.value, 0);
    return `${l.line}: 2025 Total=$${(total/1e6).toFixed(1)}M`;
  }).join('; ');

  const yearly = executiveData.yearlyPerformance.map(y => 
    `${y.year}: GWP=$${(y.writtenPremium/1e6).toFixed(1)}M, Commission=$${(y.commissionRevenue/1e6).toFixed(1)}M, Policies=${y.policiesBound}, Renewal=${(y.renewalRate*100).toFixed(1)}%, Loss Ratio=${(y.lossRatio*100).toFixed(1)}%`
  ).join('\n');

  return `
YEARLY PERFORMANCE:
${yearly}

CURRENT YEAR (2025-2026):
- Written Premium: $${(executiveData.writtenPremium.current/1e6).toFixed(1)}M (+${executiveData.writtenPremium.changePercent}% YoY)
- Commission Revenue: $${(executiveData.commissionRevenue.current/1e6).toFixed(1)}M
- Policies Bound: ${executiveData.policiesBound.current.toLocaleString()} (+${executiveData.policiesBound.changePercent}%)
- Renewal Rate: ${(executiveData.renewalRate*100).toFixed(1)}%
- Quote-to-Bind: ${(executiveData.quoteToBind*100).toFixed(1)}%
- Retention Ratio: ${(executiveData.retentionRate*100).toFixed(1)}%
- Loss Ratio: ${(executiveData.lossRatio*100).toFixed(1)}%
- Avg Premium/Policy: $${executiveData.avgPremiumPerPolicy.toLocaleString()}
- Active in ${geographyData.totalStatesActive} states

TOP STATES: ${executiveData.topStatesByPremium.map(s => `${s.state} ($${(s.premium/1e6).toFixed(1)}M)`).join(', ')}

STATE MONTHLY DATA: ${stateMonthly}

PRODUCER LEADERBOARD:
${salesData.producerLeaderboard.map(p => `${p.name}: GWP=$${(p.writtenPremium/1e6).toFixed(1)}M, Bind=${(p.bindRate*100).toFixed(1)}%, Retention=${(p.renewalRetention*100).toFixed(1)}%`).join('\n')}

PRODUCER MONTHLY DATA: ${producerMonthly}

LINES OF BUSINESS:
${productData.lineOfBusiness.map(l => `${l.line}: 2025=$${((l.premium2025 || l.premium2023)/1e6).toFixed(1)}M, YoY=${l.yoyChange}%, Loss Ratio=${(l.lossRatio*100).toFixed(1)}%, Bind=${(l.bindRate*100).toFixed(1)}%`).join('\n')}

LINE MONTHLY DATA: ${lineMonthly}

CARRIERS:
${productData.carriers.map(c => `${c.carrier}: Placed=$${(c.premiumPlaced/1e6).toFixed(1)}M, Bind=${(c.bindRatio*100).toFixed(1)}%, Turn=${c.avgQuoteTurnaround}d`).join('\n')}

CLAIMS:
- Open: ${claimsData.openClaims}, Closed: ${claimsData.closedClaims}
- Loss Ratio: ${(claimsData.lossRatio*100).toFixed(1)}%, Avg Incurred: $${claimsData.avgIncurredLoss.toLocaleString()}, Severity: $${claimsData.severity.toLocaleString()}
${claimsData.claimsByLine.map(c => `${c.line}: ${c.claims} claims, $${(c.incurredLoss/1e6).toFixed(1)}M incurred, ${(c.lossRatio*100).toFixed(1)}% loss ratio`).join('\n')}

RENEWALS:
- Renewal Rate: ${(renewalsData.renewalRate*100).toFixed(1)}%, Retained: $${(renewalsData.retainedPremium/1e6).toFixed(1)}M, Lost: $${(renewalsData.lostPremium/1e6).toFixed(1)}M
- At Risk (90d): $${(renewalsData.premiumAtRisk90/1e6).toFixed(1)}M

MONTHLY PREMIUM DATA (available for Jan 2022 - Apr 2026):
Total monthly premium values range from $12.8M to $23.1M with consistent upward trend.
Monthly bind counts range from 540 to 1,005 policies.
`;
}

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

  const dataContext = buildDataContext();

  const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system" as const,
      content: `You are Broker Copilot, a Gen-BI (Generative Business Intelligence) analytics engine for INVEX Insurance USA. You combine conversational AI with dynamic data visualization. You have FULL ACCESS to all brokerage data from 2022-2026.

${dataContext}

AVAILABLE DASHBOARDS:
- Executive Summary (/) — Written Premium, Commission Revenue, Policies Bound, Renewal Rate, Quote-to-Bind, YoY Growth, Top States, Premium Trends, Policy Mix, USA Geographic Heat Map
- Sales Performance (/sales) — Sales Funnel, Producer Leaderboard, Bind Trends, Account Size, Closing Ratio
- Product Analytics (/products) — Line of Business performance, Carrier Performance, Premium by Line Trends
- Renewals & Retention (/renewals) — Renewal Rate, Retention Ratio, Retained vs Lost Premium, Premium at Risk, Churn
- Claims & Risk (/claims) — Open/Closed Claims, Loss Ratio, Claims by Line, Claims by State, Recent Claims

CRITICAL RULE — GENERATIVE BI CHARTS:
When a user asks ANY data question (numbers, trends, comparisons, breakdowns, state data, producer data, line data, etc.), you MUST generate an inline chart visualization. Use this exact format:

[CHART:{"type":"bar|line|area|pie","title":"Chart Title","xKey":"labelField","yKey":"valueField","data":[{"labelField":"Label1","valueField":123},{"labelField":"Label2","valueField":456}]}]

Chart types to use:
- "bar" for comparisons (state vs state, producer vs producer, line vs line)
- "line" or "area" for trends over time (monthly premium, bind trends, loss ratio over time)
- "pie" for composition/mix (policy mix, premium breakdown by segment)

IMPORTANT CHART RULES:
1. ALWAYS include a [CHART:...] block when the user asks about data. This is Gen-BI — every data question gets a visualization.
2. Use real data from the context above. Never make up numbers.
3. For monetary values, provide raw numbers (not formatted strings) in the data array. The frontend will format them.
4. The xKey and yKey must match the keys in your data objects exactly.
5. Keep data arrays concise (max 12-15 data points for readability).
6. Add a brief text insight BEFORE the chart (1-2 sentences max).
7. After the chart, you can add [NAVIGATE:/route] if there's a relevant dashboard.

EXAMPLES:
User: "What is California's premium trend?"
Response: California's premium has grown steadily from **$34.2M** in 2023 to **$48.8M** in 2025, a **42.7%** increase over 3 years.
[CHART:{"type":"area","title":"California Written Premium (Monthly)","xKey":"month","yKey":"premium","data":[{"month":"Jan 2024","premium":2950000},{"month":"Apr 2024","premium":3150000},{"month":"Jul 2024","premium":3280000},{"month":"Oct 2024","premium":3350000},{"month":"Jan 2025","premium":3380000},{"month":"Apr 2025","premium":3600000},{"month":"Jul 2025","premium":3760000},{"month":"Oct 2025","premium":3820000},{"month":"Jan 2026","premium":3850000},{"month":"Apr 2026","premium":4100000}]}]
[NAVIGATE:/]

User: "Compare top 5 states by premium"
Response: California leads the book at **$48.8M**, followed by Texas at **$41.2M**. The top 5 states represent **64.5%** of total GWP.
[CHART:{"type":"bar","title":"Top 5 States by Written Premium","xKey":"state","yKey":"premium","data":[{"state":"California","premium":48800000},{"state":"Texas","premium":41200000},{"state":"New York","premium":33600000},{"state":"Florida","premium":28900000},{"state":"Illinois","premium":20400000}]}]

User: "Show policy mix"
Response: Commercial Property dominates at **25%** of our book, followed by General Liability at **20%**.
[CHART:{"type":"pie","title":"Premium by Line of Business","xKey":"line","yKey":"premium","data":[{"line":"Comm. Property","premium":66950000},{"line":"Gen. Liability","premium":53560000},{"line":"Comm. Auto","premium":42838000},{"line":"Workers Comp","premium":37494000},{"line":"Cyber","premium":29458000},{"line":"Prof. Liability","premium":18746000}]}]

ADDITIONAL RESPONSE RULES:
1. Use **bold** for key metrics.
2. Keep text concise — the chart IS the answer.
3. Always use proper insurance terminology: GWP, Earned Premium, Quote-to-Bind, Loss Ratio, Retention, Book of Business, Producer, Bind Rate.
4. For navigation, include [NAVIGATE:/route] after the chart.
5. For dashboard creation requests, include [CREATE_DASHBOARD:Title].
6. When the user asks to "Summarize" or "Analyze" a specific metric (these are auto-triggered from clicking a KPI card), give a SHORT 2-3 sentence insight with 1-2 bold key facts, then a small chart showing the trend or breakdown. Keep it concise — this is a quick tooltip-style summary, not a full analysis.
6. You have data from 2022-2026. Reference the most relevant years.
7. If asked about a specific time range for a state/producer/line, filter the monthly data and build the chart from it.`,
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
      model: "gpt-4.1-mini",
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
