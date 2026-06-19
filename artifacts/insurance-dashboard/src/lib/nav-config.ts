import { ScrollText, LayoutDashboard, Activity, Workflow, Server, Network, ShieldAlert, type LucideIcon } from "lucide-react";

export interface NavLeaf {
  type: "leaf";
  href: string;
  label: string;
  icon: LucideIcon;
  /** Optional path-prefix used to mark the leaf active for sub-routes. */
  matchPrefix?: string;
}

export type NavItem = NavLeaf;

/**
 * The shell navigation. This build is a single-purpose app: Loki Logs.
 */
export const NAV: NavItem[] = [
  {
    type: "leaf",
    href: "/dashboard",
    label: "Dashboard",
    icon: Activity,
    matchPrefix: "/dashboard",
  },
  {
    type: "leaf",
    href: "/noc",
    label: "NOC",
    icon: Network,
    matchPrefix: "/noc",
  },
  {
    type: "leaf",
    href: "/soc",
    label: "SOC",
    icon: ShieldAlert,
    matchPrefix: "/soc",
  },
  {
    type: "leaf",
    href: "/assets",
    label: "Assets",
    icon: Server,
    matchPrefix: "/assets",
  },
  {
    type: "leaf",
    href: "/topology",
    label: "Topology",
    icon: Network,
    matchPrefix: "/topology",
  },
  {
    type: "leaf",
    href: "/loki-traces",
    label: "Traces",
    icon: Workflow,
    matchPrefix: "/loki-traces",
  },
  {
    type: "leaf",
    href: "/loki-logs",
    label: "Loki Logs",
    icon: ScrollText,
    matchPrefix: "/loki-logs",
  },
  {
    type: "leaf",
    href: "/loki-pins",
    label: "Pinned Visuals",
    icon: LayoutDashboard,
    matchPrefix: "/loki-pins",
  },
];
