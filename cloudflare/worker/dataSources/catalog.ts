export type ConnectorCategory = "warehouse" | "object_storage" | "database" | "billing" | "invoicing";
export type SyncMode = "http" | "gateway";
export type FieldType = "text" | "password" | "url" | "select" | "textarea";

export type CatalogField = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  config?: boolean; // stored in config_json even if secret=false; default: !secret
};

export type MappingTarget = {
  id: string;
  table: string;
  label: string;
  fields: string[];
};

export type ConnectorDef = {
  id: string;
  title: string;
  vendor: string;
  category: ConnectorCategory;
  sync_mode: SyncMode;
  summary: string;
  honesty: string;
  docs_url?: string;
  fields: CatalogField[];
  mapping_targets: string[];
  probe_name: string;
};

export const MAPPING_TARGETS: MappingTarget[] = [
  { id: "authorizations", table: "ra_authorizations", label: "Authorizations", fields: ["auth_id", "merchant_id", "ts", "amount", "currency", "scheme", "status"] },
  { id: "captures", table: "ra_captures", label: "Captures", fields: ["capture_id", "auth_id", "ts", "amount"] },
  { id: "scheme_settlements", table: "ra_scheme_settlements", label: "Scheme settlements", fields: ["settlement_id", "scheme", "gross", "fees", "net"] },
  { id: "bank_transactions", table: "ra_bank_transactions", label: "Bank / TRS", fields: ["trs_id", "amount", "value_date", "reference"] },
  { id: "invoices", table: "ra_merchant_invoices", label: "Merchant invoices", fields: ["invoice_id", "merchant_id", "amount", "issued_at", "status"] },
  { id: "gateway_charges", table: "ra_gateway_charges", label: "Gateway / billing charges", fields: ["charge_id", "amount", "fee", "ts"] },
  { id: "payouts", table: "ra_payouts", label: "Payouts", fields: ["payout_id", "merchant_id", "amount", "paid_at"] },
  { id: "chargebacks", table: "ra_chargebacks", label: "Chargebacks", fields: ["cb_id", "capture_id", "amount", "reason"] },
  { id: "refunds", table: "ra_refunds", label: "Refunds", fields: ["refund_id", "amount", "ts"] },
  { id: "fx", table: "ra_fx_conversions", label: "FX conversions", fields: ["fx_id", "from_ccy", "to_ccy", "amount", "rate"] },
  { id: "objects", table: "ra_ingest_files", label: "Ingested files / objects", fields: ["file_id", "name", "bytes", "received_at"] },
];

const BILLING_TARGETS = ["gateway_charges", "refunds", "payouts"];
const INVOICE_TARGETS = ["invoices", "gateway_charges", "payouts"];
const WAREHOUSE_TARGETS = ["authorizations", "captures", "scheme_settlements", "bank_transactions", "invoices", "payouts"];
const OBJECT_TARGETS = ["objects", "scheme_settlements", "bank_transactions"];
const DB_TARGETS = WAREHOUSE_TARGETS;

function f(name: string, label: string, type: FieldType, extra: Partial<CatalogField> = {}): CatalogField {
  return { name, label, type, ...extra };
}

export const CONNECTORS: ConnectorDef[] = [
  {
    id: "snowflake",
    title: "Snowflake",
    vendor: "Snowflake",
    category: "warehouse",
    sync_mode: "http",
    summary: "Warehouse queries over the Snowflake SQL API.",
    honesty: "Workers can call the Snowflake SQL API over HTTPS with a programmatic access token. Username/password-only accounts cannot be tested from this Worker. A failed probe is reported as a failure.",
    docs_url: "https://docs.snowflake.com/en/developer-guide/sql-api/index",
    fields: [
      f("account", "Account identifier", "text", { required: true, placeholder: "xy12345.us-east-1", help: "Used as https://{account}.snowflakecomputing.com" }),
      f("warehouse", "Warehouse", "text"),
      f("database", "Database", "text"),
      f("schema", "Schema", "text", { placeholder: "PUBLIC" }),
      f("role", "Role", "text"),
      f("token", "Programmatic access token", "password", { required: true, secret: true }),
    ],
    mapping_targets: WAREHOUSE_TARGETS,
    probe_name: "SQL API POST /api/v2/statements (SELECT 1)",
  },
  {
    id: "databricks",
    title: "Databricks",
    vendor: "Databricks",
    category: "warehouse",
    sync_mode: "http",
    summary: "SQL warehouses over the Statement Execution API.",
    honesty: "Workers can call the Databricks SQL Statement Execution API over HTTPS with a workspace host, warehouse ID, and personal access token. The test runs a short SELECT and reports the real HTTP result.",
    docs_url: "https://docs.databricks.com/api/workspace/statementexecution",
    fields: [
      f("host", "Workspace host", "url", { required: true, placeholder: "https://adb-xxxx.azuredatabricks.net" }),
      f("warehouse_id", "SQL warehouse ID", "text", { required: true }),
      f("catalog", "Catalog", "text"),
      f("schema", "Schema", "text"),
      f("token", "Personal access token", "password", { required: true, secret: true }),
    ],
    mapping_targets: WAREHOUSE_TARGETS,
    probe_name: "Statement Execution API SELECT 1",
  },
  {
    id: "aws_s3",
    title: "Amazon S3",
    vendor: "Amazon Web Services",
    category: "object_storage",
    sync_mode: "http",
    summary: "Object listings over the S3 REST API.",
    honesty: "Workers can call S3 HTTPS REST with an access key (SigV4). The test is a HeadBucket or ListObjects request to the named bucket and reports the real status. This is not a file ingest until you map prefixes and run a sync.",
    docs_url: "https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html",
    fields: [
      f("bucket", "Bucket", "text", { required: true }),
      f("region", "Region", "text", { required: true, placeholder: "ap-south-1" }),
      f("prefix", "Prefix", "text"),
      f("access_key_id", "Access key ID", "text", { required: true, secret: true }),
      f("secret_access_key", "Secret access key", "password", { required: true, secret: true }),
    ],
    mapping_targets: OBJECT_TARGETS,
    probe_name: "S3 ListObjectsV2 (max-keys=1)",
  },
  {
    id: "gcs",
    title: "Google Cloud Storage",
    vendor: "Google Cloud",
    category: "object_storage",
    sync_mode: "http",
    summary: "Object listings over the GCS JSON API.",
    honesty: "Workers can call the GCS JSON API over HTTPS with an OAuth access token or a service-account access token you paste here. This form does not mint tokens from a JSON key on the free plan. The test lists one object and reports the real status.",
    docs_url: "https://cloud.google.com/storage/docs/json_api",
    fields: [
      f("bucket", "Bucket", "text", { required: true }),
      f("prefix", "Prefix", "text"),
      f("access_token", "OAuth access token", "password", { required: true, secret: true, help: "A short-lived token. Service-account JSON keys are not uploaded." }),
    ],
    mapping_targets: OBJECT_TARGETS,
    probe_name: "GET storage/v1/b/{bucket}/o?maxResults=1",
  },
  {
    id: "bigquery",
    title: "BigQuery",
    vendor: "Google Cloud",
    category: "warehouse",
    sync_mode: "http",
    summary: "Queries over the BigQuery REST API.",
    honesty: "Workers can call BigQuery’s REST jobs.query API over HTTPS with a project ID and an OAuth access token. The test runs SELECT 1 and reports the real status. This Worker does not complete Google OAuth for you.",
    docs_url: "https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query",
    fields: [
      f("project_id", "Project ID", "text", { required: true }),
      f("location", "Location", "text", { placeholder: "US" }),
      f("access_token", "OAuth access token", "password", { required: true, secret: true }),
    ],
    mapping_targets: WAREHOUSE_TARGETS,
    probe_name: "jobs.query SELECT 1",
  },
  {
    id: "azure_blob",
    title: "Azure Blob Storage",
    vendor: "Microsoft Azure",
    category: "object_storage",
    sync_mode: "http",
    summary: "Container listings over Blob REST.",
    honesty: "Workers can call Azure Blob HTTPS REST with an account and a SAS token (recommended) or an account key. The test lists one blob and reports the real status.",
    docs_url: "https://learn.microsoft.com/en-us/rest/api/storageservices/list-blobs",
    fields: [
      f("account", "Storage account", "text", { required: true }),
      f("container", "Container", "text", { required: true }),
      f("prefix", "Prefix", "text"),
      f("sas_token", "SAS token", "password", { secret: true, help: "Preferred. Include the leading ? or not; both work." }),
      f("account_key", "Account key", "password", { secret: true, help: "Used only if no SAS token is saved." }),
    ],
    mapping_targets: OBJECT_TARGETS,
    probe_name: "List Blobs (maxresults=1)",
  },
  {
    id: "postgres",
    title: "Postgres",
    vendor: "PostgreSQL",
    category: "database",
    sync_mode: "http",
    summary: "SQL over Neon’s HTTP driver (or another HTTP Postgres gateway).",
    honesty: "A Cloudflare Worker on the free plan cannot open a raw TCP connection to port 5432. This connector uses the Neon HTTP driver, which works for Neon (and other HTTP Postgres endpoints). A conventional self-hosted Postgres without an HTTP proxy will fail the test — that is expected. Cloudflare Hyperdrive is an option if you later move off the free plan.",
    docs_url: "https://www.neondatabase.com/docs/serverless/serverless-driver",
    fields: [
      f("connection_uri", "Connection URI", "password", { required: true, secret: true, placeholder: "postgresql://user:pass@host/db?sslmode=require" }),
    ],
    mapping_targets: DB_TARGETS,
    probe_name: "SELECT 1 via Neon HTTP driver",
  },
  {
    id: "mysql",
    title: "MySQL",
    vendor: "MySQL",
    category: "database",
    sync_mode: "gateway",
    summary: "Configuration only unless you provide an HTTPS gateway.",
    honesty: "Workers on the free plan cannot open a raw MySQL TCP socket. Cloudflare Hyperdrive can proxy MySQL on a paid Workers plan; otherwise you need your own HTTPS gateway. If you paste a gateway URL, the test will call it and report the real HTTP status. Without one, Test will not succeed.",
    fields: [
      f("host", "Host", "text", { required: true }),
      f("port", "Port", "text", { placeholder: "3306" }),
      f("database", "Database", "text"),
      f("username", "Username", "text"),
      f("password", "Password", "password", { secret: true }),
      f("gateway_url", "HTTPS gateway URL", "url", { help: "Optional. If set, Test sends a GET and reports the live response." }),
    ],
    mapping_targets: DB_TARGETS,
    probe_name: "Gateway GET only (no raw TCP)",
  },
  {
    id: "mongodb",
    title: "MongoDB",
    vendor: "MongoDB",
    category: "database",
    sync_mode: "gateway",
    summary: "Configuration only unless you provide an HTTPS Data API or gateway.",
    honesty: "The MongoDB wire protocol is TCP and is not available from a free-plan Worker. The Atlas Data API (if you still have an endpoint) or a custom HTTPS gateway can be tested if you provide its URL. Otherwise Test will not succeed.",
    fields: [
      f("srv", "Connection SRV / host", "text", { required: true, placeholder: "cluster.abc.mongodb.net" }),
      f("database", "Database", "text"),
      f("username", "Username", "text"),
      f("password", "Password", "password", { secret: true }),
      f("gateway_url", "HTTPS Data API or gateway URL", "url"),
    ],
    mapping_targets: DB_TARGETS,
    probe_name: "Gateway GET only (no Mongo TCP)",
  },
  {
    id: "oracle",
    title: "Oracle Database",
    vendor: "Oracle",
    category: "database",
    sync_mode: "gateway",
    summary: "Configuration only — Oracle Net/TCPS is not reachable from this Worker.",
    honesty: "Oracle Database connections use Oracle Net (TCP/TCPS), which a Cloudflare Worker on the free plan cannot open. There is no Hyperdrive target for Oracle here. Save the form for inventory, or point gateway_url at a TLS service you operate. Test will not succeed without a reachable HTTPS gateway.",
    fields: [
      f("host", "Host", "text", { required: true }),
      f("port", "Port", "text", { placeholder: "1521" }),
      f("service_name", "Service name", "text"),
      f("username", "Username", "text"),
      f("password", "Password", "password", { secret: true }),
      f("gateway_url", "HTTPS gateway URL", "url"),
    ],
    mapping_targets: DB_TARGETS,
    probe_name: "Gateway GET only (no Oracle Net)",
  },
  {
    id: "hive",
    title: "Apache Hive",
    vendor: "Apache Hive",
    category: "warehouse",
    sync_mode: "gateway",
    summary: "Configuration only — HiveServer2/Thrift is not reachable from this Worker.",
    honesty: "HiveServer2 speaks Thrift/TCP (or JDBC), not a public HTTPS SQL API that this Worker can call on the free plan. Save the form, or provide an HTTPS gateway URL. Test will not succeed without one.",
    fields: [
      f("host", "HiveServer2 host", "text", { required: true }),
      f("port", "Port", "text", { placeholder: "10000" }),
      f("database", "Database", "text"),
      f("username", "Username", "text"),
      f("password", "Password", "password", { secret: true }),
      f("gateway_url", "HTTPS gateway URL", "url"),
    ],
    mapping_targets: WAREHOUSE_TARGETS,
    probe_name: "Gateway GET only (no Thrift/TCP)",
  },
  {
    id: "stripe",
    title: "Stripe",
    vendor: "Stripe",
    category: "billing",
    sync_mode: "http",
    summary: "Charges, refunds and payouts over the Stripe API.",
    honesty: "Workers can call api.stripe.com over HTTPS. The test retrieves /v1/balance with the secret key and reports the real status. Restricted keys work if they can read Balance.",
    docs_url: "https://docs.stripe.com/api",
    fields: [
      f("secret_key", "Secret key", "password", { required: true, secret: true, placeholder: "sk_live_… or sk_test_…" }),
    ],
    mapping_targets: BILLING_TARGETS,
    probe_name: "GET /v1/balance",
  },
  {
    id: "chargebee",
    title: "Chargebee",
    vendor: "Chargebee",
    category: "billing",
    sync_mode: "http",
    summary: "Subscriptions and invoices over the Chargebee API.",
    honesty: "Workers can call {site}.chargebee.com/api over HTTPS with an API key. The test lists one subscription (or the index) and reports the real status.",
    docs_url: "https://apidocs.chargebee.com/",
    fields: [
      f("site", "Site name", "text", { required: true, placeholder: "mycompany" }),
      f("api_key", "API key", "password", { required: true, secret: true }),
    ],
    mapping_targets: BILLING_TARGETS,
    probe_name: "GET /api/v2/subscriptions?limit=1",
  },
  {
    id: "zuora",
    title: "Zuora",
    vendor: "Zuora",
    category: "billing",
    sync_mode: "http",
    summary: "Billing objects over the Zuora REST API.",
    honesty: "Workers can call rest.zuora.com (or a custom REST endpoint) over HTTPS with an OAuth client-credentials token or an API access token you paste. The test calls GET /v1/connections (or /v1/catalog/products) and reports the real status.",
    docs_url: "https://developer.zuora.com/docs/guides/quick-start/",
    fields: [
      f("base_url", "REST base URL", "url", { required: true, placeholder: "https://rest.zuora.com" }),
      f("client_id", "OAuth client ID", "text", { secret: true }),
      f("client_secret", "OAuth client secret", "password", { secret: true }),
      f("access_token", "Access token (optional if client credentials are set)", "password", { secret: true }),
    ],
    mapping_targets: BILLING_TARGETS,
    probe_name: "Zuora REST GET /v1/connections",
  },
  {
    id: "recurly",
    title: "Recurly",
    vendor: "Recurly",
    category: "billing",
    sync_mode: "http",
    summary: "Accounts and invoices over the Recurly API.",
    honesty: "Workers can call v3.recurly.com over HTTPS with an API key (HTTP Basic). The test gets site information and reports the real status.",
    docs_url: "https://docs.recurly.com/docs/api",
    fields: [
      f("api_key", "API key", "password", { required: true, secret: true }),
      f("region", "Region", "select", { options: [{ value: "us", label: "US (v3.recurly.com)" }, { value: "eu", label: "EU (v3.eu.recurly.com)" }] }),
    ],
    mapping_targets: BILLING_TARGETS,
    probe_name: "GET /sites (Recurly v3)",
  },
  {
    id: "razorpay",
    title: "Razorpay",
    vendor: "Razorpay",
    category: "billing",
    sync_mode: "http",
    summary: "Payments and settlements over the Razorpay API.",
    honesty: "Workers can call api.razorpay.com over HTTPS with key ID and secret (HTTP Basic). The test lists one payment and reports the real status.",
    docs_url: "https://razorpay.com/docs/api/",
    fields: [
      f("key_id", "Key ID", "text", { required: true, secret: true }),
      f("key_secret", "Key secret", "password", { required: true, secret: true }),
    ],
    mapping_targets: BILLING_TARGETS,
    probe_name: "GET /v1/payments?count=1",
  },
  {
    id: "quickbooks",
    title: "QuickBooks",
    vendor: "Intuit",
    category: "invoicing",
    sync_mode: "http",
    summary: "Invoices over the QuickBooks Online Accounting API.",
    honesty: "Workers can call the QBO API over HTTPS if you paste a valid OAuth 2 access token and realm ID. This app does not run Intuit’s OAuth consent screen on the free plan. Without a token, Test will not succeed.",
    docs_url: "https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice",
    fields: [
      f("realm_id", "Company / realm ID", "text", { required: true }),
      f("environment", "Environment", "select", { options: [{ value: "sandbox", label: "Sandbox" }, { value: "production", label: "Production" }] }),
      f("access_token", "OAuth access token", "password", { required: true, secret: true }),
    ],
    mapping_targets: INVOICE_TARGETS,
    probe_name: "GET /v3/company/{realm}/companyinfo/{realm}",
  },
  {
    id: "xero",
    title: "Xero",
    vendor: "Xero",
    category: "invoicing",
    sync_mode: "http",
    summary: "Invoices over the Xero Accounting API.",
    honesty: "Workers can call api.xero.com over HTTPS with an OAuth 2 access token and a tenant ID. This app does not complete Xero’s OAuth handshake on the free plan. Without a token, Test will not succeed.",
    docs_url: "https://developer.xero.com/documentation/api/accounting/invoices",
    fields: [
      f("tenant_id", "Tenant ID", "text", { required: true }),
      f("access_token", "OAuth access token", "password", { required: true, secret: true }),
    ],
    mapping_targets: INVOICE_TARGETS,
    probe_name: "GET /api.xro/2.0/Organisation",
  },
  {
    id: "zoho_books",
    title: "Zoho Books",
    vendor: "Zoho",
    category: "invoicing",
    sync_mode: "http",
    summary: "Invoices over the Zoho Books API.",
    honesty: "Workers can call www.zohoapis.com (or a regional host) over HTTPS with an OAuth access token and organization ID. This app does not complete Zoho OAuth for you. Without a token, Test will not succeed.",
    docs_url: "https://www.zoho.com/books/api/v3/",
    fields: [
      f("organization_id", "Organization ID", "text", { required: true }),
      f("base_url", "API host", "url", { placeholder: "https://www.zohoapis.com" }),
      f("access_token", "OAuth access token", "password", { required: true, secret: true }),
    ],
    mapping_targets: INVOICE_TARGETS,
    probe_name: "GET /books/v3/organizations",
  },
  {
    id: "netsuite",
    title: "NetSuite",
    vendor: "Oracle NetSuite",
    category: "invoicing",
    sync_mode: "http",
    summary: "Records over NetSuite REST (token-based or OAuth 2).",
    honesty: "Workers can call a NetSuite REST URL over HTTPS if you provide a complete access token (or a custom RESTlet URL plus token). TBA/HMAC signing is not implemented on this free-tier form. Without a usable HTTPS token, Test will not succeed.",
    docs_url: "https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_154471953187.html",
    fields: [
      f("account_id", "Account ID", "text", { required: true, placeholder: "1234567" }),
      f("base_url", "REST base URL", "url", { placeholder: "https://1234567.suitetalk.api.netsuite.com" }),
      f("access_token", "OAuth access token", "password", { secret: true }),
      f("gateway_url", "Custom RESTlet / Suitelet URL", "url", { help: "Optional alternative to the standard REST base." }),
    ],
    mapping_targets: INVOICE_TARGETS,
    probe_name: "GET /services/rest/record/v1/metadata-catalog or gateway",
  },
  {
    id: "freshbooks",
    title: "FreshBooks",
    vendor: "FreshBooks",
    category: "invoicing",
    sync_mode: "http",
    summary: "Invoices over the FreshBooks API.",
    honesty: "Workers can call api.freshbooks.com over HTTPS with an OAuth access token and account ID. This app does not complete FreshBooks OAuth for you. Without a token, Test will not succeed.",
    docs_url: "https://www.freshbooks.com/api/start",
    fields: [
      f("account_id", "Account ID", "text", { required: true }),
      f("access_token", "OAuth access token", "password", { required: true, secret: true }),
    ],
    mapping_targets: INVOICE_TARGETS,
    probe_name: "GET /accounting/account/{id}/invoices/invoices?per_page=1",
  },
];

export function getConnector(id: string): ConnectorDef | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

export function publicCatalog() {
  return CONNECTORS.map((c) => ({
    id: c.id,
    title: c.title,
    vendor: c.vendor,
    category: c.category,
    sync_mode: c.sync_mode,
    summary: c.summary,
    honesty: c.honesty,
    docs_url: c.docs_url,
    fields: c.fields.map(({ secret, ...rest }) => ({ ...rest, secret: Boolean(secret) })),
    mapping_targets: c.mapping_targets,
    probe_name: c.probe_name,
  }));
}
