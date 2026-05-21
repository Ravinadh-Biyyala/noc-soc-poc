import type { TenantConfig } from "../types.js";
import { executiveData } from "../../routes/dashboard/data/executive.js";
import { salesData } from "../../routes/dashboard/data/sales.js";
import { productData } from "../../routes/dashboard/data/products.js";
import { renewalsData } from "../../routes/dashboard/data/renewals.js";
import { claimsData } from "../../routes/dashboard/data/claims.js";
import { geographyData } from "../../routes/dashboard/data/geography.js";

export const insuranceConfig: TenantConfig = {
  id: "insurance",
  branding: {
    name: "Geva",
    copilotName: "BI Companion",
    industry: "Insurance Brokerage",
    currencySymbol: "$",
    dateRange: "2022-2026",
  },
  sections: [
    {
      id: "executive",
      label: "Executive Summary",
      route: "/",
      icon: "LayoutDashboard",
      kpis: [
        { id: "writtenPremium", label: "Written Premium", dataKey: "writtenPremium.current", format: "currency", icon: "DollarSign", copilotQuestion: "Summarize our written premium performance and trends", changeKey: "writtenPremium.changePercent" },
        { id: "commissionRevenue", label: "Commission Revenue", dataKey: "commissionRevenue.current", format: "currency", icon: "TrendingUp", copilotQuestion: "Analyze our commission revenue trends", changeKey: "commissionRevenue.changePercent" },
        { id: "policiesBound", label: "Policies Bound", dataKey: "policiesBound.current", format: "number", icon: "FileText", copilotQuestion: "Summarize policies bound this year", changeKey: "policiesBound.changePercent" },
        { id: "renewalRate", label: "Renewal Rate", dataKey: "renewalRate", format: "percent", icon: "RefreshCw", copilotQuestion: "Analyze our renewal rate performance" },
        { id: "quoteToBind", label: "Quote-to-Bind", dataKey: "quoteToBind", format: "percent", icon: "Target", copilotQuestion: "Analyze our quote-to-bind ratio" },
        { id: "yoyGrowth", label: "YoY Growth", dataKey: "yoyBookGrowth", format: "percent", icon: "ArrowUpRight", copilotQuestion: "Summarize our year-over-year book growth" },
        { id: "avgPremium", label: "Avg Premium/Policy", dataKey: "avgPremiumPerPolicy", format: "currency", icon: "Calculator", copilotQuestion: "Analyze average premium per policy trends" },
        { id: "lossRatio", label: "Loss Ratio", dataKey: "lossRatio", format: "percent", icon: "AlertTriangle", copilotQuestion: "Analyze our overall loss ratio" },
      ],
      charts: [
        { id: "premiumTrend", title: "Written Premium Trend", type: "area", dataKey: "monthlyPremiumTrend", xKey: "date", yKeys: [{ key: "value", label: "Premium" }] },
        { id: "commissionTrend", title: "Commission Revenue Trend", type: "area", dataKey: "monthlyCommissionTrend", xKey: "date", yKeys: [{ key: "value", label: "Commission" }] },
        { id: "policyMix", title: "Policy Mix", type: "pie", dataKey: "policyMix", xKey: "line", yKeys: [{ key: "premium", label: "Premium" }] },
      ],
      tables: [
        { id: "topStates", title: "Top States by Premium", dataKey: "topStatesByPremium", columns: [
          { key: "state", label: "State", format: "text" },
          { key: "stateCode", label: "Code", format: "text" },
          { key: "premium", label: "Premium", format: "currency" },
        ], copilotQuestionTemplate: "Analyze {state} premium performance and trends" },
      ],
      widgets: [
        { type: "usa-map", id: "geoMap", title: "Geographic Performance", dataKey: "geography" },
      ],
    },
    {
      id: "sales",
      label: "Sales Performance",
      route: "/sales",
      icon: "BarChart3",
      kpis: [
        { id: "leadVolume", label: "Lead Volume", dataKey: "leadVolume", format: "number", icon: "Users", copilotQuestion: "Analyze our lead volume and pipeline" },
        { id: "quotesIssued", label: "Quotes Issued", dataKey: "quotesIssued", format: "number", icon: "FileText", copilotQuestion: "Summarize quotes issued this year" },
        { id: "bindRate", label: "Bind Rate", dataKey: "bindRate", format: "percent", icon: "Target", copilotQuestion: "Analyze our overall bind rate" },
        { id: "closingRatio", label: "Closing Ratio", dataKey: "closingRatio", format: "percent", icon: "CheckCircle", copilotQuestion: "Analyze our closing ratio performance" },
        { id: "premiumBound", label: "Premium Bound", dataKey: "premiumBound", format: "currency", icon: "DollarSign", copilotQuestion: "Summarize premium bound this year" },
        { id: "avgDaysToBind", label: "Avg Days to Bind", dataKey: "avgDaysToBind", format: "number", icon: "Clock", copilotQuestion: "Analyze our average days to bind" },
        { id: "newBusiness", label: "New Business", dataKey: "newBusinessPremium", format: "currency", icon: "PlusCircle", copilotQuestion: "Analyze new business premium trends" },
        { id: "renewalPremium", label: "Renewal Premium", dataKey: "renewalPremium", format: "currency", icon: "RefreshCw", copilotQuestion: "Analyze renewal premium performance" },
      ],
      charts: [
        { id: "bindTrend", title: "Monthly Bind Trend", type: "line", dataKey: "monthlyBindTrend", xKey: "date", yKeys: [{ key: "value", label: "Policies Bound" }] },
        { id: "accountSize", title: "Account Size Distribution", type: "bar", dataKey: "accountSizeBuckets", xKey: "bucket", yKeys: [{ key: "premium", label: "Premium" }] },
      ],
      tables: [
        { id: "producerLeaderboard", title: "Producer Leaderboard", dataKey: "producerLeaderboard", columns: [
          { key: "name", label: "Producer", format: "text" },
          { key: "writtenPremium", label: "Written Premium", format: "currency" },
          { key: "policiesBound", label: "Policies", format: "number" },
          { key: "bindRate", label: "Bind Rate", format: "percent" },
          { key: "renewalRetention", label: "Retention", format: "percent" },
        ], copilotQuestionTemplate: "Analyze {name}'s sales performance in detail" },
      ],
      widgets: [
        { type: "funnel", id: "salesFunnel", title: "Sales Funnel", dataKey: "funnelStages" },
      ],
    },
    {
      id: "products",
      label: "Product Analytics",
      route: "/products",
      icon: "Package",
      kpis: [],
      charts: [
        { id: "premiumByLine", title: "Premium by Line Trend", type: "area", dataKey: "premiumByLineTrend", xKey: "date", yKeys: [
          { key: "commercialProperty", label: "Commercial Property" },
          { key: "generalLiability", label: "General Liability" },
          { key: "commercialAuto", label: "Commercial Auto" },
          { key: "workersComp", label: "Workers Comp" },
          { key: "cyber", label: "Cyber" },
        ]},
      ],
      tables: [
        { id: "lineOfBusiness", title: "Line of Business Performance", dataKey: "lineOfBusiness", columns: [
          { key: "line", label: "Line", format: "text" },
          { key: "premium2025", label: "Premium 2025", format: "currency" },
          { key: "yoyChange", label: "YoY Change", format: "percent" },
          { key: "policyCount", label: "Policies", format: "number" },
          { key: "lossRatio", label: "Loss Ratio", format: "percent" },
          { key: "bindRate", label: "Bind Rate", format: "percent" },
        ], copilotQuestionTemplate: "Analyze {line} line of business performance" },
        { id: "carriers", title: "Carrier Performance", dataKey: "carriers", columns: [
          { key: "carrier", label: "Carrier", format: "text" },
          { key: "premiumPlaced", label: "Premium Placed", format: "currency" },
          { key: "bindRatio", label: "Bind Ratio", format: "percent" },
          { key: "avgQuoteTurnaround", label: "Turnaround (days)", format: "number" },
          { key: "retentionRate", label: "Retention", format: "percent" },
        ], copilotQuestionTemplate: "Analyze {carrier} carrier performance" },
      ],
      widgets: [],
    },
    {
      id: "renewals",
      label: "Renewals & Retention",
      route: "/renewals",
      icon: "RefreshCw",
      kpis: [
        { id: "renewalRate", label: "Renewal Rate", dataKey: "renewalRate", format: "percent", icon: "RefreshCw", copilotQuestion: "Analyze our renewal rate trends" },
        { id: "retentionRatio", label: "Retention Ratio", dataKey: "retentionRatio", format: "percent", icon: "Shield", copilotQuestion: "Analyze our retention ratio" },
        { id: "retainedPremium", label: "Retained Premium", dataKey: "retainedPremium", format: "currency", icon: "DollarSign", copilotQuestion: "Summarize retained premium" },
        { id: "lostPremium", label: "Lost Premium", dataKey: "lostPremium", format: "currency", icon: "TrendingDown", copilotQuestion: "Analyze lost premium and reasons" },
        { id: "premiumAtRisk90", label: "Premium at Risk (90d)", dataKey: "premiumAtRisk90", format: "currency", icon: "AlertTriangle", copilotQuestion: "Analyze premium at risk in next 90 days" },
        { id: "nonRenewalCount", label: "Non-Renewals", dataKey: "nonRenewalCount", format: "number", icon: "XCircle", copilotQuestion: "Analyze non-renewal trends" },
      ],
      charts: [
        { id: "renewalTrend", title: "Renewal Rate Trend", type: "line", dataKey: "renewalTrend", xKey: "date", yKeys: [{ key: "value", label: "Renewal Rate" }] },
        { id: "retentionTrend", title: "Retention Trend", type: "line", dataKey: "retentionTrend", xKey: "date", yKeys: [{ key: "value", label: "Retention" }] },
      ],
      tables: [
        { id: "churnByProducer", title: "Churn by Producer", dataKey: "churnByProducer", columns: [
          { key: "producer", label: "Producer", format: "text" },
          { key: "lostPolicies", label: "Lost Policies", format: "number" },
          { key: "lostPremium", label: "Lost Premium", format: "currency" },
          { key: "retentionRate", label: "Retention", format: "percent" },
        ], copilotQuestionTemplate: "Analyze {producer}'s churn and retention" },
        { id: "churnByLine", title: "Churn by Line", dataKey: "churnByLine", columns: [
          { key: "line", label: "Line", format: "text" },
          { key: "lostPolicies", label: "Lost Policies", format: "number" },
          { key: "lostPremium", label: "Lost Premium", format: "currency" },
          { key: "retentionRate", label: "Retention", format: "percent" },
        ], copilotQuestionTemplate: "Analyze {line} churn patterns" },
      ],
      widgets: [],
    },
    {
      id: "claims",
      label: "Claims & Risk",
      route: "/claims",
      icon: "Shield",
      kpis: [
        { id: "openClaims", label: "Open Claims", dataKey: "openClaims", format: "number", icon: "AlertCircle", copilotQuestion: "Summarize open claims status" },
        { id: "closedClaims", label: "Closed Claims", dataKey: "closedClaims", format: "number", icon: "CheckCircle", copilotQuestion: "Analyze closed claims this period" },
        { id: "lossRatio", label: "Loss Ratio", dataKey: "lossRatio", format: "percent", icon: "TrendingDown", copilotQuestion: "Analyze overall loss ratio trends" },
        { id: "avgIncurredLoss", label: "Avg Incurred Loss", dataKey: "avgIncurredLoss", format: "currency", icon: "DollarSign", copilotQuestion: "Analyze average incurred loss trends" },
        { id: "severity", label: "Severity", dataKey: "severity", format: "currency", icon: "AlertTriangle", copilotQuestion: "Analyze claims severity trends" },
        { id: "claimFrequency", label: "Claim Frequency", dataKey: "claimFrequency", format: "percent", icon: "Activity", copilotQuestion: "Analyze claim frequency patterns" },
      ],
      charts: [
        { id: "claimsTrend", title: "Claims Trend", type: "bar", dataKey: "claimsTrend", xKey: "date", yKeys: [{ key: "value", label: "Claims" }] },
        { id: "lossRatioTrend", title: "Loss Ratio Trend", type: "line", dataKey: "lossRatioTrend", xKey: "date", yKeys: [{ key: "value", label: "Loss Ratio" }] },
      ],
      tables: [
        { id: "claimsByLine", title: "Claims by Line", dataKey: "claimsByLine", columns: [
          { key: "line", label: "Line", format: "text" },
          { key: "claims", label: "Claims", format: "number" },
          { key: "incurredLoss", label: "Incurred Loss", format: "currency" },
          { key: "lossRatio", label: "Loss Ratio", format: "percent" },
        ], copilotQuestionTemplate: "Analyze {line} claims in detail" },
        { id: "claimsByState", title: "Claims by State", dataKey: "claimsByState", columns: [
          { key: "state", label: "State", format: "text" },
          { key: "claims", label: "Claims", format: "number" },
          { key: "incurredLoss", label: "Incurred Loss", format: "currency" },
        ], copilotQuestionTemplate: "Analyze {state} claims patterns" },
      ],
      widgets: [
        { type: "recent-items", id: "recentClaims", title: "Recent Claims", dataKey: "recentClaims" },
      ],
    },
  ],
  prompt: {
    persona: `You are {copilotName}, a Gen-BI (Generative Business Intelligence) analytics engine for {name}. You combine conversational AI with dynamic data visualization. You have FULL ACCESS to all {industry} data from {dateRange}.`,
    domainTerminology: [
      "GWP", "Earned Premium", "Quote-to-Bind", "Loss Ratio", "Retention",
      "Book of Business", "Producer", "Bind Rate", "Commission Revenue",
      "Renewal Rate", "Claim Frequency", "Severity", "Incurred Loss",
      "Policy Count", "Premium at Risk", "Non-Renewal", "Remarketing",
    ],
    fewShotExamples: [
      {
        user: "What is California's premium trend?",
        assistant: `California's premium has grown steadily from **$34.2M** in 2023 to **$48.8M** in 2025, a **42.7%** increase over 3 years.
[CHART:{"type":"area","title":"California Written Premium (Monthly)","xKey":"month","yKey":"premium","data":[{"month":"Jan 2024","premium":2950000},{"month":"Apr 2024","premium":3150000},{"month":"Jul 2024","premium":3280000},{"month":"Oct 2024","premium":3350000},{"month":"Jan 2025","premium":3380000},{"month":"Apr 2025","premium":3600000},{"month":"Jul 2025","premium":3760000},{"month":"Oct 2025","premium":3820000},{"month":"Jan 2026","premium":3850000},{"month":"Apr 2026","premium":4100000}]}]
[NAVIGATE:/]`,
      },
      {
        user: "Compare top 5 states by premium",
        assistant: `California leads the book at **$48.8M**, followed by Texas at **$41.2M**. The top 5 states represent **64.5%** of total GWP.
[CHART:{"type":"bar","title":"Top 5 States by Written Premium","xKey":"state","yKey":"premium","data":[{"state":"California","premium":48800000},{"state":"Texas","premium":41200000},{"state":"New York","premium":33600000},{"state":"Florida","premium":28900000},{"state":"Illinois","premium":20400000}]}]`,
      },
      {
        user: "Show policy mix",
        assistant: `Commercial Property dominates at **25%** of our book, followed by General Liability at **20%**.
[CHART:{"type":"pie","title":"Premium by Line of Business","xKey":"line","yKey":"premium","data":[{"line":"Comm. Property","premium":66950000},{"line":"Gen. Liability","premium":53560000},{"line":"Comm. Auto","premium":42838000},{"line":"Workers Comp","premium":37494000},{"line":"Cyber","premium":29458000},{"line":"Prof. Liability","premium":18746000}]}]`,
      },
    ],
    suggestedPrompts: [
      "Show me the premium trend for the last 3 years",
      "Compare top 5 states by premium",
      "Which producer has the best bind rate?",
      "What's our loss ratio trend?",
      "Show the policy mix breakdown",
      "Compare carrier performance",
      "What's the renewal rate trend?",
      "Show claims by line of business",
    ],
    clickToAskTemplates: {
      kpi: "Summarize {label} performance and trends",
      tableRow: "Analyze {value} in detail",
      chart: "Explain the {title} chart",
    },
  },
  dataSources: {
    executive: { type: "static", module: "executive" },
    sales: { type: "static", module: "sales" },
    products: { type: "static", module: "products" },
    renewals: { type: "static", module: "renewals" },
    claims: { type: "static", module: "claims" },
    geography: { type: "static", module: "geography" },
  },
};

export function getInsuranceDataForSection(sectionId: string): Record<string, unknown> {
  const dataMap: Record<string, Record<string, unknown>> = {
    executive: { ...executiveData, geography: geographyData },
    sales: salesData as unknown as Record<string, unknown>,
    products: productData as unknown as Record<string, unknown>,
    renewals: renewalsData as unknown as Record<string, unknown>,
    claims: claimsData as unknown as Record<string, unknown>,
  };
  return dataMap[sectionId] || {};
}

export function buildInsuranceDataContext(): string {
  const stateMonthly = executiveData.stateMonthlyPremium.map(s => {
    const total2023 = s.monthly.filter(m => m.date.includes('2023')).reduce((sum, m) => sum + m.value, 0);
    const total2024 = s.monthly.filter(m => m.date.includes('2024')).reduce((sum, m) => sum + m.value, 0);
    const total2025 = s.monthly.filter(m => m.date.includes('2025')).reduce((sum, m) => sum + m.value, 0);
    return `${s.stateName} (${s.state}): 2023=$${(total2023/1e6).toFixed(1)}M, 2024=$${(total2024/1e6).toFixed(1)}M, 2025=$${(total2025/1e6).toFixed(1)}M`;
  }).join('; ');

  const producerMonthly = executiveData.producerMonthlyPremium.map(p => {
    const total = p.monthly.reduce((sum, m) => sum + m.value, 0);
    return `${p.producer}: 2025 Total=$${(total/1e6).toFixed(1)}M`;
  }).join('; ');

  const lineMonthly = executiveData.lineMonthlyPremium.map(l => {
    const total = l.monthly.reduce((sum, m) => sum + m.value, 0);
    return `${l.line}: 2025 Total=$${(total/1e6).toFixed(1)}M`;
  }).join('; ');

  const yearly = executiveData.yearlyPerformance.map(y =>
    `${y.year}: GWP=$${(y.writtenPremium/1e6).toFixed(1)}M, Commission=$${(y.commissionRevenue/1e6).toFixed(1)}M, Policies=${y.policiesBound}, Renewal=${(y.renewalRate*100).toFixed(1)}%, Loss Ratio=${(y.lossRatio*100).toFixed(1)}%`
  ).join('\n');

  return `
YEARLY PERFORMANCE:
${yearly}

CURRENT YEAR (2025-2026):
- Written Premium: $${(executiveData.writtenPremium.current/1e6).toFixed(1)}M (+${executiveData.writtenPremium.changePercent}% YoY)
- Commission Revenue: $${(executiveData.commissionRevenue.current/1e6).toFixed(1)}M
- Policies Bound: ${executiveData.policiesBound.current.toLocaleString()} (+${executiveData.policiesBound.changePercent}%)
- Renewal Rate: ${(executiveData.renewalRate*100).toFixed(1)}%
- Quote-to-Bind: ${(executiveData.quoteToBind*100).toFixed(1)}%
- Retention Ratio: ${(executiveData.retentionRate*100).toFixed(1)}%
- Loss Ratio: ${(executiveData.lossRatio*100).toFixed(1)}%
- Avg Premium/Policy: $${executiveData.avgPremiumPerPolicy.toLocaleString()}
- Active in ${geographyData.totalStatesActive} states

TOP STATES: ${executiveData.topStatesByPremium.map(s => `${s.state} ($${(s.premium/1e6).toFixed(1)}M)`).join(', ')}

STATE MONTHLY DATA: ${stateMonthly}

PRODUCER LEADERBOARD:
${salesData.producerLeaderboard.map(p => `${p.name}: GWP=$${(p.writtenPremium/1e6).toFixed(1)}M, Bind=${(p.bindRate*100).toFixed(1)}%, Retention=${(p.renewalRetention*100).toFixed(1)}%`).join('\n')}

PRODUCER MONTHLY DATA: ${producerMonthly}

LINES OF BUSINESS:
${productData.lineOfBusiness.map(l => `${l.line}: 2025=$${((l.premium2025 || l.premium2023)/1e6).toFixed(1)}M, YoY=${l.yoyChange}%, Loss Ratio=${(l.lossRatio*100).toFixed(1)}%, Bind=${(l.bindRate*100).toFixed(1)}%`).join('\n')}

LINE MONTHLY DATA: ${lineMonthly}

CARRIERS:
${productData.carriers.map(c => `${c.carrier}: Placed=$${(c.premiumPlaced/1e6).toFixed(1)}M, Bind=${(c.bindRatio*100).toFixed(1)}%, Turn=${c.avgQuoteTurnaround}d`).join('\n')}

CLAIMS:
- Open: ${claimsData.openClaims}, Closed: ${claimsData.closedClaims}
- Loss Ratio: ${(claimsData.lossRatio*100).toFixed(1)}%, Avg Incurred: $${claimsData.avgIncurredLoss.toLocaleString()}, Severity: $${claimsData.severity.toLocaleString()}
${claimsData.claimsByLine.map(c => `${c.line}: ${c.claims} claims, $${(c.incurredLoss/1e6).toFixed(1)}M incurred, ${(c.lossRatio*100).toFixed(1)}% loss ratio`).join('\n')}

RENEWALS:
- Renewal Rate: ${(renewalsData.renewalRate*100).toFixed(1)}%, Retained: $${(renewalsData.retainedPremium/1e6).toFixed(1)}M, Lost: $${(renewalsData.lostPremium/1e6).toFixed(1)}M
- At Risk (90d): $${(renewalsData.premiumAtRisk90/1e6).toFixed(1)}M

MONTHLY PREMIUM DATA (available for Jan 2022 - Apr 2026):
Total monthly premium values range from $12.8M to $23.1M with consistent upward trend.
Monthly bind counts range from 540 to 1,005 policies.`;
}
