import type { TenantConfig } from "../types.js";

const bankingExecutiveData = {
  totalAssets: { current: 4250000000, previous: 3890000000, changePercent: 9.3 },
  netInterestIncome: { current: 186500000, previous: 168200000, changePercent: 10.9 },
  totalLoans: { current: 3120000000, previous: 2840000000, changePercent: 9.9 },
  totalDeposits: { current: 3680000000, previous: 3420000000, changePercent: 7.6 },
  nim: 0.0438,
  roa: 0.0112,
  roe: 0.1245,
  efficiencyRatio: 0.582,
  nplRatio: 0.0134,
  loanToDeposit: 0.848,
  tierOneCapital: 0.128,
  costOfFunds: 0.0285,
  topRegionsByAssets: [
    { region: "Northeast", code: "NE", assets: 1180000000 },
    { region: "Southeast", code: "SE", assets: 980000000 },
    { region: "Midwest", code: "MW", assets: 820000000 },
    { region: "West", code: "WE", assets: 740000000 },
    { region: "Southwest", code: "SW", assets: 530000000 },
  ],
  monthlyNIITrend: [
    { date: "Jan 2024", value: 14200000 }, { date: "Feb 2024", value: 14500000 }, { date: "Mar 2024", value: 14800000 },
    { date: "Apr 2024", value: 15100000 }, { date: "May 2024", value: 15300000 }, { date: "Jun 2024", value: 15600000 },
    { date: "Jul 2024", value: 15400000 }, { date: "Aug 2024", value: 15800000 }, { date: "Sep 2024", value: 15500000 },
    { date: "Oct 2024", value: 15900000 }, { date: "Nov 2024", value: 15700000 }, { date: "Dec 2024", value: 16000000 },
    { date: "Jan 2025", value: 16200000 }, { date: "Feb 2025", value: 16500000 }, { date: "Mar 2025", value: 16800000 },
    { date: "Apr 2025", value: 17100000 },
  ],
  monthlyLoanGrowth: [
    { date: "Jan 2024", value: 2680000000 }, { date: "Apr 2024", value: 2740000000 },
    { date: "Jul 2024", value: 2810000000 }, { date: "Oct 2024", value: 2880000000 },
    { date: "Jan 2025", value: 2960000000 }, { date: "Apr 2025", value: 3120000000 },
  ],
  loanPortfolioMix: [
    { segment: "Commercial Real Estate", amount: 1060000000, share: 34.0 },
    { segment: "C&I Loans", amount: 780000000, share: 25.0 },
    { segment: "Residential Mortgage", amount: 624000000, share: 20.0 },
    { segment: "Consumer Loans", amount: 374000000, share: 12.0 },
    { segment: "Construction", amount: 188000000, share: 6.0 },
    { segment: "Other", amount: 94000000, share: 3.0 },
  ],
  yearlyPerformance: [
    { year: 2022, totalAssets: 3240000000, netInterestIncome: 138400000, totalLoans: 2280000000, nim: 0.0412, roe: 0.1082 },
    { year: 2023, totalAssets: 3580000000, netInterestIncome: 152800000, totalLoans: 2520000000, nim: 0.0424, roe: 0.1148 },
    { year: 2024, totalAssets: 3890000000, netInterestIncome: 168200000, totalLoans: 2840000000, nim: 0.0432, roe: 0.1196 },
    { year: 2025, totalAssets: 4250000000, netInterestIncome: 186500000, totalLoans: 3120000000, nim: 0.0438, roe: 0.1245 },
  ],
};

const bankingRevenueData = {
  netInterestIncome: 186500000,
  nonInterestIncome: 42800000,
  feeIncome: 28600000,
  tradingRevenue: 14200000,
  totalRevenue: 229300000,
  operatingExpenses: 133400000,
  provisionForLosses: 18200000,
  netIncome: 47600000,
  revenueBySegment: [
    { segment: "Commercial Banking", revenue: 98400000, share: 42.9 },
    { segment: "Retail Banking", revenue: 62200000, share: 27.1 },
    { segment: "Wealth Management", revenue: 38800000, share: 16.9 },
    { segment: "Treasury Services", revenue: 29900000, share: 13.1 },
  ],
  monthlyRevenueTrend: [
    { date: "Jan 2024", value: 17800000 }, { date: "Apr 2024", value: 18200000 },
    { date: "Jul 2024", value: 18600000 }, { date: "Oct 2024", value: 19100000 },
    { date: "Jan 2025", value: 19500000 }, { date: "Apr 2025", value: 19800000 },
  ],
  rmLeaderboard: [
    { name: "Jennifer Walsh", portfolio: 420000000, revenue: 18900000, newClients: 28, clientRetention: 0.96, avgRelationshipSize: 15000000 },
    { name: "Marcus Chen", portfolio: 380000000, revenue: 17100000, newClients: 24, clientRetention: 0.95, avgRelationshipSize: 13800000 },
    { name: "Sarah Blackwell", portfolio: 340000000, revenue: 15300000, newClients: 22, clientRetention: 0.94, avgRelationshipSize: 12600000 },
    { name: "David Kumar", portfolio: 290000000, revenue: 13100000, newClients: 18, clientRetention: 0.93, avgRelationshipSize: 11200000 },
    { name: "Lisa Martinez", portfolio: 260000000, revenue: 11700000, newClients: 16, clientRetention: 0.92, avgRelationshipSize: 10400000 },
  ],
};

const bankingCustomerData = {
  totalCustomers: 248000,
  newCustomersYTD: 18400,
  customerRetention: 0.912,
  avgRelationshipValue: 17100,
  digitalAdoption: 0.784,
  nps: 62,
  customersBySegment: [
    { segment: "Mass Market", count: 168000, deposits: 1240000000, avgBalance: 7380 },
    { segment: "Mass Affluent", count: 52000, deposits: 1480000000, avgBalance: 28460 },
    { segment: "High Net Worth", count: 18000, deposits: 620000000, avgBalance: 34440 },
    { segment: "Commercial", count: 8200, deposits: 280000000, avgBalance: 34150 },
    { segment: "Institutional", count: 1800, deposits: 60000000, avgBalance: 33330 },
  ],
  acquisitionTrend: [
    { date: "Jan 2024", value: 1420 }, { date: "Apr 2024", value: 1580 },
    { date: "Jul 2024", value: 1640 }, { date: "Oct 2024", value: 1720 },
    { date: "Jan 2025", value: 1680 }, { date: "Apr 2025", value: 1840 },
  ],
  churnBySegment: [
    { segment: "Mass Market", churned: 8400, rate: 0.050, lostDeposits: 62000000 },
    { segment: "Mass Affluent", churned: 2600, rate: 0.050, lostDeposits: 74000000 },
    { segment: "High Net Worth", churned: 540, rate: 0.030, lostDeposits: 18600000 },
    { segment: "Commercial", churned: 410, rate: 0.050, lostDeposits: 14000000 },
  ],
};

const bankingRiskData = {
  nplRatio: 0.0134,
  chargeOffRate: 0.0042,
  allowanceRatio: 0.0168,
  riskWeightedAssets: 3400000000,
  tierOneCapital: 0.128,
  totalCapitalRatio: 0.148,
  liquidityCoverageRatio: 1.24,
  stressTestBuffer: 0.032,
  nplBySegment: [
    { segment: "Commercial Real Estate", npl: 18200000, ratio: 0.0172, provision: 4500000 },
    { segment: "C&I Loans", npl: 11700000, ratio: 0.0150, provision: 3200000 },
    { segment: "Consumer Loans", npl: 7500000, ratio: 0.0201, provision: 2800000 },
    { segment: "Residential Mortgage", npl: 4400000, ratio: 0.0071, provision: 1200000 },
  ],
  nplTrend: [
    { date: "Jan 2024", value: 0.0152 }, { date: "Apr 2024", value: 0.0148 },
    { date: "Jul 2024", value: 0.0142 }, { date: "Oct 2024", value: 0.0138 },
    { date: "Jan 2025", value: 0.0136 }, { date: "Apr 2025", value: 0.0134 },
  ],
  capitalTrend: [
    { date: "Jan 2024", value: 0.118 }, { date: "Apr 2024", value: 0.120 },
    { date: "Jul 2024", value: 0.122 }, { date: "Oct 2024", value: 0.124 },
    { date: "Jan 2025", value: 0.126 }, { date: "Apr 2025", value: 0.128 },
  ],
};

const bankingBranchData = {
  totalBranches: 124,
  digitalTransactions: 0.682,
  avgBranchRevenue: 1850000,
  costPerTransaction: 4.20,
  branchByRegion: [
    { region: "Northeast", branches: 38, deposits: 1180000000, efficiency: 0.92, revenue: 72400000 },
    { region: "Southeast", branches: 28, deposits: 980000000, efficiency: 0.88, revenue: 54200000 },
    { region: "Midwest", branches: 24, deposits: 820000000, efficiency: 0.85, revenue: 42800000 },
    { region: "West", branches: 20, deposits: 740000000, efficiency: 0.90, revenue: 38600000 },
    { region: "Southwest", branches: 14, deposits: 530000000, efficiency: 0.86, revenue: 21300000 },
  ],
  monthlyTransactionTrend: [
    { date: "Jan 2024", value: 2840000 }, { date: "Apr 2024", value: 2920000 },
    { date: "Jul 2024", value: 3010000 }, { date: "Oct 2024", value: 3080000 },
    { date: "Jan 2025", value: 3160000 }, { date: "Apr 2025", value: 3240000 },
  ],
};

const bankingDataMap: Record<string, Record<string, unknown>> = {
  executive: bankingExecutiveData as unknown as Record<string, unknown>,
  revenue: bankingRevenueData as unknown as Record<string, unknown>,
  customers: bankingCustomerData as unknown as Record<string, unknown>,
  risk: bankingRiskData as unknown as Record<string, unknown>,
  branches: bankingBranchData as unknown as Record<string, unknown>,
};

export const bankingConfig: TenantConfig = {
  id: "banking",
  branding: {
    name: "Gen-BI Asset",
    copilotName: "Banking Copilot",
    industry: "Commercial Banking",
    currencySymbol: "$",
    dateRange: "2022-2025",
  },
  sections: [
    {
      id: "executive",
      label: "Loan Portfolio Overview",
      route: "/",
      icon: "LayoutDashboard",
      kpis: [
        { id: "totalAssets", label: "Total Assets", dataKey: "totalAssets.current", format: "currency", icon: "Building", copilotQuestion: "Summarize our total assets position", changeKey: "totalAssets.changePercent" },
        { id: "nii", label: "Net Interest Income", dataKey: "netInterestIncome.current", format: "currency", icon: "DollarSign", copilotQuestion: "Analyze net interest income trends", changeKey: "netInterestIncome.changePercent" },
        { id: "totalLoans", label: "Total Loans", dataKey: "totalLoans.current", format: "currency", icon: "CreditCard", copilotQuestion: "Summarize loan portfolio growth", changeKey: "totalLoans.changePercent" },
        { id: "nim", label: "Net Interest Margin", dataKey: "nim", format: "percent", icon: "TrendingUp", copilotQuestion: "Analyze our net interest margin" },
        { id: "roe", label: "ROE", dataKey: "roe", format: "percent", icon: "ArrowUpRight", copilotQuestion: "Summarize return on equity performance" },
        { id: "nplRatio", label: "NPL Ratio", dataKey: "nplRatio", format: "percent", icon: "AlertTriangle", copilotQuestion: "Analyze non-performing loan ratio" },
        { id: "tier1", label: "Tier 1 Capital", dataKey: "tierOneCapital", format: "percent", icon: "Shield", copilotQuestion: "Analyze our capital adequacy" },
        { id: "efficiency", label: "Efficiency Ratio", dataKey: "efficiencyRatio", format: "percent", icon: "Activity", copilotQuestion: "Analyze our efficiency ratio" },
      ],
      charts: [
        { id: "niiTrend", title: "Net Interest Income Trend", type: "area", dataKey: "monthlyNIITrend", xKey: "date", yKeys: [{ key: "value", label: "NII" }] },
        { id: "loanGrowth", title: "Loan Portfolio Growth", type: "line", dataKey: "monthlyLoanGrowth", xKey: "date", yKeys: [{ key: "value", label: "Total Loans" }] },
        { id: "loanMix", title: "Loan Portfolio Mix", type: "pie", dataKey: "loanPortfolioMix", xKey: "segment", yKeys: [{ key: "amount", label: "Amount" }] },
      ],
      tables: [
        { id: "topRegions", title: "Top Regions by Assets", dataKey: "topRegionsByAssets", columns: [
          { key: "region", label: "Region", format: "text" },
          { key: "code", label: "Code", format: "text" },
          { key: "assets", label: "Assets", format: "currency" },
        ], copilotQuestionTemplate: "Analyze {region} performance" },
      ],
      widgets: [],
    },
    {
      id: "revenue",
      label: "Revenue Analytics",
      route: "/revenue",
      icon: "BarChart3",
      kpis: [
        { id: "totalRevenue", label: "Total Revenue", dataKey: "totalRevenue", format: "currency", icon: "DollarSign", copilotQuestion: "Summarize total revenue performance" },
        { id: "nii", label: "Net Interest Income", dataKey: "netInterestIncome", format: "currency", icon: "TrendingUp", copilotQuestion: "Analyze NII contribution" },
        { id: "nonII", label: "Non-Interest Income", dataKey: "nonInterestIncome", format: "currency", icon: "Layers", copilotQuestion: "Analyze non-interest income" },
        { id: "feeIncome", label: "Fee Income", dataKey: "feeIncome", format: "currency", icon: "Receipt", copilotQuestion: "Analyze fee income trends" },
        { id: "netIncome", label: "Net Income", dataKey: "netIncome", format: "currency", icon: "CheckCircle", copilotQuestion: "Summarize net income performance" },
        { id: "opex", label: "Operating Expenses", dataKey: "operatingExpenses", format: "currency", icon: "MinusCircle", copilotQuestion: "Analyze operating expenses" },
      ],
      charts: [
        { id: "revenueTrend", title: "Monthly Revenue Trend", type: "area", dataKey: "monthlyRevenueTrend", xKey: "date", yKeys: [{ key: "value", label: "Revenue" }] },
        { id: "revenueBySegment", title: "Revenue by Segment", type: "pie", dataKey: "revenueBySegment", xKey: "segment", yKeys: [{ key: "revenue", label: "Revenue" }] },
      ],
      tables: [
        { id: "rmLeaderboard", title: "Relationship Manager Leaderboard", dataKey: "rmLeaderboard", columns: [
          { key: "name", label: "Manager", format: "text" },
          { key: "portfolio", label: "Portfolio", format: "currency" },
          { key: "revenue", label: "Revenue", format: "currency" },
          { key: "newClients", label: "New Clients", format: "number" },
          { key: "clientRetention", label: "Retention", format: "percent" },
        ], copilotQuestionTemplate: "Analyze {name}'s portfolio performance" },
      ],
      widgets: [],
    },
    {
      id: "customers",
      label: "Customer Segments",
      route: "/customers",
      icon: "Users",
      kpis: [
        { id: "totalCustomers", label: "Total Customers", dataKey: "totalCustomers", format: "number", icon: "Users", copilotQuestion: "Summarize customer base" },
        { id: "newCustomers", label: "New Customers YTD", dataKey: "newCustomersYTD", format: "number", icon: "UserPlus", copilotQuestion: "Analyze new customer acquisition" },
        { id: "retention", label: "Customer Retention", dataKey: "customerRetention", format: "percent", icon: "Heart", copilotQuestion: "Analyze customer retention" },
        { id: "digitalAdoption", label: "Digital Adoption", dataKey: "digitalAdoption", format: "percent", icon: "Smartphone", copilotQuestion: "Analyze digital adoption rate" },
        { id: "nps", label: "NPS Score", dataKey: "nps", format: "number", icon: "ThumbsUp", copilotQuestion: "Analyze NPS trends" },
        { id: "avgValue", label: "Avg Relationship Value", dataKey: "avgRelationshipValue", format: "currency", icon: "DollarSign", copilotQuestion: "Analyze average relationship value" },
      ],
      charts: [
        { id: "acquisitionTrend", title: "Customer Acquisition Trend", type: "line", dataKey: "acquisitionTrend", xKey: "date", yKeys: [{ key: "value", label: "New Customers" }] },
      ],
      tables: [
        { id: "customersBySegment", title: "Customers by Segment", dataKey: "customersBySegment", columns: [
          { key: "segment", label: "Segment", format: "text" },
          { key: "count", label: "Customers", format: "number" },
          { key: "deposits", label: "Deposits", format: "currency" },
          { key: "avgBalance", label: "Avg Balance", format: "currency" },
        ], copilotQuestionTemplate: "Analyze {segment} segment in detail" },
        { id: "churnBySegment", title: "Churn by Segment", dataKey: "churnBySegment", columns: [
          { key: "segment", label: "Segment", format: "text" },
          { key: "churned", label: "Churned", format: "number" },
          { key: "rate", label: "Churn Rate", format: "percent" },
          { key: "lostDeposits", label: "Lost Deposits", format: "currency" },
        ], copilotQuestionTemplate: "Analyze {segment} churn drivers" },
      ],
      widgets: [],
    },
    {
      id: "risk",
      label: "Risk & Compliance",
      route: "/risk",
      icon: "Shield",
      kpis: [
        { id: "nplRatio", label: "NPL Ratio", dataKey: "nplRatio", format: "percent", icon: "AlertTriangle", copilotQuestion: "Analyze NPL trends" },
        { id: "chargeOff", label: "Charge-Off Rate", dataKey: "chargeOffRate", format: "percent", icon: "TrendingDown", copilotQuestion: "Analyze charge-off rate" },
        { id: "tier1", label: "Tier 1 Capital", dataKey: "tierOneCapital", format: "percent", icon: "Shield", copilotQuestion: "Analyze capital adequacy" },
        { id: "totalCapital", label: "Total Capital Ratio", dataKey: "totalCapitalRatio", format: "percent", icon: "Lock", copilotQuestion: "Analyze total capital ratio" },
        { id: "lcr", label: "Liquidity Coverage", dataKey: "liquidityCoverageRatio", format: "ratio", icon: "Droplet", copilotQuestion: "Analyze liquidity coverage ratio" },
        { id: "allowance", label: "Allowance Ratio", dataKey: "allowanceRatio", format: "percent", icon: "Percent", copilotQuestion: "Analyze loan loss allowance" },
      ],
      charts: [
        { id: "nplTrend", title: "NPL Ratio Trend", type: "line", dataKey: "nplTrend", xKey: "date", yKeys: [{ key: "value", label: "NPL Ratio" }] },
        { id: "capitalTrend", title: "Tier 1 Capital Trend", type: "area", dataKey: "capitalTrend", xKey: "date", yKeys: [{ key: "value", label: "Tier 1 Capital" }] },
      ],
      tables: [
        { id: "nplBySegment", title: "NPL by Loan Segment", dataKey: "nplBySegment", columns: [
          { key: "segment", label: "Segment", format: "text" },
          { key: "npl", label: "NPL Amount", format: "currency" },
          { key: "ratio", label: "NPL Ratio", format: "percent" },
          { key: "provision", label: "Provision", format: "currency" },
        ], copilotQuestionTemplate: "Analyze {segment} credit risk" },
      ],
      widgets: [],
    },
    {
      id: "branches",
      label: "Branch Performance",
      route: "/branches",
      icon: "Building",
      kpis: [
        { id: "totalBranches", label: "Total Branches", dataKey: "totalBranches", format: "number", icon: "Building", copilotQuestion: "Summarize branch network" },
        { id: "digitalTx", label: "Digital Transactions", dataKey: "digitalTransactions", format: "percent", icon: "Smartphone", copilotQuestion: "Analyze digital vs branch transactions" },
        { id: "avgRevenue", label: "Avg Branch Revenue", dataKey: "avgBranchRevenue", format: "currency", icon: "DollarSign", copilotQuestion: "Analyze average branch revenue" },
        { id: "costPerTx", label: "Cost per Transaction", dataKey: "costPerTransaction", format: "currency", icon: "Receipt", copilotQuestion: "Analyze transaction costs" },
      ],
      charts: [
        { id: "txTrend", title: "Monthly Transaction Trend", type: "line", dataKey: "monthlyTransactionTrend", xKey: "date", yKeys: [{ key: "value", label: "Transactions" }] },
      ],
      tables: [
        { id: "branchByRegion", title: "Performance by Region", dataKey: "branchByRegion", columns: [
          { key: "region", label: "Region", format: "text" },
          { key: "branches", label: "Branches", format: "number" },
          { key: "deposits", label: "Deposits", format: "currency" },
          { key: "revenue", label: "Revenue", format: "currency" },
          { key: "efficiency", label: "Efficiency", format: "percent" },
        ], copilotQuestionTemplate: "Analyze {region} branch performance" },
      ],
      widgets: [],
    },
  ],
  prompt: {
    persona: `You are {copilotName}, a Gen-BI (Generative Business Intelligence) analytics engine for {name}. You combine conversational AI with dynamic data visualization. You have FULL ACCESS to all {industry} data from {dateRange}.`,
    domainTerminology: [
      "NII", "Net Interest Margin", "NIM", "ROE", "ROA", "NPL", "Non-Performing Loans",
      "Tier 1 Capital", "CET1", "Risk-Weighted Assets", "Efficiency Ratio",
      "Loan-to-Deposit Ratio", "Cost of Funds", "Charge-Off Rate", "Provision",
      "LCR", "Liquidity Coverage Ratio", "NPS", "Digital Adoption",
    ],
    fewShotExamples: [
      {
        user: "Show me the loan portfolio breakdown",
        assistant: `Commercial Real Estate leads our loan book at **$1.06B (34%)**, followed by C&I Loans at **$780M (25%)**. The portfolio is well-diversified across 6 segments.
[CHART:{"type":"pie","title":"Loan Portfolio Mix","xKey":"segment","yKey":"amount","data":[{"segment":"CRE","amount":1060000000},{"segment":"C&I","amount":780000000},{"segment":"Residential","amount":624000000},{"segment":"Consumer","amount":374000000},{"segment":"Construction","amount":188000000},{"segment":"Other","amount":94000000}]}]`,
      },
      {
        user: "What's our NPL trend?",
        assistant: `Our NPL ratio has improved from **1.52%** in Jan 2024 to **1.34%** currently, showing a consistent downward trend driven by stronger underwriting and active workout strategies.
[CHART:{"type":"line","title":"NPL Ratio Trend","xKey":"date","yKey":"ratio","data":[{"date":"Jan 2024","ratio":1.52},{"date":"Apr 2024","ratio":1.48},{"date":"Jul 2024","ratio":1.42},{"date":"Oct 2024","ratio":1.38},{"date":"Jan 2025","ratio":1.36},{"date":"Apr 2025","ratio":1.34}]}]
[NAVIGATE:/risk]`,
      },
    ],
    suggestedPrompts: [
      "Show me the loan portfolio breakdown",
      "What's our NPL trend?",
      "Compare revenue by business segment",
      "Which relationship manager has the best performance?",
      "Show customer acquisition trends",
      "Analyze our capital adequacy ratios",
      "What's the efficiency ratio trend?",
      "Compare branch performance by region",
    ],
    clickToAskTemplates: {
      kpi: "Summarize {label} performance and trends",
      tableRow: "Analyze {value} in detail",
      chart: "Explain the {title} chart",
    },
  },
  dataSources: {
    executive: { type: "static", module: "banking-executive" },
    revenue: { type: "static", module: "banking-revenue" },
    customers: { type: "static", module: "banking-customers" },
    risk: { type: "static", module: "banking-risk" },
    branches: { type: "static", module: "banking-branches" },
  },
};

export function getBankingDataForSection(sectionId: string): Record<string, unknown> {
  return bankingDataMap[sectionId] || {};
}

export function buildBankingDataContext(): string {
  const yearly = bankingExecutiveData.yearlyPerformance.map(y =>
    `${y.year}: Assets=$${(y.totalAssets/1e9).toFixed(2)}B, NII=$${(y.netInterestIncome/1e6).toFixed(1)}M, Loans=$${(y.totalLoans/1e9).toFixed(2)}B, NIM=${(y.nim*100).toFixed(2)}%, ROE=${(y.roe*100).toFixed(2)}%`
  ).join('\n');

  return `
YEARLY PERFORMANCE:
${yearly}

CURRENT PERIOD (2025):
- Total Assets: $${(bankingExecutiveData.totalAssets.current/1e9).toFixed(2)}B (+${bankingExecutiveData.totalAssets.changePercent}% YoY)
- Net Interest Income: $${(bankingExecutiveData.netInterestIncome.current/1e6).toFixed(1)}M (+${bankingExecutiveData.netInterestIncome.changePercent}% YoY)
- Total Loans: $${(bankingExecutiveData.totalLoans.current/1e9).toFixed(2)}B (+${bankingExecutiveData.totalLoans.changePercent}% YoY)
- NIM: ${(bankingExecutiveData.nim*100).toFixed(2)}%
- ROE: ${(bankingExecutiveData.roe*100).toFixed(2)}%
- Efficiency Ratio: ${(bankingExecutiveData.efficiencyRatio*100).toFixed(1)}%
- NPL Ratio: ${(bankingExecutiveData.nplRatio*100).toFixed(2)}%
- Tier 1 Capital: ${(bankingExecutiveData.tierOneCapital*100).toFixed(1)}%

LOAN PORTFOLIO MIX:
${bankingExecutiveData.loanPortfolioMix.map(l => `${l.segment}: $${(l.amount/1e6).toFixed(0)}M (${l.share}%)`).join('\n')}

TOP REGIONS: ${bankingExecutiveData.topRegionsByAssets.map(r => `${r.region} ($${(r.assets/1e9).toFixed(2)}B)`).join(', ')}

REVENUE BREAKDOWN:
- Total Revenue: $${(bankingRevenueData.totalRevenue/1e6).toFixed(1)}M
- Net Interest Income: $${(bankingRevenueData.netInterestIncome/1e6).toFixed(1)}M
- Non-Interest Income: $${(bankingRevenueData.nonInterestIncome/1e6).toFixed(1)}M
- Net Income: $${(bankingRevenueData.netIncome/1e6).toFixed(1)}M

REVENUE BY SEGMENT:
${bankingRevenueData.revenueBySegment.map(s => `${s.segment}: $${(s.revenue/1e6).toFixed(1)}M (${s.share}%)`).join('\n')}

RELATIONSHIP MANAGERS:
${bankingRevenueData.rmLeaderboard.map(r => `${r.name}: Portfolio=$${(r.portfolio/1e6).toFixed(0)}M, Revenue=$${(r.revenue/1e6).toFixed(1)}M, New Clients=${r.newClients}, Retention=${(r.clientRetention*100).toFixed(1)}%`).join('\n')}

CUSTOMER BASE:
- Total: ${bankingCustomerData.totalCustomers.toLocaleString()}, New YTD: ${bankingCustomerData.newCustomersYTD.toLocaleString()}
- Retention: ${(bankingCustomerData.customerRetention*100).toFixed(1)}%, Digital Adoption: ${(bankingCustomerData.digitalAdoption*100).toFixed(1)}%, NPS: ${bankingCustomerData.nps}

RISK METRICS:
- NPL Ratio: ${(bankingRiskData.nplRatio*100).toFixed(2)}%, Charge-Off: ${(bankingRiskData.chargeOffRate*100).toFixed(2)}%
- Tier 1: ${(bankingRiskData.tierOneCapital*100).toFixed(1)}%, Total Capital: ${(bankingRiskData.totalCapitalRatio*100).toFixed(1)}%
- LCR: ${bankingRiskData.liquidityCoverageRatio}x

NPL BY SEGMENT:
${bankingRiskData.nplBySegment.map(n => `${n.segment}: NPL=$${(n.npl/1e6).toFixed(1)}M, Ratio=${(n.ratio*100).toFixed(2)}%`).join('\n')}

BRANCH NETWORK:
- ${bankingBranchData.totalBranches} branches, Digital TX: ${(bankingBranchData.digitalTransactions*100).toFixed(1)}%
${bankingBranchData.branchByRegion.map(b => `${b.region}: ${b.branches} branches, Deposits=$${(b.deposits/1e6).toFixed(0)}M, Revenue=$${(b.revenue/1e6).toFixed(1)}M`).join('\n')}`;
}
