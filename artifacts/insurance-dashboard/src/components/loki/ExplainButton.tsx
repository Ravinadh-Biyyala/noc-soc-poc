// "Explain with AI" affordance — the standard AG-UI gesture that turns ANY
// visual into a chat turn. Dropped into a Panel header's `action` slot (or used
// inline) so clicking it asks the right-rail BI Companion to explain that
// specific visual. On click it reads the panel's CURRENTLY-RENDERED values
// straight off the screen and hands them to the agent, which explains them
// without re-querying Loki — so the answer reflects exactly what the user sees.
// `title` identifies the visual; the optional `hint` adds context for the agent.

import { useRef } from "react";
import { Sparkles } from "lucide-react";
import { useNocUi, readVisualValues, readVisualChart } from "@/lib/ui-bridge";
import { cn } from "@/lib/utils";

export default function ExplainButton({ title, hint, label = "Explain", className }: {
  title: string;
  hint?: string;
  label?: string;
  className?: string;
}) {
  const { explainVisual } = useNocUi();
  const ref = useRef<HTMLButtonElement>(null);

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // The enclosing panel (any Card) carries data-explain-card; read its
    // rendered values so the agent explains what's on screen, not a fresh fetch.
    const card = ref.current?.closest<HTMLElement>("[data-explain-card]");
    explainVisual(title, hint, readVisualValues(card), readVisualChart(card));
  };

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title={`Ask the BI Companion to explain "${title}"`}
      data-testid="explain-visual"
      data-explain-omit=""
      className={cn(
        "flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary/90 transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary",
        className,
      )}
    >
      <Sparkles className="w-3 h-3" /> {label}
    </button>
  );
}
