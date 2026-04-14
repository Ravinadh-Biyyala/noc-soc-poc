import type { TenantConfig } from "./types.js";
import type { DataAdapter } from "./data-adapter.js";
import { StaticDataAdapter } from "./data-adapter.js";
import { insuranceConfig, getInsuranceDataForSection, buildInsuranceDataContext } from "./tenants/insurance.js";
import { bankingConfig, getBankingDataForSection, buildBankingDataContext } from "./tenants/banking.js";

export type { TenantConfig } from "./types.js";
export type { SectionConfig, KpiConfig, ChartConfig, TableConfig, WidgetConfig, PromptConfig, TenantBranding } from "./types.js";
export type { DataAdapter } from "./data-adapter.js";

interface TenantRegistry {
  config: TenantConfig;
  adapter: DataAdapter;
}

const tenants: Record<string, TenantRegistry> = {
  insurance: {
    config: insuranceConfig,
    adapter: new StaticDataAdapter(getInsuranceDataForSection, buildInsuranceDataContext),
  },
  banking: {
    config: bankingConfig,
    adapter: new StaticDataAdapter(getBankingDataForSection, buildBankingDataContext),
  },
};

const DEFAULT_TENANT = "insurance";

function getActiveTenantId(): string {
  const requested = process.env.TENANT || DEFAULT_TENANT;
  if (tenants[requested]) {
    return requested;
  }
  console.warn(`[config] Unknown tenant "${requested}", falling back to "${DEFAULT_TENANT}". Available: ${Object.keys(tenants).join(", ")}`);
  return DEFAULT_TENANT;
}

export function getTenantConfig(): TenantConfig {
  return tenants[getActiveTenantId()].config;
}

export function getAdapter(): DataAdapter {
  return tenants[getActiveTenantId()].adapter;
}

export async function getDataForSection(sectionId: string): Promise<Record<string, unknown>> {
  return tenants[getActiveTenantId()].adapter.getDataForSection(sectionId);
}

export async function buildDataContext(): Promise<string> {
  return tenants[getActiveTenantId()].adapter.getFullDataContext();
}

export function getClientConfig(): {
  branding: TenantConfig["branding"];
  sections: Array<{
    id: string;
    label: string;
    route: string;
    icon: string;
    kpis: TenantConfig["sections"][0]["kpis"];
    charts: TenantConfig["sections"][0]["charts"];
    tables: TenantConfig["sections"][0]["tables"];
    widgets: TenantConfig["sections"][0]["widgets"];
  }>;
  suggestedPrompts: string[];
  clickToAskTemplates: Record<string, string>;
} {
  const config = getTenantConfig();
  return {
    branding: config.branding,
    sections: config.sections.map(s => ({
      id: s.id,
      label: s.label,
      route: s.route,
      icon: s.icon,
      kpis: s.kpis,
      charts: s.charts,
      tables: s.tables,
      widgets: s.widgets,
    })),
    suggestedPrompts: config.prompt.suggestedPrompts,
    clickToAskTemplates: config.prompt.clickToAskTemplates,
  };
}
