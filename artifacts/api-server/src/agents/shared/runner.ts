/**
 * Shared agent runner — non-streaming.
 *
 * Used by /suggest endpoints that produce side-effects (persisted proposals)
 * rather than streaming text. Streaming agents (analyst chat) have their own
 * SSE wrapper.
 *
 * The openai client is imported from @workspace/integrations-openai-ai-server
 * which already wires up base URL and API key. We deliberately keep the
 * message + tool types loose here so we don't have to add `openai` as a direct
 * dependency of @workspace/api-server.
 */
import { openai } from "@workspace/integrations-openai-ai-server";

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AgentToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface RunAgentArgs {
  systemPrompt: string;
  userMessage: string;
  tools: AgentToolDef[];
  executeTool: (call: AgentToolCall) => Promise<string>;
  maxIterations?: number;
  model?: string;
  maxTokens?: number;
}

export interface RunAgentResult {
  finalText: string;
  iterations: number;
  toolCallCount: number;
  toolCallsByName: Record<string, number>;
}

interface ToolCallShape {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatMessageShape {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCallShape[];
}

export async function runAgent(args: RunAgentArgs): Promise<RunAgentResult> {
  const maxIterations = args.maxIterations ?? 6;
  const model = args.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const maxTokens = args.maxTokens ?? (Number(process.env.OPENAI_MAX_TOKENS) || 4096);

  const messages: ChatMessageShape[] = [
    { role: "system", content: args.systemPrompt },
    { role: "user", content: args.userMessage },
  ];

  let finalText = "";
  let iterations = 0;
  let toolCallCount = 0;
  const toolCallsByName: Record<string, number> = {};

  for (; iterations < maxIterations; iterations++) {
    // The OpenAI SDK's chat.completions.create accepts the structural shapes
    // we're using here; we cast through unknown to avoid pulling the openai
    // types into this package.
    const completion = await openai.chat.completions.create({
      model,
      max_completion_tokens: maxTokens,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: args.tools as any,
      tool_choice: "auto",
    });
    const choice = completion.choices?.[0];
    const msg = choice?.message;
    if (!msg) break;

    finalText = msg.content ?? finalText;

    const rawToolCalls = (msg.tool_calls ?? []) as Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
    const toolCalls: ToolCallShape[] = rawToolCalls
      .filter((tc) => tc.type === "function" && tc.function?.name)
      .map((tc) => ({
        id: tc.id ?? "",
        type: "function",
        function: { name: tc.function!.name!, arguments: tc.function!.arguments ?? "" },
      }));

    if (toolCalls.length === 0) break;

    messages.push({
      role: "assistant",
      content: msg.content ?? null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      toolCallCount++;
      toolCallsByName[tc.function.name] = (toolCallsByName[tc.function.name] ?? 0) + 1;
      let result: string;
      try {
        result = await args.executeTool({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
      } catch (err) {
        result = JSON.stringify({ error: err instanceof Error ? err.message : "Tool failed" });
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  return { finalText, iterations: iterations + 1, toolCallCount, toolCallsByName };
}
