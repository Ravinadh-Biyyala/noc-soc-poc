import * as XLSX from "xlsx";

export interface ParsedSheet {
  name: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  columnNames: string[];
  truncated: boolean;
  returnedRowCount: number;
}

// Mirror the cap from /api/upload — keeps the response payload + DB row blob
// small enough for snappy UX while still letting the AI see real cardinality.
export const MAX_ROWS_PER_SHEET = 100_000;

export function parseWorkbookBuffer(
  buffer: Buffer,
): { fileName?: string; sheets: ParsedSheet[] } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheets: ParsedSheet[] = [];
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
    if (json.length === 0) continue;
    const truncated = json.length > MAX_ROWS_PER_SHEET;
    const rows = truncated ? json.slice(0, MAX_ROWS_PER_SHEET) : json;
    sheets.push({
      name,
      rows,
      rowCount: json.length,
      columnNames: Object.keys(json[0]),
      truncated,
      returnedRowCount: rows.length,
    });
  }
  return { sheets };
}
