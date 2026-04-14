export interface TenantBranding {
  name: string;
  copilotName: string;
  industry: string;
  currencySymbol: string;
  dateRange: string;
}

export interface KpiConfig {
  id: string;
  label: string;
  dataKey: string;
  format: "currency" | "number" | "percent" | "ratio";
  icon: string;
  copilotQuestion: string;
  changeKey?: string;
}

export interface ChartConfig {
  id: string;
  title: string;
  type: "area" | "bar" | "line" | "pie";
  dataKey: string;
  xKey: string;
  yKeys: { key: string; label: string; color?: string }[];
  height?: number;
}

export interface TableConfig {
  id: string;
  title: string;
  dataKey: string;
  columns: { key: string; label: string; format?: "currency" | "number" | "percent" | "text" }[];
  copilotQuestionTemplate?: string;
}

export interface WidgetConfig {
  type: "usa-map" | "funnel" | "recent-items" | "custom";
  id: string;
  title: string;
  dataKey: string;
  props?: Record<string, unknown>;
}

export interface SectionConfig {
  id: string;
  label: string;
  route: string;
  icon: string;
  kpis: KpiConfig[];
  charts: ChartConfig[];
  tables: TableConfig[];
  widgets: WidgetConfig[];
}

export interface PromptConfig {
  persona: string;
  domainTerminology: string[];
  fewShotExamples: { user: string; assistant: string }[];
  suggestedPrompts: string[];
  clickToAskTemplates: Record<string, string>;
}

export interface DataSourceConfig {
  type: "static";
  module: string;
}

export interface TenantConfig {
  id: string;
  branding: TenantBranding;
  sections: SectionConfig[];
  prompt: PromptConfig;
  dataSources: Record<string, DataSourceConfig>;
}
