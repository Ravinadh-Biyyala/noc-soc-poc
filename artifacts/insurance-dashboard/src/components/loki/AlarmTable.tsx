// Structured alarm table — shared by the dashboard "Top Critical Alarms" panel,
// the diagnosis drawer, and the chat's getTopAlarms render. Rows are clickable to
// drill into the device's health.

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { severityBadge, fmtAgo } from "@/lib/noc-format";
import type { AlarmRow } from "@/lib/loki-noc";

export interface AlarmTableProps {
  alarms: AlarmRow[];
  onDeviceClick?: (deviceId: string) => void;
  compact?: boolean;
}

export default function AlarmTable({ alarms, onDeviceClick, compact }: AlarmTableProps) {
  if (!alarms || alarms.length === 0) {
    return <p className="text-xs text-muted-foreground py-6 text-center">No alarms in this range.</p>;
  }
  return (
    <Table className="w-full table-fixed">
      <TableHeader>
        <TableRow className="border-border hover:bg-transparent">
          <TableHead className="h-8 text-[11px]">Alarm</TableHead>
          <TableHead className="h-8 text-[11px] w-[108px]">Device</TableHead>
          {!compact && <TableHead className="h-8 text-[11px] w-[84px]">Severity</TableHead>}
          <TableHead className="h-8 text-[11px] text-right w-[64px]">When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {alarms.map((a, i) => (
          <TableRow key={`${a.alert_id ?? i}`} className="border-border/60">
            <TableCell className="py-1.5">
              <div className="text-[11px] text-foreground truncate" title={a.message}>{a.message ?? "—"}</div>
              {!compact && a.category && <div className="text-[10px] text-muted-foreground truncate">{a.category}{a.model ? ` · ${a.model}` : ""}</div>}
            </TableCell>
            <TableCell className="py-1.5">
              {a.device_id ? (
                <button
                  className="block w-full truncate text-left text-[11px] font-mono text-cyan-300 hover:underline"
                  onClick={() => onDeviceClick?.(a.device_id!)}
                  title={`Open device health: ${a.device_id}`}
                >
                  {a.device_id}
                </button>
              ) : <span className="text-[11px] text-muted-foreground">—</span>}
            </TableCell>
            {!compact && (
              <TableCell className="py-1.5">
                <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityBadge(a.severity)}`}>
                  {a.severity ?? "—"}
                </span>
              </TableCell>
            )}
            <TableCell className="py-1.5 text-right text-[10px] text-muted-foreground whitespace-nowrap">{fmtAgo(a.ts)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
