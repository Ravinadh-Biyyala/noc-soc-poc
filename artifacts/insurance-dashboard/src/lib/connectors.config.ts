import { Cloud, Database, FolderOpen, Snowflake, Layers, Sheet, type LucideIcon } from "lucide-react";

export type ConnectorFieldType = "text" | "url" | "password" | "select" | "multiselect" | "textarea";

export interface ConnectorField {
  key: string;
  label: string;
  type: ConnectorFieldType;
  placeholder?: string;
  options?: string[];
  required?: boolean;
}

export interface ConnectorConfig {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  accent: string;
  fields: ConnectorField[];
  /** Sample CSV under /samples/ this connector "pulls" for the demo. */
  sampleFile: string;
  /** Friendly label for the pulled dataset. */
  sampleLabel: string;
  /** Plausible "discovered" preview shown after Test connection succeeds. */
  discovery: string;
  /** When true, the dialog renders a real picker for this connector instead
   *  of the demo credential form. */
  live?: boolean;
}

export const CONNECTORS: ConnectorConfig[] = [
  {
    id: "google-sheets",
    label: "Google Sheets",
    description: "Browse your Google Drive and pull a real spreadsheet into Gen-BI.",
    icon: Sheet,
    accent: "text-green-700 bg-green-50 border-green-200",
    fields: [],
    sampleFile: "",
    sampleLabel: "Google Sheets",
    discovery: "Signed in to Google. Listing spreadsheets you can read.",
    live: true,
  },
  {
    id: "salesforce",
    label: "Salesforce",
    description: "Pull Accounts, Opportunities and Cases via REST or SOQL.",
    icon: Cloud,
    accent: "text-sky-700 bg-sky-50 border-sky-200",
    fields: [
      { key: "instanceUrl", label: "Instance URL", type: "url", placeholder: "https://acme.my.salesforce.com", required: true },
      { key: "authType", label: "Authentication", type: "select", options: ["OAuth 2.0", "Username + Security Token"], required: true },
      { key: "username", label: "Username", type: "text", placeholder: "user@acme.com" },
      { key: "objects", label: "Objects to pull", type: "multiselect", options: ["Account", "Opportunity", "Contact", "Case", "Lead"] },
      { key: "soql", label: "Or paste SOQL (optional)", type: "textarea", placeholder: "SELECT Id, Name, Amount FROM Opportunity WHERE CloseDate = THIS_QUARTER" },
    ],
    sampleFile: "orders.csv",
    sampleLabel: "Salesforce — Opportunity (sandbox)",
    discovery: "Found 47,128 rows across 5 objects. Most recent sync 3 minutes ago.",
  },
  {
    id: "snowflake",
    label: "Snowflake",
    description: "Query a warehouse, database and schema in your Snowflake account.",
    icon: Snowflake,
    accent: "text-cyan-700 bg-cyan-50 border-cyan-200",
    fields: [
      { key: "account", label: "Account", type: "text", placeholder: "abc-xy12345.us-east-1", required: true },
      { key: "warehouse", label: "Warehouse", type: "text", placeholder: "COMPUTE_WH", required: true },
      { key: "database", label: "Database", type: "text", placeholder: "ANALYTICS" },
      { key: "schema", label: "Schema", type: "text", placeholder: "PUBLIC" },
      { key: "role", label: "Role", type: "text", placeholder: "READ_ONLY" },
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
      { key: "query", label: "Query (optional)", type: "textarea", placeholder: "SELECT * FROM ANALYTICS.PUBLIC.CUSTOMERS LIMIT 10000" },
    ],
    sampleFile: "customers.csv",
    sampleLabel: "Snowflake — ANALYTICS.PUBLIC.CUSTOMERS",
    discovery: "Connected to ANALYTICS warehouse. 12 schemas, 184 tables visible to this role.",
  },
  {
    id: "databricks",
    label: "Databricks",
    description: "Pull tables from Unity Catalog or run a SQL Warehouse query.",
    icon: Layers,
    accent: "text-orange-700 bg-orange-50 border-orange-200",
    fields: [
      { key: "host", label: "Workspace URL", type: "url", placeholder: "https://acme.cloud.databricks.com", required: true },
      { key: "httpPath", label: "HTTP Path", type: "text", placeholder: "/sql/1.0/warehouses/abc123" },
      { key: "token", label: "Personal Access Token", type: "password", required: true },
      { key: "catalog", label: "Catalog", type: "text", placeholder: "main" },
      { key: "schema", label: "Schema", type: "text", placeholder: "default" },
      { key: "table", label: "Table or query", type: "textarea", placeholder: "SELECT * FROM main.default.products" },
    ],
    sampleFile: "products.csv",
    sampleLabel: "Databricks — main.default.products",
    discovery: "SQL Warehouse online. Catalog 'main' has 38 tables, lineage available.",
  },
  {
    id: "sharepoint",
    label: "SharePoint",
    description: "Pull files from a SharePoint site or document library.",
    icon: FolderOpen,
    accent: "text-indigo-700 bg-indigo-50 border-indigo-200",
    fields: [
      { key: "siteUrl", label: "Site URL", type: "url", placeholder: "https://acme.sharepoint.com/sites/Procurement", required: true },
      { key: "authType", label: "Authentication", type: "select", options: ["Microsoft 365 OAuth", "App-only"] },
      { key: "library", label: "Document library", type: "text", placeholder: "Shared Documents" },
      { key: "folder", label: "Folder path (optional)", type: "text", placeholder: "/Vendor Certs/2026" },
      { key: "fileTypes", label: "File types", type: "multiselect", options: ["xlsx", "csv", "pdf", "docx"] },
    ],
    sampleFile: "products.csv",
    sampleLabel: "SharePoint — Vendor Master.xlsx",
    discovery: "Authenticated. 312 files in /Shared Documents. Latest change 2 hours ago.",
  },
  {
    id: "postgres",
    label: "Postgres",
    description: "Connect to any Postgres database, browse tables and build a joined dashboard.",
    icon: Database,
    accent: "text-emerald-700 bg-emerald-50 border-emerald-200",
    fields: [],
    sampleFile: "",
    sampleLabel: "Postgres",
    discovery: "Connected.",
    live: true,
  },
];

export function getConnector(id: string): ConnectorConfig | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
