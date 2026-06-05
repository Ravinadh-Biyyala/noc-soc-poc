import {
  Home,
  LayoutDashboard,
  ShieldCheck,
  Settings as SettingsIcon,
  FolderKanban,
  BarChart2,
  type LucideIcon,
} from "lucide-react";

export interface NavLeaf {
  type: "leaf";
  href: string;
  label: string;
  icon: LucideIcon;
  /** Optional path-prefix used to mark the leaf active for sub-routes (e.g. /projects/123). */
  matchPrefix?: string;
}

export type NavItem = NavLeaf;

/**
 * The Gen-BI shell navigation. Six top-level destinations, all real.
 *
 * Deliberately flat: every prep step (file inspection, joins, cleansing,
 * outlier handling, metric definition, exports) is driven from the
 * right-rail Copilot — the agent proactively surfaces issues, asks for
 * confirmation, and applies deterministic rules. Burying those as nav
 * items would contradict the chat-first model and create dead ends.
 *
 * - Home         — front door + recent activity
 * - Projects     — projects (list + detail with the multi-phase pipeline)
 * - Data         — single landing for ingestion (drop / connect / browse)
 * - Dashboards   — generated dashboards
 * - Governance   — lineage / approvals (placeholder destination, not a SOON pill)
 * - Settings     — org / theme / limits / packs / AI behaviour
 */
export const NAV: NavItem[] = [
  { type: "leaf", href: "/", label: "Home", icon: Home },
  {
    type: "leaf",
    href: "/projects",
    label: "Projects",
    icon: FolderKanban,
    matchPrefix: "/projects",
  },
  {
    type: "leaf",
    href: "/dashboards",
    label: "Dashboards",
    icon: LayoutDashboard,
    matchPrefix: "/dashboards",
  },
  {
    type: "leaf",
    href: "/visuals-catalog",
    label: "Visuals Catalog",
    icon: BarChart2,
    matchPrefix: "/visuals-catalog",
  },
  { type: "leaf", href: "/governance", label: "Governance", icon: ShieldCheck },
  { type: "leaf", href: "/settings", label: "Settings", icon: SettingsIcon },
];
