import { createContext, useContext, type ReactNode } from "react";
import { useGetTenantConfig } from "@workspace/api-client-react";
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  Package,
  RefreshCw,
  ShieldAlert,
  DollarSign,
  FileText,
  Target,
  BarChart3,
  Percent,
  Users,
  ArrowUpRight,
  Calculator,
  AlertTriangle,
  Clock,
  PlusCircle,
  CheckCircle,
  AlertCircle,
  FileWarning,
  RotateCcw,
  Award,
  Filter,
  Shield,
  Landmark,
  Building2,
  CreditCard,
  PieChart,
  Activity,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  Package,
  RefreshCw,
  ShieldAlert,
  DollarSign,
  FileText,
  Target,
  BarChart3,
  Percent,
  Users,
  ArrowUpRight,
  Calculator,
  AlertTriangle,
  Clock,
  PlusCircle,
  CheckCircle,
  AlertCircle,
  FileWarning,
  RotateCcw,
  Award,
  Filter,
  Shield,
  Landmark,
  Building2,
  CreditCard,
  PieChart,
  Activity,
};

export function resolveIcon(name: string): LucideIcon {
  return ICON_MAP[name] || LayoutDashboard;
}

interface SectionConfig {
  id: string;
  label: string;
  route: string;
  icon: string;
  kpis: Array<{
    id: string;
    label: string;
    dataKey: string;
    format: string;
    icon: string;
    copilotQuestion: string;
    changeKey?: string;
  }>;
  charts: Array<{
    id: string;
    title: string;
    type: string;
    dataKey: string;
    xKey: string;
    yKeys: Array<{ key: string; label: string }>;
  }>;
  tables: Array<{
    id: string;
    title: string;
    dataKey: string;
    columns: Array<{ key: string; label: string; format: string }>;
    copilotQuestionTemplate?: string;
  }>;
  widgets: Array<{
    type: string;
    id: string;
    title: string;
    dataKey: string;
  }>;
}

interface TenantClientConfig {
  branding: {
    name: string;
    copilotName: string;
    industry: string;
    currencySymbol: string;
    dateRange: string;
  };
  sections: SectionConfig[];
  suggestedPrompts: string[];
  clickToAskTemplates: Record<string, string>;
}

interface TenantConfigContextType {
  config: TenantClientConfig | null;
  isLoading: boolean;
}

const TenantConfigContext = createContext<TenantConfigContextType>({
  config: null,
  isLoading: true,
});

export function TenantConfigProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useGetTenantConfig();

  return (
    <TenantConfigContext.Provider value={{ config: data as TenantClientConfig | undefined ?? null, isLoading }}>
      {children}
    </TenantConfigContext.Provider>
  );
}

export function useTenantConfig() {
  return useContext(TenantConfigContext);
}

export type { TenantClientConfig, SectionConfig };
