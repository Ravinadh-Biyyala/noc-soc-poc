import {
  ShieldAlert,
  ShoppingCart,
  Server,
  Megaphone,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

export interface DomainPack {
  id: string;
  label: string;
  industry: string;
  description: string;
  icon: LucideIcon;
  copilotName: string;
  suggestedPrompts: string[];
  starterMetrics: string[];
}

export const DOMAIN_PACKS: DomainPack[] = [
  {
    id: "insurance-broker",
    label: "Insurance Broker",
    industry: "Insurance",
    description: "Premium, commission, retention, claims and producer analytics.",
    icon: ShieldAlert,
    copilotName: "BI Companion",
    suggestedPrompts: [
      "Compare top 5 states by premium",
      "Show premium trend last 12 months",
      "Which producers have the lowest retention?",
      "Break down policy mix by line of business",
    ],
    starterMetrics: ["Written Premium", "Commission Revenue", "Renewal Rate", "Loss Ratio"],
  },
  {
    id: "ecommerce-sales",
    label: "E-commerce Sales",
    industry: "Retail",
    description: "Orders, AOV, conversion, customer cohorts and SKU performance.",
    icon: ShoppingCart,
    copilotName: "Sales Copilot",
    suggestedPrompts: [
      "What's my top-selling SKU this month?",
      "Compare AOV across channels",
      "Show customer cohort retention",
      "Which products have the highest return rate?",
    ],
    starterMetrics: ["Revenue", "Orders", "AOV", "Conversion Rate"],
  },
  {
    id: "saas-metrics",
    label: "SaaS Metrics",
    industry: "Software",
    description: "MRR, churn, expansion, NRR, activation funnels and feature adoption.",
    icon: Server,
    copilotName: "SaaS Copilot",
    suggestedPrompts: [
      "What is my net revenue retention?",
      "Show MRR by plan tier",
      "Which features drive activation?",
      "Compare gross vs net churn",
    ],
    starterMetrics: ["MRR", "Net Retention", "Active Users", "Churn Rate"],
  },
  {
    id: "marketing-funnel",
    label: "Marketing Funnel",
    industry: "Marketing",
    description: "Spend, CAC, attribution, channel ROI and campaign performance.",
    icon: Megaphone,
    copilotName: "Growth Copilot",
    suggestedPrompts: [
      "What's my CAC by channel?",
      "Show ROAS for the last quarter",
      "Which campaigns are underperforming?",
      "Compare spend vs pipeline by source",
    ],
    starterMetrics: ["Spend", "CAC", "ROAS", "Pipeline"],
  },
  {
    id: "generic",
    label: "Generic Analytics",
    industry: "Any",
    description: "Open-ended pack — bring your own data and let Gen-BI suggest metrics.",
    icon: BarChart3,
    copilotName: "BI Companion",
    suggestedPrompts: [
      "Summarize the dataset",
      "What patterns are in the data?",
      "Show the top 10 records",
      "Which columns are most useful for analysis?",
    ],
    starterMetrics: ["Total Records", "Distinct Categories", "Time Span", "Numeric Range"],
  },
];

export function getPack(id: string | null | undefined): DomainPack {
  return DOMAIN_PACKS.find((p) => p.id === id) ?? DOMAIN_PACKS[DOMAIN_PACKS.length - 1];
}
