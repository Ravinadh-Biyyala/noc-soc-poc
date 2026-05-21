/**
 * AnalystChatAgent tool definitions — strictly read-only.
 *
 * Only one tool: execute_warehouse_query. This is the architectural payoff
 * for the multi-agent split — the chat agent literally CANNOT modify data or
 * create artifacts. If the user tries to talk it into "make a transformation",
 * the model has no tool to do so and must refuse.
 */

export const ANALYST_CHAT_OPENAI_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "execute_warehouse_query",
      description: "Run a SELECT (or WITH ... SELECT) against the project's warehouse schema. Read-only. Returns up to 200 rows as JSON.",
      parameters: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: "Fully-qualified SELECT. All table references must use the project's warehouse schema. No DDL or DML.",
          },
        },
        required: ["sql"],
      },
    },
  },
];
