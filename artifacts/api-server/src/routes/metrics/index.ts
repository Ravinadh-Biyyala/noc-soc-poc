import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  metrics,
  preparedDatasets,
  datasets,
  datasetColumns,
  joins as joinsTable,
  workspaces,
} from "@workspace/db";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import {
  CreateMetricBody,
  UpdateMetricBody,
  SuggestMetricsBody,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  validateFormula,
  appendAudit,
  suggestMetrics,
  type AuditEntry,
} from "../../lib/metrics-engine";
import { getTenantConfig } from "../../config/index.js";

const router: IRouter = Router();

function getAudit(m: typeof metrics.$inferSelect): AuditEntry[] {
  return Array.isArray(m.auditLog) ? (m.auditLog as AuditEntry[]) : [];
}

function serialize(m: typeof metrics.$inferSelect) {
  return {
    id: m.id,
    workspaceId: m.workspaceId,
    preparedDatasetId: m.preparedDatasetId,
    name: m.name,
    description: m.description,
    formula: m.formula,
    format: m.format,
    status: m.status,
    owner: m.owner,
    source: m.source,
    auditLog: getAudit(m),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

router.get("/workspaces/:id/metrics", async (req: Request, res: Response) => {
  const workspaceId = Number(req.params.id);
  if (!Number.isFinite(workspaceId)) {
    res.status(400).json({ error: "Invalid workspace id" });
    return;
  }
  const rows = await db
    .select()
    .from(metrics)
    .where(eq(metrics.workspaceId, workspaceId))
    .orderBy(desc(metrics.updatedAt));
  res.json(rows.map(serialize));
});

router.post("/workspaces/:id/metrics", async (req: Request, res: Response) => {
  const workspaceId = Number(req.params.id);
  if (!Number.isFinite(workspaceId)) {
    res.status(400).json({ error: "Invalid workspace id" });
    return;
  }
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  const body = CreateMetricBody.parse(req.body);
  const v = validateFormula(body.formula);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }
  // Workspace integrity: prepared dataset (if supplied) must belong to this workspace.
  if (body.preparedDatasetId !== undefined && body.preparedDatasetId !== null) {
    const [pd] = await db
      .select({ id: preparedDatasets.id })
      .from(preparedDatasets)
      .where(
        and(
          eq(preparedDatasets.id, body.preparedDatasetId),
          eq(preparedDatasets.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!pd) {
      res.status(400).json({
        error: "preparedDatasetId does not belong to this workspace",
      });
      return;
    }
  }
  const audit = appendAudit([], {
    action: "created",
    by: body.owner ?? "You",
    note: body.source ?? "user",
  });
  const [created] = await db
    .insert(metrics)
    .values({
      workspaceId,
      preparedDatasetId: body.preparedDatasetId ?? null,
      name: body.name,
      description: body.description ?? null,
      formula: body.formula,
      format: body.format ?? "number",
      status: body.status ?? "user_approved",
      owner: body.owner ?? "You",
      source: body.source ?? "user",
      auditLog: audit,
    })
    .returning();
  res.status(201).json(serialize(created));
});

interface LockedMetricRow {
  id: number;
  status: string;
  owner: string;
  workspace_id: number;
  audit_log: unknown;
}

interface PgQueryResult<T> {
  rows?: T[];
}

function firstLockedRow(result: unknown): LockedMetricRow | undefined {
  if (Array.isArray(result)) {
    return result[0] as LockedMetricRow | undefined;
  }
  if (typeof result === "object" && result !== null) {
    const rows = (result as PgQueryResult<LockedMetricRow>).rows;
    if (Array.isArray(rows)) return rows[0];
  }
  return undefined;
}

class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

router.patch(
  "/workspaces/:workspaceId/metrics/:metricId",
  async (req: Request, res: Response) => {
    const workspaceId = Number(req.params.workspaceId);
    const id = Number(req.params.metricId);
    if (!Number.isFinite(workspaceId) || !Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid workspace or metric id" });
      return;
    }
    const body = UpdateMetricBody.parse(req.body);
    if (body.formula !== undefined) {
      const v = validateFormula(body.formula);
      if (!v.ok) {
        res.status(400).json({ error: v.error });
        return;
      }
    }

    // Atomic audit-log append: lock the metric row, read the latest auditLog,
    // append, and update inside the same transaction. This prevents the
    // read-modify-write race that could lose audit entries on concurrent
    // status transitions.
    try {
      const updated = await db.transaction(async (tx) => {
        const locked = await tx.execute(
          sql`select id, status, owner, workspace_id, audit_log from metrics where id = ${id} for update`,
        );
        const lockedRow = firstLockedRow(locked);
        if (!lockedRow) {
          throw new HttpError("Metric not found", 404);
        }
        if (lockedRow.workspace_id !== workspaceId) {
          // Don't leak existence — same response as not found.
          throw new HttpError("Metric not found", 404);
        }
        const currentLog: AuditEntry[] = Array.isArray(lockedRow.audit_log)
          ? (lockedRow.audit_log as AuditEntry[])
          : [];
        const actor = body.owner ?? lockedRow.owner;
        const action =
          body.status && body.status !== lockedRow.status
            ? `status: ${lockedRow.status} → ${body.status}`
            : "edited";
        const nextLog = appendAudit(currentLog, {
          action,
          by: actor,
          note: body.note ?? undefined,
        });
        const [row] = await tx
          .update(metrics)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined
              ? { description: body.description }
              : {}),
            ...(body.formula !== undefined ? { formula: body.formula } : {}),
            ...(body.format !== undefined ? { format: body.format } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.owner !== undefined ? { owner: body.owner } : {}),
            auditLog: nextLog,
            updatedAt: new Date(),
          })
          .where(
            and(eq(metrics.id, id), eq(metrics.workspaceId, workspaceId)),
          )
          .returning();
        return row;
      });
      res.json(serialize(updated));
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      req.log.error({ err }, "Failed to update metric");
      res.status(500).json({ error: "Failed to update metric" });
    }
  },
);

router.delete(
  "/workspaces/:workspaceId/metrics/:metricId",
  async (req: Request, res: Response) => {
    const workspaceId = Number(req.params.workspaceId);
    const id = Number(req.params.metricId);
    if (!Number.isFinite(workspaceId) || !Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid workspace or metric id" });
      return;
    }
    const result = await db
      .delete(metrics)
      .where(and(eq(metrics.id, id), eq(metrics.workspaceId, workspaceId)))
      .returning({ id: metrics.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Metric not found" });
      return;
    }
    res.status(204).end();
  },
);

router.post(
  "/workspaces/:id/metrics/suggest",
  async (req: Request, res: Response) => {
    const workspaceId = Number(req.params.id);
    if (!Number.isFinite(workspaceId)) {
      res.status(400).json({ error: "Invalid workspace id" });
      return;
    }
    const body = SuggestMetricsBody.parse(req.body);
    const [pd] = await db
      .select()
      .from(preparedDatasets)
      .where(eq(preparedDatasets.id, body.preparedDatasetId))
      .limit(1);
    if (!pd || pd.workspaceId !== workspaceId) {
      res.status(404).json({ error: "Prepared dataset not found in workspace" });
      return;
    }

    // Prefer the materialized join columns so KPI suggestions can reference
    // joined columns. Enrich with semantic types from the constituent
    // datasets where the names match.
    const materializedCols = Array.isArray(pd.columns)
      ? (pd.columns as string[])
      : [];
    const refDsIds = new Set<number>([pd.baseDatasetId]);
    const joinIds = Array.isArray(pd.joinIds) ? (pd.joinIds as number[]) : [];
    if (joinIds.length > 0) {
      const joinRows = await db
        .select()
        .from(joinsTable)
        .where(
          and(
            eq(joinsTable.workspaceId, workspaceId),
            inArray(joinsTable.id, joinIds),
          ),
        );
      for (const j of joinRows) {
        refDsIds.add(j.leftDatasetId);
        refDsIds.add(j.rightDatasetId);
      }
    }
    const colRows = await db
      .select()
      .from(datasetColumns)
      .where(inArray(datasetColumns.datasetId, [...refDsIds]))
      .orderBy(datasetColumns.ordinal);
    // Index semantic info by column name (last writer wins; good enough for prompting).
    const colInfoByName = new Map<
      string,
      { semanticType: string; businessMeaning: string | null }
    >();
    for (const c of colRows) {
      colInfoByName.set(c.name, {
        semanticType: c.semanticType,
        businessMeaning: c.businessMeaning,
      });
    }

    const suggestionCols =
      materializedCols.length > 0
        ? materializedCols.map((name) => ({
            name,
            semanticType: colInfoByName.get(name)?.semanticType ?? "unknown",
            businessMeaning: colInfoByName.get(name)?.businessMeaning ?? null,
          }))
        : colRows
            .filter((c) => c.datasetId === pd.baseDatasetId)
            .map((c) => ({
              name: c.name,
              semanticType: c.semanticType,
              businessMeaning: c.businessMeaning,
            }));

    const [baseDs] = await db
      .select()
      .from(datasets)
      .where(eq(datasets.id, pd.baseDatasetId))
      .limit(1);
    const tenant = getTenantConfig();

    try {
      const suggestions = await suggestMetrics(openai, {
        datasetName: pd.name,
        domain: tenant.branding.industry,
        columns: suggestionCols,
      });
      const created = await db.transaction(async (tx) => {
        const out: (typeof metrics.$inferSelect)[] = [];
        for (const s of suggestions) {
          const audit = appendAudit([], {
            action: "ai-suggested",
            by: "Gen-BI",
            note: `from ${baseDs?.fileName ?? "dataset"}`,
          });
          const [row] = await tx
            .insert(metrics)
            .values({
              workspaceId,
              preparedDatasetId: pd.id,
              name: s.name,
              description: s.description,
              formula: s.formula,
              format: s.format,
              status: "ai_suggested",
              owner: "Gen-BI",
              source: "ai",
              auditLog: audit,
            })
            .returning();
          out.push(row);
        }
        return out;
      });
      res.status(201).json({ metrics: created.map(serialize) });
    } catch (err: unknown) {
      req.log.error({ err }, "Failed to suggest metrics");
      res.status(500).json({ error: "Failed to suggest metrics" });
    }
  },
);

export default router;
