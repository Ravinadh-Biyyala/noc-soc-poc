import { Upload, Brain, Sparkles, Link2, Hash, LayoutDashboard, MessageSquare, FileText, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "upload", label: "Upload", icon: Upload },
  { id: "understand", label: "Understand", icon: Brain },
  { id: "clean", label: "Clean", icon: Sparkles },
  { id: "join", label: "Join", icon: Link2 },
  { id: "metrics", label: "Metrics", icon: Hash },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "ask", label: "Ask", icon: MessageSquare },
  { id: "report", label: "Report", icon: FileText },
] as const;

export type StepStatus = "done" | "active" | "queued";

export interface WorkspaceStepperProps {
  /**
   * Current status per step. Missing entries default to "queued".
   * Today these are presentational; later phases will derive them from
   * workspace state (file ingestion, schema understanding, etc.).
   */
  statuses?: Partial<Record<typeof STEPS[number]["id"], StepStatus>>;
}

export function WorkspaceStepper({ statuses = {} }: WorkspaceStepperProps) {
  return (
    <div className="w-full overflow-x-auto">
      <ol className="flex items-center gap-1 min-w-max">
        {STEPS.map((step, idx) => {
          const status: StepStatus = statuses[step.id] ?? "queued";
          const Icon = step.icon;
          const isLast = idx === STEPS.length - 1;
          return (
            <li key={step.id} className="flex items-center gap-1">
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md border text-xs font-medium transition-colors",
                  status === "done" && "bg-emerald-50 border-emerald-200 text-emerald-700",
                  status === "active" && "bg-primary/10 border-primary/40 text-primary",
                  status === "queued" && "bg-muted/40 border-border text-muted-foreground",
                )}
                data-testid={`stepper-${step.id}`}
              >
                <span
                  className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0",
                    status === "done" && "bg-emerald-500 text-white",
                    status === "active" && "bg-primary text-white",
                    status === "queued" && "bg-muted text-muted-foreground",
                  )}
                >
                  {status === "done" ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                </span>
                {step.label}
              </div>
              {!isLast && (
                <div
                  className={cn(
                    "w-4 h-px",
                    status === "done" ? "bg-emerald-300" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
