import {
  Home,
  Briefcase,
  Database,
  LineChart,
  FileOutput,
  ShieldCheck,
  Settings as SettingsIcon,
  Upload,
  Files,
  Link2,
  Sparkles as SparklesIcon,
  Hash,
  LayoutDashboard,
  MessageSquare,
  FileText,
  Send,
  type LucideIcon,
} from "lucide-react";

export interface NavLeaf {
  type: "leaf";
  href: string;
  label: string;
  icon: LucideIcon;
  /** Optional path-prefix used to mark the leaf active for sub-routes (e.g. /workspaces/123). */
  matchPrefix?: string;
}

export interface NavGroup {
  type: "group";
  id: string;
  label: string;
  icon: LucideIcon;
  /** Sub-items shown when the group is expanded. */
  items: Array<NavLeaf | { type: "placeholder"; label: string; icon: LucideIcon }>;
}

export type NavItem = NavLeaf | NavGroup;

/**
 * The permanent 10-item Gen-BI shell navigation. Items either route directly
 * (Home, Workspaces, Governance, Settings) or expand to expose the workflow
 * inside a domain (Data ingestion, Analytics surfaces, Outputs).
 *
 * Sub-items marked as placeholder render but are non-interactive — they
 * advertise upcoming surfaces without breaking the routing graph.
 */
export const NAV: NavItem[] = [
  { type: "leaf", href: "/", label: "Home", icon: Home },
  {
    type: "leaf",
    href: "/workspaces",
    label: "Workspaces",
    icon: Briefcase,
    matchPrefix: "/workspaces",
  },
  {
    type: "group",
    id: "data",
    label: "Data",
    icon: Database,
    items: [
      { type: "leaf", href: "/upload", label: "Upload", icon: Upload },
      { type: "placeholder", label: "Files", icon: Files },
      { type: "placeholder", label: "Joins", icon: Link2 },
      { type: "placeholder", label: "Cleaning", icon: SparklesIcon },
    ],
  },
  {
    type: "group",
    id: "analytics",
    label: "Analytics",
    icon: LineChart,
    items: [
      { type: "placeholder", label: "Metrics", icon: Hash },
      { type: "placeholder", label: "Dashboards", icon: LayoutDashboard },
      { type: "placeholder", label: "Ask Gen-BI", icon: MessageSquare },
    ],
  },
  {
    type: "group",
    id: "outputs",
    label: "Outputs",
    icon: FileOutput,
    items: [
      { type: "placeholder", label: "Reports", icon: FileText },
      { type: "placeholder", label: "Boards", icon: LayoutDashboard },
      { type: "placeholder", label: "Exports", icon: Send },
    ],
  },
  { type: "leaf", href: "/governance", label: "Governance", icon: ShieldCheck },
  { type: "leaf", href: "/settings", label: "Settings", icon: SettingsIcon },
];
