import { useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Info, Download, FileText, Sparkles } from "lucide-react";
import { narrate, exportAuditorBundle, type ExplainContext } from "@/lib/explain";
import { useCopilot } from "@/lib/copilot-context";

interface ExplainPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: ExplainContext | null;
}

function renderInline(text: string): React.ReactNode {
  // Lightweight markdown for **bold** and `code` — keeps the panel readable
  // without pulling in a markdown library for three formatting marks.
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={`b-${i++}`} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>);
    } else {
      parts.push(<code key={`c-${i++}`} className="px-1 py-0.5 rounded bg-muted text-[11px]">{tok.slice(1, -1)}</code>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderBody(body: string): React.ReactNode {
  return body.split("\n").map((line, i) => (
    <div key={i} className={i > 0 ? "mt-1" : undefined}>{renderInline(line)}</div>
  ));
}

export function ExplainPanel({ open, onOpenChange, context }: ExplainPanelProps) {
  const { askCopilot } = useCopilot();
  const blocks = useMemo(() => (context ? narrate(context) : []), [context]);

  if (!context) return null;

  const handleExport = () => exportAuditorBundle(context, blocks);
  const handleAskCopilot = () => {
    const q =
      context.kind === "kpi"
        ? `Explain the ${context.title} KPI in detail and what's driving it.`
        : `Analyze the ${context.title} chart and tell me what's notable.`;
    askCopilot(q);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center">
              <Info className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-sm font-semibold text-foreground truncate">
                Why this {context.kind === "kpi" ? "number" : "chart"}?
              </SheetTitle>
              <SheetDescription className="text-[11px] text-muted-foreground truncate">
                {context.title}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-5 py-4 space-y-5">
            {blocks.map((b) => (
              <section key={b.heading} className="space-y-1.5">
                <h3 className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  {b.heading}
                </h3>
                <div className="text-[13px] leading-relaxed text-foreground/90">
                  {renderBody(b.body)}
                </div>
              </section>
            ))}

            <div className="pt-2 border-t">
              <h3 className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                Lineage badges
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {context.source && (
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    src: {context.source}
                  </Badge>
                )}
                {context.chartType && (
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    type: {context.chartType}
                  </Badge>
                )}
                {context.xKey && (
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    x: {context.xKey}
                  </Badge>
                )}
                {context.yKeys?.map((k) => (
                  <Badge key={k} variant="secondary" className="text-[10px] font-normal">
                    y: {k}
                  </Badge>
                ))}
                {typeof context.data?.length === "number" && (
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    rows: {context.data.length}
                  </Badge>
                )}
                {(context.operations ?? []).map((op, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] font-normal">
                    {op.kind}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="px-5 py-3 border-t bg-muted/30 flex flex-col gap-2">
          <Button onClick={handleExport} size="sm" className="w-full justify-start gap-2">
            <Download className="w-3.5 h-3.5" />
            Send to auditor (PDF + JSON)
          </Button>
          <div className="flex gap-2">
            <Button
              onClick={handleAskCopilot}
              size="sm"
              variant="outline"
              className="flex-1 justify-start gap-2"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Ask Copilot to dig in
            </Button>
            <Button
              onClick={() => exportAuditorBundle(context, blocks, { print: false })}
              size="sm"
              variant="outline"
              title="Download lineage JSON only"
            >
              <FileText className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Tiny ⓘ button used as the affordance on KPI cards and chart headers.
 * Stops propagation so it doesn't fire the parent card's askCopilot click.
 */
export function ExplainButton({
  onClick,
  className,
  label = "Explain",
}: {
  onClick: () => void;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
      className={
        "inline-flex items-center justify-center w-5 h-5 rounded-md text-muted-foreground/60 hover:text-primary hover:bg-primary/10 transition-colors flex-shrink-0 " +
        (className || "")
      }
    >
      <Info className="w-3 h-3" />
    </button>
  );
}
