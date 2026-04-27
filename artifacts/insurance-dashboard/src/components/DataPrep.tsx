import { useState, useMemo, useEffect } from "react";
import {
  Plus, Trash2, Database, GitMerge, Filter as FilterIcon, Layers, Calculator,
  ChevronDown, ChevronRight, ArrowRight, Sparkles, X, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type Table, type Operation, type JoinOperation, type FilterOperation,
  type AggregateOperation, type CalculatedColumnOperation,
  type JoinType, type FilterOp, type AggFunc,
  executePipeline, getOperationInputs,
} from "@/lib/data-operations";

interface DataPrepProps {
  sourceTables: Table[];
  onAddMoreFiles: () => void;
  onGenerateDashboard: (finalTable: Table) => void;
  isGenerating: boolean;
}

type AddingOpType = "join" | "filter" | "aggregate" | "calculated" | null;

export default function DataPrep({ sourceTables, onAddMoreFiles, onGenerateDashboard, isGenerating }: DataPrepProps) {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [addingOp, setAddingOp] = useState<AddingOpType>(null);
  const [previewTableId, setPreviewTableId] = useState<string | null>(null);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set(sourceTables.slice(0, 1).map((t) => t.id)));

  const { tables, tablesById } = useMemo(
    () => executePipeline(sourceTables, operations),
    [sourceTables, operations]
  );

  // Auto-prune operations whose inputs no longer exist (e.g. file removed)
  useEffect(() => {
    setOperations((prev) => {
      const validIds = new Set<string>(sourceTables.map((t) => t.id));
      const kept: Operation[] = [];
      for (const op of prev) {
        const inputs = getOperationInputs(op);
        if (inputs.every((id) => validIds.has(id))) {
          kept.push(op);
          validIds.add(`out-${op.id}`);
        }
      }
      return kept.length === prev.length ? prev : kept;
    });
  }, [sourceTables]);

  const activeTableId = previewTableId
    || (operations.length > 0 ? `out-${operations[operations.length - 1].id}` : sourceTables[0]?.id);
  const activeTable = activeTableId ? tablesById.get(activeTableId) : null;

  const addOperation = (op: Operation) => {
    setOperations((prev) => [...prev, op]);
    setAddingOp(null);
    setPreviewTableId(`out-${op.id}`);
  };

  const removeOperation = (id: string) => {
    setOperations((prev) => {
      // Cascade-remove: any downstream op that references this output also gets removed
      const removed = new Set<string>([`out-${id}`]);
      const kept: Operation[] = [];
      for (const o of prev) {
        if (o.id === id) continue;
        const refs = getOperationInputs(o);
        if (refs.some((r) => removed.has(r))) {
          removed.add(`out-${o.id}`);
          continue;
        }
        kept.push(o);
      }
      return kept;
    });
    setPreviewTableId(null);
  };

  const toggleExpand = (id: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGenerate = () => {
    if (activeTable) onGenerateDashboard(activeTable);
  };

  return (
    <div className="flex h-full min-h-0 animate-in fade-in duration-300">
      {/* Left: Tables panel */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-muted/20 flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Data Sources</h3>
          <button
            onClick={onAddMoreFiles}
            className="text-[10px] font-medium text-primary hover:underline flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add File
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider px-2 py-1.5">
            Source Tables
          </div>
          {sourceTables.map((table) => (
            <TableTreeItem
              key={table.id}
              table={table}
              isActive={activeTableId === table.id}
              isExpanded={expandedTables.has(table.id)}
              onToggle={() => toggleExpand(table.id)}
              onClick={() => setPreviewTableId(table.id)}
              icon={<Database className="w-3.5 h-3.5" />}
            />
          ))}

          {operations.length > 0 && (
            <>
              <div className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider px-2 py-1.5 mt-3">
                Derived Tables
              </div>
              {operations.map((op) => {
                const outputId = `out-${op.id}`;
                const t = tablesById.get(outputId);
                if (!t) return null;
                return (
                  <TableTreeItem
                    key={outputId}
                    table={t}
                    isActive={activeTableId === outputId}
                    isExpanded={expandedTables.has(outputId)}
                    onToggle={() => toggleExpand(outputId)}
                    onClick={() => setPreviewTableId(outputId)}
                    icon={opIcon(op.type)}
                  />
                );
              })}
            </>
          )}
        </div>
      </aside>

      {/* Middle: Operations pipeline + Preview */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="px-6 py-4 border-b border-border bg-white flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-foreground">Data Pipeline</h2>
            <p className="text-[11px] text-muted-foreground">Combine, filter, and aggregate before generating your dashboard</p>
          </div>
          <Button
            size="default"
            onClick={handleGenerate}
            disabled={!activeTable || activeTable.rows.length === 0 || isGenerating}
            className="gap-2"
          >
            <Sparkles className="w-4 h-4" />
            {isGenerating ? "Generating..." : "Generate Dashboard"}
          </Button>
        </div>

        {/* Pipeline */}
        <div className="px-6 py-4 border-b border-border bg-muted/10">
          <div className="flex items-center gap-2 flex-wrap">
            {sourceTables.map((t, i) => (
              <span key={t.id} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border border-border text-[11px] font-medium">
                <Database className="w-3 h-3 text-muted-foreground" />
                {t.name}
                {i < sourceTables.length - 1 && <span className="text-muted-foreground/50 ml-1">+</span>}
              </span>
            ))}

            {operations.map((op) => (
              <div key={op.id} className="flex items-center gap-2">
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <OperationCard op={op} tablesById={tablesById} onRemove={() => removeOperation(op.id)} onClick={() => setPreviewTableId(`out-${op.id}`)} isActive={previewTableId === `out-${op.id}`} />
              </div>
            ))}

            <div className="flex items-center gap-1.5 ml-2">
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <button
                onClick={() => setAddingOp("join")}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border hover:border-primary hover:bg-primary/5 text-[11px] text-muted-foreground hover:text-primary"
                disabled={tables.length < 2}
                title={tables.length < 2 ? "Need at least 2 tables" : "Add join"}
              >
                <GitMerge className="w-3 h-3" /> Join
              </button>
              <button
                onClick={() => setAddingOp("filter")}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border hover:border-primary hover:bg-primary/5 text-[11px] text-muted-foreground hover:text-primary"
              >
                <FilterIcon className="w-3 h-3" /> Filter
              </button>
              <button
                onClick={() => setAddingOp("aggregate")}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border hover:border-primary hover:bg-primary/5 text-[11px] text-muted-foreground hover:text-primary"
              >
                <Layers className="w-3 h-3" /> Aggregate
              </button>
              <button
                onClick={() => setAddingOp("calculated")}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border hover:border-primary hover:bg-primary/5 text-[11px] text-muted-foreground hover:text-primary"
              >
                <Calculator className="w-3 h-3" /> Calculate
              </button>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTable ? (
            <>
              <div className="px-6 py-2.5 border-b border-border bg-muted/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-foreground">{activeTable.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {activeTable.rows.length.toLocaleString()} rows · {activeTable.columns.length} columns
                  </span>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <DataGrid table={activeTable} maxRows={100} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a table to preview
            </div>
          )}
        </div>
      </main>

      {/* Add operation modal */}
      {addingOp && (
        <OperationModal
          type={addingOp}
          tables={tables}
          onClose={() => setAddingOp(null)}
          onAdd={addOperation}
        />
      )}
    </div>
  );
}

function opIcon(type: Operation["type"]) {
  if (type === "join") return <GitMerge className="w-3.5 h-3.5" />;
  if (type === "filter") return <FilterIcon className="w-3.5 h-3.5" />;
  if (type === "aggregate") return <Layers className="w-3.5 h-3.5" />;
  return <Calculator className="w-3.5 h-3.5" />;
}

function TableTreeItem({ table, isActive, isExpanded, onToggle, onClick, icon }: {
  table: Table; isActive: boolean; isExpanded: boolean; onToggle: () => void; onClick: () => void; icon: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer text-[12px] transition-colors",
          isActive ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"
        )}
        onClick={onClick}
      >
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="p-0.5 -ml-0.5">
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <span className={cn(isActive ? "text-primary" : "text-muted-foreground")}>{icon}</span>
        <span className="font-medium truncate flex-1">{table.name}</span>
        <span className="text-[9px] text-muted-foreground">{table.rows.length}</span>
      </div>
      {isExpanded && (
        <div className="ml-7 pl-1.5 border-l border-border space-y-0.5 mt-0.5 mb-1">
          {table.columns.slice(0, 12).map((col) => (
            <div key={col.name} className="flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <span className={cn(
                "w-1.5 h-1.5 rounded-full",
                col.type === "number" ? "bg-blue-500" : col.type === "date" ? "bg-amber-500" : "bg-gray-400"
              )} />
              <span className="truncate">{col.name}</span>
            </div>
          ))}
          {table.columns.length > 12 && (
            <div className="px-1.5 text-[10px] text-muted-foreground/70">+{table.columns.length - 12} more</div>
          )}
        </div>
      )}
    </div>
  );
}

function OperationCard({ op, tablesById, onRemove, onClick, isActive }: {
  op: Operation; tablesById: Map<string, Table>; onRemove: () => void; onClick: () => void; isActive: boolean;
}) {
  const out = tablesById.get(`out-${op.id}`);
  const summary = (() => {
    if (op.type === "join") {
      const l = tablesById.get(op.leftTableId)?.name || "?";
      const r = tablesById.get(op.rightTableId)?.name || "?";
      return `${l} ⨝ ${r}`;
    }
    if (op.type === "filter") return `${op.column} ${op.op.replace(/_/g, " ")} ${op.value}`;
    if (op.type === "aggregate") return `Group by ${op.groupBy.join(", ")}`;
    if (op.type === "calculated") return `+ ${op.newColumn}`;
    return "";
  })();

  const colorClass = op.type === "join" ? "bg-purple-50 text-purple-700 border-purple-200"
    : op.type === "filter" ? "bg-amber-50 text-amber-700 border-amber-200"
    : op.type === "aggregate" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-cyan-50 text-cyan-700 border-cyan-200";

  return (
    <div
      onClick={onClick}
      className={cn(
        "group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-medium cursor-pointer transition-all",
        colorClass,
        isActive ? "ring-2 ring-primary/40" : ""
      )}
    >
      {opIcon(op.type)}
      <span className="font-semibold capitalize">{op.type}:</span>
      <span className="opacity-80">{summary}</span>
      {out && <span className="opacity-60 ml-1">({out.rows.length})</span>}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="ml-1 opacity-0 group-hover:opacity-100 hover:bg-white/50 rounded p-0.5"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function DataGrid({ table, maxRows }: { table: Table; maxRows: number }) {
  const cols = table.columns;
  const rows = table.rows.slice(0, maxRows);

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No data to display
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-white">
      <div className="overflow-auto max-h-full">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 sticky top-0">
            <tr>
              {cols.map((col) => (
                <th key={col.name} className="px-3 py-2 text-left font-semibold text-foreground border-b border-border whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full flex-shrink-0",
                      col.type === "number" ? "bg-blue-500" : col.type === "date" ? "bg-amber-500" : "bg-gray-400"
                    )} />
                    {col.name}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={cn("border-b border-border last:border-b-0", i % 2 === 1 ? "bg-muted/10" : "")}>
                {cols.map((col) => {
                  const v = row[col.name];
                  return (
                    <td key={col.name} className={cn("px-3 py-1.5 whitespace-nowrap", col.type === "number" ? "text-right font-mono" : "")}>
                      {v === null || v === undefined ? <span className="text-muted-foreground/40">—</span>
                        : typeof v === "number" ? formatNum(v)
                        : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {table.rows.length > maxRows && (
          <div className="px-3 py-2 text-[10px] text-muted-foreground bg-muted/20 border-t border-border text-center">
            Showing first {maxRows.toLocaleString()} of {table.rows.length.toLocaleString()} rows
          </div>
        )}
      </div>
    </div>
  );
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function OperationModal({ type, tables, onClose, onAdd }: {
  type: Exclude<AddingOpType, null>;
  tables: Table[];
  onClose: () => void;
  onAdd: (op: Operation) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-150">
      <Card className="w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-foreground capitalize flex items-center gap-2">
              {opIcon(type === "calculated" ? "calculated" : type)}
              Add {type === "calculated" ? "Calculated Column" : type}
            </h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {type === "join" && <JoinForm tables={tables} onAdd={onAdd} />}
          {type === "filter" && <FilterForm tables={tables} onAdd={onAdd} />}
          {type === "aggregate" && <AggregateForm tables={tables} onAdd={onAdd} />}
          {type === "calculated" && <CalculatedForm tables={tables} onAdd={onAdd} />}
        </CardContent>
      </Card>
    </div>
  );
}

function Select({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2.5 py-1.5 text-xs border border-border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

function JoinForm({ tables, onAdd }: { tables: Table[]; onAdd: (op: JoinOperation) => void }) {
  const [leftId, setLeftId] = useState(tables[0]?.id || "");
  const [rightId, setRightId] = useState(tables[1]?.id || "");
  const [leftKey, setLeftKey] = useState("");
  const [rightKey, setRightKey] = useState("");
  const [joinType, setJoinType] = useState<JoinType>("inner");

  const left = tables.find((t) => t.id === leftId);
  const right = tables.find((t) => t.id === rightId);

  const submit = () => {
    if (!leftId || !rightId || !leftKey || !rightKey || leftId === rightId) return;
    onAdd({
      id: `op-${Date.now()}`,
      type: "join",
      leftTableId: leftId,
      rightTableId: rightId,
      leftKey,
      rightKey,
      joinType,
    });
  };

  const tableOpts = tables.map((t) => ({ value: t.id, label: `${t.name} (${t.rows.length})` }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Left Table">
          <Select value={leftId} onChange={setLeftId} options={tableOpts} />
        </Field>
        <Field label="Right Table">
          <Select value={rightId} onChange={setRightId} options={tableOpts} />
        </Field>
      </div>
      <Field label="Join Type">
        <div className="grid grid-cols-4 gap-1.5">
          {(["inner", "left", "right", "outer"] as JoinType[]).map((jt) => (
            <button
              key={jt}
              onClick={() => setJoinType(jt)}
              className={cn(
                "py-1.5 text-[11px] font-medium rounded-md border capitalize transition-colors",
                joinType === jt ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-muted-foreground"
              )}
            >
              {jt}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Left Key">
          <Select
            value={leftKey} onChange={setLeftKey} placeholder="Select column"
            options={(left?.columns || []).map((c) => ({ value: c.name, label: c.name }))}
          />
        </Field>
        <Field label="Right Key">
          <Select
            value={rightKey} onChange={setRightKey} placeholder="Select column"
            options={(right?.columns || []).map((c) => ({ value: c.name, label: c.name }))}
          />
        </Field>
      </div>
      <Button onClick={submit} className="w-full" disabled={!leftKey || !rightKey || leftId === rightId}>
        Add Join
      </Button>
    </div>
  );
}

function FilterForm({ tables, onAdd }: { tables: Table[]; onAdd: (op: FilterOperation) => void }) {
  const [tableId, setTableId] = useState(tables[tables.length - 1]?.id || "");
  const [column, setColumn] = useState("");
  const [op, setOp] = useState<FilterOp>("equals");
  const [value, setValue] = useState("");

  const table = tables.find((t) => t.id === tableId);

  const submit = () => {
    if (!tableId || !column) return;
    onAdd({
      id: `op-${Date.now()}`,
      type: "filter",
      inputTableId: tableId,
      column,
      op,
      value,
    });
  };

  return (
    <div className="space-y-3">
      <Field label="Table">
        <Select
          value={tableId} onChange={setTableId}
          options={tables.map((t) => ({ value: t.id, label: `${t.name} (${t.rows.length})` }))}
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Column">
          <Select
            value={column} onChange={setColumn} placeholder="Select"
            options={(table?.columns || []).map((c) => ({ value: c.name, label: c.name }))}
          />
        </Field>
        <Field label="Operator">
          <Select
            value={op} onChange={(v) => setOp(v as FilterOp)}
            options={[
              { value: "equals", label: "equals" },
              { value: "not_equals", label: "not equals" },
              { value: "greater", label: ">" },
              { value: "greater_equal", label: "≥" },
              { value: "less", label: "<" },
              { value: "less_equal", label: "≤" },
              { value: "contains", label: "contains" },
              { value: "not_contains", label: "not contains" },
              { value: "in", label: "in (a,b,c)" },
              { value: "is_null", label: "is null" },
              { value: "is_not_null", label: "is not null" },
            ]}
          />
        </Field>
        <Field label="Value">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Value"
            disabled={op === "is_null" || op === "is_not_null"}
            className="w-full px-2.5 py-1.5 text-xs border border-border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:bg-muted disabled:opacity-50"
          />
        </Field>
      </div>
      <Button onClick={submit} className="w-full" disabled={!column}>
        Add Filter
      </Button>
    </div>
  );
}

function AggregateForm({ tables, onAdd }: { tables: Table[]; onAdd: (op: AggregateOperation) => void }) {
  const [tableId, setTableId] = useState(tables[tables.length - 1]?.id || "");
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [aggregations, setAggregations] = useState<{ column: string; func: AggFunc; alias: string }[]>([
    { column: "", func: "sum", alias: "" },
  ]);

  const table = tables.find((t) => t.id === tableId);
  const colOpts = (table?.columns || []).map((c) => ({ value: c.name, label: `${c.name} (${c.type})` }));
  const numColOpts = (table?.columns || []).filter((c) => c.type === "number").map((c) => ({ value: c.name, label: c.name }));

  const toggleGroupBy = (col: string) => {
    setGroupBy((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]);
  };

  const updateAgg = (i: number, patch: Partial<typeof aggregations[0]>) => {
    setAggregations((prev) => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  };

  const submit = () => {
    if (!tableId || groupBy.length === 0) return;
    const validAggs = aggregations.filter((a) => a.column || a.func === "count");
    if (validAggs.length === 0) return;
    onAdd({
      id: `op-${Date.now()}`,
      type: "aggregate",
      inputTableId: tableId,
      groupBy,
      aggregations: validAggs.map((a) => ({
        column: a.column || groupBy[0],
        func: a.func,
        alias: a.alias || `${a.func}_${a.column || "rows"}`,
      })),
    });
  };

  return (
    <div className="space-y-3">
      <Field label="Table">
        <Select
          value={tableId} onChange={setTableId}
          options={tables.map((t) => ({ value: t.id, label: `${t.name} (${t.rows.length})` }))}
        />
      </Field>
      <Field label="Group By">
        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 border border-border rounded-md bg-muted/20">
          {(table?.columns || []).map((c) => (
            <button
              key={c.name}
              onClick={() => toggleGroupBy(c.name)}
              className={cn(
                "px-2 py-1 text-[10px] rounded-md border",
                groupBy.includes(c.name)
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-white hover:border-muted-foreground"
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Aggregations">
        <div className="space-y-1.5">
          {aggregations.map((a, i) => (
            <div key={i} className="grid grid-cols-12 gap-1.5">
              <div className="col-span-3">
                <Select
                  value={a.func} onChange={(v) => updateAgg(i, { func: v as AggFunc })}
                  options={[
                    { value: "sum", label: "Sum" },
                    { value: "avg", label: "Avg" },
                    { value: "count", label: "Count" },
                    { value: "count_distinct", label: "Count Distinct" },
                    { value: "min", label: "Min" },
                    { value: "max", label: "Max" },
                    { value: "first", label: "First" },
                  ]}
                />
              </div>
              <div className="col-span-4">
                <Select
                  value={a.column} onChange={(v) => updateAgg(i, { column: v })}
                  placeholder={a.func === "count" ? "(rows)" : "Column"}
                  options={(a.func === "sum" || a.func === "avg" || a.func === "min" || a.func === "max") ? numColOpts : colOpts}
                />
              </div>
              <div className="col-span-4">
                <input
                  value={a.alias}
                  onChange={(e) => updateAgg(i, { alias: e.target.value })}
                  placeholder="Alias (optional)"
                  className="w-full px-2.5 py-1.5 text-xs border border-border rounded-md bg-white"
                />
              </div>
              <button
                onClick={() => setAggregations((prev) => prev.filter((_, idx) => idx !== i))}
                className="col-span-1 flex items-center justify-center text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setAggregations((prev) => [...prev, { column: "", func: "sum", alias: "" }])}
            className="text-[11px] text-primary hover:underline flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add aggregation
          </button>
        </div>
      </Field>
      <Button onClick={submit} className="w-full" disabled={groupBy.length === 0}>
        Add Aggregation
      </Button>
    </div>
  );
}

function CalculatedForm({ tables, onAdd }: { tables: Table[]; onAdd: (op: CalculatedColumnOperation) => void }) {
  const [tableId, setTableId] = useState(tables[tables.length - 1]?.id || "");
  const [newColumn, setNewColumn] = useState("");
  const [expression, setExpression] = useState("");

  const table = tables.find((t) => t.id === tableId);

  const submit = () => {
    if (!tableId || !newColumn || !expression) return;
    onAdd({
      id: `op-${Date.now()}`,
      type: "calculated",
      inputTableId: tableId,
      newColumn,
      expression,
    });
  };

  return (
    <div className="space-y-3">
      <Field label="Table">
        <Select
          value={tableId} onChange={setTableId}
          options={tables.map((t) => ({ value: t.id, label: `${t.name} (${t.rows.length})` }))}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="New Column Name">
          <input
            value={newColumn}
            onChange={(e) => setNewColumn(e.target.value)}
            placeholder="e.g. profit"
            className="w-full px-2.5 py-1.5 text-xs border border-border rounded-md bg-white"
          />
        </Field>
        <Field label="Expression (JavaScript)">
          <input
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            placeholder="e.g. Revenue - Cost"
            className="w-full px-2.5 py-1.5 text-xs border border-border rounded-md bg-white font-mono"
          />
        </Field>
      </div>
      <div className="text-[10px] text-muted-foreground bg-muted/40 p-2 rounded-md">
        <strong>Available columns:</strong>{" "}
        {(table?.columns || []).filter((c) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c.name)).slice(0, 10).map((c) => (
          <code key={c.name} className="px-1 mx-0.5 bg-white rounded">{c.name}</code>
        ))}
        <div className="mt-1">Examples: <code className="bg-white px-1 rounded">price * 1.1</code>, <code className="bg-white px-1 rounded">revenue - cost</code></div>
      </div>
      <Button onClick={submit} className="w-full" disabled={!newColumn || !expression}>
        Add Calculated Column
      </Button>
    </div>
  );
}
