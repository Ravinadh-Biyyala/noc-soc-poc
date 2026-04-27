export type JoinType = "inner" | "left" | "right" | "outer";
export type FilterOp = "equals" | "not_equals" | "greater" | "less" | "greater_equal" | "less_equal" | "contains" | "not_contains" | "in" | "is_null" | "is_not_null";
export type AggFunc = "sum" | "avg" | "count" | "count_distinct" | "min" | "max" | "first";

export interface Column {
  name: string;
  type: string;
}

export interface Table {
  id: string;
  name: string;
  rows: Record<string, unknown>[];
  columns: Column[];
  sourceFile?: string;
}

export interface JoinOperation {
  id: string;
  type: "join";
  leftTableId: string;
  rightTableId: string;
  leftKey: string;
  rightKey: string;
  joinType: JoinType;
  outputName?: string;
}

export interface FilterOperation {
  id: string;
  type: "filter";
  inputTableId: string;
  column: string;
  op: FilterOp;
  value: string | number;
  outputName?: string;
}

export interface AggregateOperation {
  id: string;
  type: "aggregate";
  inputTableId: string;
  groupBy: string[];
  aggregations: { column: string; func: AggFunc; alias?: string }[];
  outputName?: string;
}

export interface CalculatedColumnOperation {
  id: string;
  type: "calculated";
  inputTableId: string;
  newColumn: string;
  expression: string;
  outputName?: string;
}

export type Operation = JoinOperation | FilterOperation | AggregateOperation | CalculatedColumnOperation;

function refineColumnTypes(columns: Column[], rows: Record<string, unknown>[]): Column[] {
  if (rows.length === 0) return columns;
  return columns.map((col) => {
    const samples = rows.slice(0, 50).map((r) => r[col.name]).filter((v) => v !== null && v !== undefined && v !== "");
    if (samples.length === 0) return col;
    const numCount = samples.filter((v) => typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)) && v !== "")).length;
    const type = numCount / samples.length > 0.8 ? "number" : "string";
    return { name: col.name, type };
  });
}

function makeKey(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return `n:${value}`;
  if (typeof value === "boolean") return `b:${value}`;
  if (value instanceof Date) return `d:${value.getTime()}`;
  return `s:${String(value)}`;
}

function makeCompositeKey(values: unknown[]): string {
  return values.map((v) => makeKey(v) ?? "∅").join("\x00");
}

// ============================================================================
// Safe expression evaluator for calculated columns
// Supports: numbers, strings, column refs, + - * / %, comparisons, && || !,
// ternary cond?a:b, parens, function calls.
// No access to globals, no `new Function`, no property access.
// ============================================================================

type Token =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "id"; value: string }
  | { kind: "op"; value: string }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" }
  | { kind: "qmark" }
  | { kind: "colon" };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "(") { tokens.push({ kind: "lparen" }); i++; continue; }
    if (c === ")") { tokens.push({ kind: "rparen" }); i++; continue; }
    if (c === ",") { tokens.push({ kind: "comma" }); i++; continue; }
    if (c === "?") { tokens.push({ kind: "qmark" }); i++; continue; }
    if (c === ":") { tokens.push({ kind: "colon" }); i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c; i++;
      let s = "";
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < src.length) { s += src[i + 1]; i += 2; }
        else { s += src[i]; i++; }
      }
      if (src[i] !== quote) throw new Error("Unterminated string");
      i++;
      tokens.push({ kind: "str", value: s });
      continue;
    }
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      let s = "";
      while (i < src.length && ((src[i] >= "0" && src[i] <= "9") || src[i] === ".")) { s += src[i]; i++; }
      tokens.push({ kind: "num", value: Number(s) });
      continue;
    }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      let s = "";
      while (i < src.length && ((src[i] >= "a" && src[i] <= "z") || (src[i] >= "A" && src[i] <= "Z") || (src[i] >= "0" && src[i] <= "9") || src[i] === "_")) { s += src[i]; i++; }
      tokens.push({ kind: "id", value: s });
      continue;
    }
    // Multi-char operators first
    const two = src.slice(i, i + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||") {
      tokens.push({ kind: "op", value: two });
      i += 2;
      continue;
    }
    if ("+-*/%<>!".includes(c)) {
      tokens.push({ kind: "op", value: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character: ${c}`);
  }
  return tokens;
}

const SAFE_FUNCS: Record<string, (...args: any[]) => any> = {
  ABS: (x) => Math.abs(Number(x)),
  ROUND: (x, d = 0) => { const m = Math.pow(10, Number(d)); return Math.round(Number(x) * m) / m; },
  FLOOR: (x) => Math.floor(Number(x)),
  CEIL: (x) => Math.ceil(Number(x)),
  MIN: (...a) => Math.min(...a.map(Number)),
  MAX: (...a) => Math.max(...a.map(Number)),
  IF: (c, a, b) => (c ? a : b),
  COALESCE: (...a) => a.find((v) => v !== null && v !== undefined && v !== "") ?? null,
  UPPER: (x) => String(x ?? "").toUpperCase(),
  LOWER: (x) => String(x ?? "").toLowerCase(),
  CONCAT: (...a) => a.map((v) => String(v ?? "")).join(""),
  LEN: (x) => String(x ?? "").length,
  NUMBER: (x) => Number(x),
  STRING: (x) => String(x ?? ""),
  ISNULL: (x) => x === null || x === undefined || x === "",
};

const KEYWORDS: Record<string, unknown> = { true: true, false: false, null: null };

class Parser {
  pos = 0;
  constructor(private tokens: Token[]) {}
  peek() { return this.tokens[this.pos]; }
  eat() { return this.tokens[this.pos++]; }
  expect(kind: Token["kind"], value?: string) {
    const t = this.eat();
    if (!t || t.kind !== kind || (value !== undefined && (t as any).value !== value)) {
      throw new Error(`Expected ${kind}${value ? " " + value : ""}`);
    }
    return t;
  }
}

type Node =
  | { type: "num"; value: number }
  | { type: "str"; value: string }
  | { type: "id"; name: string }
  | { type: "lit"; value: unknown }
  | { type: "unary"; op: string; arg: Node }
  | { type: "binary"; op: string; left: Node; right: Node }
  | { type: "ternary"; cond: Node; then: Node; alt: Node }
  | { type: "call"; name: string; args: Node[] };

function parseExpr(p: Parser): Node {
  return parseTernary(p);
}
function parseTernary(p: Parser): Node {
  const cond = parseOr(p);
  if (p.peek()?.kind === "qmark") {
    p.eat();
    const then = parseExpr(p);
    p.expect("colon");
    const alt = parseExpr(p);
    return { type: "ternary", cond, then, alt };
  }
  return cond;
}
function parseOr(p: Parser): Node {
  let left = parseAnd(p);
  while (p.peek()?.kind === "op" && (p.peek() as any).value === "||") { p.eat(); left = { type: "binary", op: "||", left, right: parseAnd(p) }; }
  return left;
}
function parseAnd(p: Parser): Node {
  let left = parseEquality(p);
  while (p.peek()?.kind === "op" && (p.peek() as any).value === "&&") { p.eat(); left = { type: "binary", op: "&&", left, right: parseEquality(p) }; }
  return left;
}
function parseEquality(p: Parser): Node {
  let left = parseCompare(p);
  while (p.peek()?.kind === "op" && ((p.peek() as any).value === "==" || (p.peek() as any).value === "!=")) {
    const op = (p.eat() as any).value; left = { type: "binary", op, left, right: parseCompare(p) };
  }
  return left;
}
function parseCompare(p: Parser): Node {
  let left = parseAddSub(p);
  while (p.peek()?.kind === "op" && ["<", ">", "<=", ">="].includes((p.peek() as any).value)) {
    const op = (p.eat() as any).value; left = { type: "binary", op, left, right: parseAddSub(p) };
  }
  return left;
}
function parseAddSub(p: Parser): Node {
  let left = parseMulDiv(p);
  while (p.peek()?.kind === "op" && ["+", "-"].includes((p.peek() as any).value)) {
    const op = (p.eat() as any).value; left = { type: "binary", op, left, right: parseMulDiv(p) };
  }
  return left;
}
function parseMulDiv(p: Parser): Node {
  let left = parseUnary(p);
  while (p.peek()?.kind === "op" && ["*", "/", "%"].includes((p.peek() as any).value)) {
    const op = (p.eat() as any).value; left = { type: "binary", op, left, right: parseUnary(p) };
  }
  return left;
}
function parseUnary(p: Parser): Node {
  const t = p.peek();
  if (t?.kind === "op" && (t.value === "-" || t.value === "!" || t.value === "+")) {
    const op = (p.eat() as any).value;
    return { type: "unary", op, arg: parseUnary(p) };
  }
  return parsePrimary(p);
}
function parsePrimary(p: Parser): Node {
  const t = p.eat();
  if (!t) throw new Error("Unexpected end of expression");
  if (t.kind === "num") return { type: "num", value: t.value };
  if (t.kind === "str") return { type: "str", value: t.value };
  if (t.kind === "lparen") {
    const e = parseExpr(p);
    p.expect("rparen");
    return e;
  }
  if (t.kind === "id") {
    if (p.peek()?.kind === "lparen") {
      p.eat();
      const args: Node[] = [];
      if (p.peek()?.kind !== "rparen") {
        args.push(parseExpr(p));
        while (p.peek()?.kind === "comma") { p.eat(); args.push(parseExpr(p)); }
      }
      p.expect("rparen");
      return { type: "call", name: t.value.toUpperCase(), args };
    }
    if (t.value in KEYWORDS) return { type: "lit", value: KEYWORDS[t.value] };
    return { type: "id", name: t.value };
  }
  throw new Error(`Unexpected token`);
}

function evalNode(node: Node, row: Record<string, unknown>): unknown {
  switch (node.type) {
    case "num": return node.value;
    case "str": return node.value;
    case "lit": return node.value;
    case "id": return row[node.name] ?? null;
    case "unary": {
      const v = evalNode(node.arg, row);
      if (node.op === "-") return -Number(v);
      if (node.op === "+") return +Number(v);
      if (node.op === "!") return !v;
      return null;
    }
    case "binary": {
      // short-circuit
      if (node.op === "&&") return evalNode(node.left, row) && evalNode(node.right, row);
      if (node.op === "||") return evalNode(node.left, row) || evalNode(node.right, row);
      const l = evalNode(node.left, row);
      const r = evalNode(node.right, row);
      switch (node.op) {
        case "+":
          if (typeof l === "string" || typeof r === "string") return String(l ?? "") + String(r ?? "");
          return Number(l) + Number(r);
        case "-": return Number(l) - Number(r);
        case "*": return Number(l) * Number(r);
        case "/": { const rn = Number(r); return rn === 0 ? null : Number(l) / rn; }
        case "%": { const rn = Number(r); return rn === 0 ? null : Number(l) % rn; }
        case "==": return l === r || String(l) === String(r);
        case "!=": return !(l === r || String(l) === String(r));
        case "<": return Number(l) < Number(r);
        case ">": return Number(l) > Number(r);
        case "<=": return Number(l) <= Number(r);
        case ">=": return Number(l) >= Number(r);
      }
      return null;
    }
    case "ternary": return evalNode(node.cond, row) ? evalNode(node.then, row) : evalNode(node.alt, row);
    case "call": {
      const fn = SAFE_FUNCS[node.name];
      if (!fn) throw new Error(`Unknown function: ${node.name}`);
      return fn(...node.args.map((a) => evalNode(a, row)));
    }
  }
}

export function safeEvalExpression(expression: string, row: Record<string, unknown>): unknown {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  const ast = parseExpr(parser);
  if (parser.pos < tokens.length) throw new Error("Unexpected trailing tokens");
  return evalNode(ast, row);
}

// ============================================================================
// Operations
// ============================================================================

function joinedColumns(left: Table, right: Table, rightKey: string): Column[] {
  const leftNames = new Set(left.columns.map((c) => c.name));
  const out: Column[] = [...left.columns];
  for (const c of right.columns) {
    if (c.name === rightKey) continue;
    if (leftNames.has(c.name)) out.push({ name: `${right.name}_${c.name}`, type: c.type });
    else out.push(c);
  }
  return out;
}

export function performJoin(left: Table, right: Table, op: JoinOperation): Table {
  const { leftKey, rightKey, joinType } = op;
  const expectedColumns = joinedColumns(left, right, rightKey);
  const expectedNames = expectedColumns.map((c) => c.name);
  const leftNames = new Set(left.columns.map((c) => c.name));

  const rightIndex = new Map<string, Record<string, unknown>[]>();
  for (const row of right.rows) {
    const key = makeKey(row[rightKey]);
    if (key === null) continue; // null keys never match
    if (!rightIndex.has(key)) rightIndex.set(key, []);
    rightIndex.get(key)!.push(row);
  }

  const blankRow = (): Record<string, unknown> => {
    const r: Record<string, unknown> = {};
    for (const n of expectedNames) r[n] = null;
    return r;
  };

  const merge = (l: Record<string, unknown>, r: Record<string, unknown> | null): Record<string, unknown> => {
    const out = blankRow();
    for (const c of left.columns) out[c.name] = l[c.name] ?? null;
    if (r) {
      for (const c of right.columns) {
        if (c.name === rightKey) continue;
        const target = leftNames.has(c.name) ? `${right.name}_${c.name}` : c.name;
        out[target] = r[c.name] ?? null;
      }
    }
    return out;
  };

  const result: Record<string, unknown>[] = [];

  for (const lRow of left.rows) {
    const key = makeKey(lRow[leftKey]);
    const matches = key !== null ? rightIndex.get(key) : undefined;
    if (matches && matches.length > 0) {
      for (const rRow of matches) result.push(merge(lRow, rRow));
    } else if (joinType === "left" || joinType === "outer") {
      result.push(merge(lRow, null));
    }
  }

  if (joinType === "right" || joinType === "outer") {
    const matchedRightKeys = new Set<string>();
    for (const lRow of left.rows) {
      const k = makeKey(lRow[leftKey]);
      if (k !== null && rightIndex.has(k)) matchedRightKeys.add(k);
    }
    for (const rRow of right.rows) {
      const key = makeKey(rRow[rightKey]);
      // Right rows with null keys never match, so always include them as unmatched
      if (key !== null && matchedRightKeys.has(key)) continue;
      const merged = blankRow();
      // Mirror right key into left key column
      merged[leftKey] = rRow[rightKey];
      for (const c of right.columns) {
        if (c.name === rightKey) continue;
        const target = leftNames.has(c.name) ? `${right.name}_${c.name}` : c.name;
        merged[target] = rRow[c.name] ?? null;
      }
      result.push(merged);
    }
  }

  const name = op.outputName || `${left.name}_join_${right.name}`;
  return { id: `out-${op.id}`, name, rows: result, columns: refineColumnTypes(expectedColumns, result) };
}

export function performFilter(input: Table, op: FilterOperation): Table {
  const { column, op: filterOp, value } = op;
  const numValue = Number(value);
  const isNum = !isNaN(numValue) && value !== "";
  const valueStr = String(value).toLowerCase();

  const rows = input.rows.filter((row) => {
    const v = row[column];
    if (filterOp === "is_null") return v === null || v === undefined || v === "";
    if (filterOp === "is_not_null") return v !== null && v !== undefined && v !== "";
    if (v === null || v === undefined) return false;

    if (filterOp === "equals") return String(v) === String(value);
    if (filterOp === "not_equals") return String(v) !== String(value);
    if (filterOp === "greater") return isNum && Number(v) > numValue;
    if (filterOp === "less") return isNum && Number(v) < numValue;
    if (filterOp === "greater_equal") return isNum && Number(v) >= numValue;
    if (filterOp === "less_equal") return isNum && Number(v) <= numValue;
    if (filterOp === "contains") return String(v).toLowerCase().includes(valueStr);
    if (filterOp === "not_contains") return !String(v).toLowerCase().includes(valueStr);
    if (filterOp === "in") {
      const items = String(value).split(",").map((s) => s.trim().toLowerCase());
      return items.includes(String(v).toLowerCase());
    }
    return true;
  });

  const name = op.outputName || `${input.name}_filtered`;
  return { id: `out-${op.id}`, name, rows, columns: input.columns };
}

export function performAggregate(input: Table, op: AggregateOperation): Table {
  const { groupBy, aggregations } = op;
  const groups = new Map<string, Record<string, unknown>[]>();

  for (const row of input.rows) {
    const key = makeCompositeKey(groupBy.map((g) => row[g]));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const expectedColumns: Column[] = [];
  for (const g of groupBy) {
    const src = input.columns.find((c) => c.name === g);
    expectedColumns.push({ name: g, type: src?.type || "string" });
  }
  for (const agg of aggregations) {
    const alias = agg.alias || `${agg.func}_${agg.column}`;
    expectedColumns.push({ name: alias, type: "number" });
  }

  const rows: Record<string, unknown>[] = [];
  for (const [, groupRows] of groups) {
    const out: Record<string, unknown> = {};
    for (const g of groupBy) out[g] = groupRows[0][g];

    for (const agg of aggregations) {
      const alias = agg.alias || `${agg.func}_${agg.column}`;
      const values = groupRows.map((r) => r[agg.column]);
      const nums = values.map(Number).filter((n) => !isNaN(n));

      if (agg.func === "count") out[alias] = groupRows.length;
      else if (agg.func === "count_distinct") out[alias] = new Set(values.map(String)).size;
      else if (agg.func === "sum") out[alias] = nums.reduce((a, b) => a + b, 0);
      else if (agg.func === "avg") out[alias] = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      else if (agg.func === "min") out[alias] = nums.length > 0 ? Math.min(...nums) : null;
      else if (agg.func === "max") out[alias] = nums.length > 0 ? Math.max(...nums) : null;
      else if (agg.func === "first") out[alias] = values[0];
    }
    rows.push(out);
  }

  const name = op.outputName || `${input.name}_grouped`;
  return { id: `out-${op.id}`, name, rows, columns: refineColumnTypes(expectedColumns, rows) };
}

export function performCalculated(input: Table, op: CalculatedColumnOperation): Table {
  const { newColumn, expression } = op;

  // Pre-parse once for safety + perf
  let ast: Node | null = null;
  let parseError: string | null = null;
  try {
    const tokens = tokenize(expression);
    const parser = new Parser(tokens);
    ast = parseExpr(parser);
    if (parser.pos < tokens.length) throw new Error("Unexpected trailing tokens");
  } catch (e: any) {
    parseError = e?.message || "Invalid expression";
  }

  const rows = input.rows.map((row) => {
    const out = { ...row };
    if (parseError || !ast) {
      out[newColumn] = null;
    } else {
      try {
        out[newColumn] = evalNode(ast, row);
      } catch {
        out[newColumn] = null;
      }
    }
    return out;
  });

  const expectedColumns: Column[] = [
    ...input.columns.filter((c) => c.name !== newColumn),
    { name: newColumn, type: "string" },
  ];

  const name = op.outputName || input.name;
  return { id: `out-${op.id}`, name, rows, columns: refineColumnTypes(expectedColumns, rows) };
}

export function executeOperation(op: Operation, tablesById: Map<string, Table>): Table | null {
  if (op.type === "join") {
    const left = tablesById.get(op.leftTableId);
    const right = tablesById.get(op.rightTableId);
    if (!left || !right) return null;
    return performJoin(left, right, op);
  }
  if (op.type === "filter") {
    const input = tablesById.get(op.inputTableId);
    if (!input) return null;
    return performFilter(input, op);
  }
  if (op.type === "aggregate") {
    const input = tablesById.get(op.inputTableId);
    if (!input) return null;
    return performAggregate(input, op);
  }
  if (op.type === "calculated") {
    const input = tablesById.get(op.inputTableId);
    if (!input) return null;
    return performCalculated(input, op);
  }
  return null;
}

export function executePipeline(sourceTables: Table[], operations: Operation[]): { tables: Table[]; tablesById: Map<string, Table> } {
  const tablesById = new Map<string, Table>();
  for (const t of sourceTables) tablesById.set(t.id, t);

  const allTables = [...sourceTables];
  for (const op of operations) {
    const result = executeOperation(op, tablesById);
    if (result) {
      tablesById.set(result.id, result);
      allTables.push(result);
    }
  }
  return { tables: allTables, tablesById };
}

export function getOperationInputs(op: Operation): string[] {
  if (op.type === "join") return [op.leftTableId, op.rightTableId];
  return [op.inputTableId];
}

// ============================================================================
// Join suggestions (heuristic, runs locally — no AI call needed)
// ============================================================================

export interface JoinSuggestion {
  leftTableId: string;
  leftTableName: string;
  rightTableId: string;
  rightTableName: string;
  leftKey: string;
  rightKey: string;
  /** 0..1 confidence score combining name + value overlap */
  score: number;
  /** percent of right values that appear in left */
  overlap: number;
  /** plain-English explanation of why this join makes sense */
  reason: string;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[_\s\-]/g, "");
}

function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1.0;
  if (na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na))) return 0.75;
  // Suffix-id heuristic: customerid ↔ id, productid ↔ id, etc.
  const stripId = (x: string) => x.endsWith("id") ? x.slice(0, -2) : x;
  if (stripId(na) && stripId(na) === stripId(nb)) return 0.7;
  // Char overlap (Jaccard on bigrams)
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ba = bigrams(na), bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return 0;
  let inter = 0;
  for (const g of ba) if (bb.has(g)) inter++;
  const jacc = inter / (ba.size + bb.size - inter);
  return jacc >= 0.5 ? jacc : 0;
}

function valueOverlap(left: Table, right: Table, lk: string, rk: string): { overlap: number; matched: number; rightDistinct: number } {
  const SAMPLE = 300;
  const leftKeys = new Set<string>();
  for (const r of left.rows.slice(0, SAMPLE)) {
    const k = makeKey(r[lk]);
    if (k !== null) leftKeys.add(k);
  }
  const rightDistinct = new Set<string>();
  let matched = 0;
  for (const r of right.rows.slice(0, SAMPLE)) {
    const k = makeKey(r[rk]);
    if (k === null || rightDistinct.has(k)) continue;
    rightDistinct.add(k);
    if (leftKeys.has(k)) matched++;
  }
  return {
    overlap: rightDistinct.size === 0 ? 0 : matched / rightDistinct.size,
    matched,
    rightDistinct: rightDistinct.size,
  };
}

function buildReason(leftTable: string, rightTable: string, leftKey: string, rightKey: string, overlap: number, matched: number): string {
  const pct = Math.round(overlap * 100);
  const sameName = normalizeName(leftKey) === normalizeName(rightKey);
  if (sameName) {
    return `Both tables share a "${leftKey}" column and ${pct}% of values match (${matched} keys overlap). Looks like a key column.`;
  }
  return `"${leftTable}.${leftKey}" matches "${rightTable}.${rightKey}" with ${pct}% value overlap (${matched} keys).`;
}

export function suggestJoins(tables: Table[]): JoinSuggestion[] {
  if (tables.length < 2) return [];
  const candidates: JoinSuggestion[] = [];

  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const left = tables[i];
      const right = tables[j];

      let best: JoinSuggestion | null = null;
      for (const lc of left.columns) {
        for (const rc of right.columns) {
          const ns = nameSimilarity(lc.name, rc.name);
          if (ns < 0.5) continue;

          // Test in both orientations and use the better overlap
          const fwd = valueOverlap(left, right, lc.name, rc.name);
          const rev = valueOverlap(right, left, rc.name, lc.name);
          const overlap = Math.max(fwd.overlap, rev.overlap);
          const matched = Math.max(fwd.matched, rev.matched);
          if (overlap < 0.15) continue;

          const score = ns * 0.4 + overlap * 0.6;
          if (!best || score > best.score) {
            best = {
              leftTableId: left.id,
              leftTableName: left.name,
              rightTableId: right.id,
              rightTableName: right.name,
              leftKey: lc.name,
              rightKey: rc.name,
              score,
              overlap,
              reason: buildReason(left.name, right.name, lc.name, rc.name, overlap, matched),
            };
          }
        }
      }
      if (best) candidates.push(best);
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}
