import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import {
  Banknote,
  Bot,
  CreditCard,
  Landmark,
  LayoutDashboard,
  Percent,
  Search,
  Smartphone,
  Store,
  TerminalSquare,
  Wallet,
  ArrowLeftRight,
  Workflow,
  FileSpreadsheet,
  Receipt,
  Coins,
  BookOpen,
  Waypoints,
  Building2,
  Calculator,
  Send,
  Menu,
  X,
  Shield,
  ShieldAlert,
  Scale,
  IdCard,
  Radio,
  ScanSearch,
  Share2,
  BadgePercent,
  SlidersHorizontal,
  BrainCircuit,
  Database,
  Settings,
} from "lucide-react";
import { useMemo, useState } from "react";
import ExecutivePage from "@/pages/ExecutivePage";
import AreaPage from "@/pages/AreaPage";
import AgentsPage from "@/pages/AgentsPage";
import InvestigatePage from "@/pages/InvestigatePage";
import SystemMapPage from "@/pages/SystemMapPage";
import ControlsPage from "@/pages/ControlsPage";
import TracePage from "@/pages/TracePage";
import NetworkRiskPage from "@/pages/NetworkRiskPage";
import ContractsPage from "@/pages/ContractsPage";
import AnomaliesPage from "@/pages/AnomaliesPage";
import RoutingPage from "@/pages/RoutingPage";
import AskPage from "@/pages/AskPage";
import CasesPage from "@/pages/CasesPage";
import RisksPage from "@/pages/RisksPage";
import FilesPage from "@/pages/FilesPage";
import IngestionPage from "@/pages/IngestionPage";
import ReviewQueuePage from "@/pages/ReviewQueuePage";
import ReviewPage from "@/pages/ReviewPage";
import ModelsPage from "@/pages/ModelsPage";
import OpenDataPage from "@/pages/OpenDataPage";
import SettingsPage from "@/pages/SettingsPage";
import DataSourcesPage from "@/pages/DataSourcesPage";
import { FilterProvider, useFilters } from "@/filters";
import { Select } from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TITLES } from "@/lib/routes";
import { cn } from "@/lib/utils";

const GROUPS = [
  {
    label: "Executive",
    items: [
      { to: "/", label: "Executive summary", icon: LayoutDashboard, end: true },
      { to: "/lifecycle", label: "System map", icon: Waypoints },
    ],
  },
  {
    label: "Lifecycle",
    items: [
      { to: "/authorization", label: "Authorization", icon: CreditCard },
      { to: "/scheme", label: "Scheme", icon: Landmark },
      { to: "/bank", label: "Bank / TRS", icon: Banknote },
      { to: "/acquirer", label: "Acquirer", icon: Building2 },
      { to: "/settlement", label: "Settlement", icon: Calculator },
      { to: "/funding", label: "Funding", icon: Send },
      { to: "/fees", label: "Fees", icon: Percent },
      { to: "/terminals", label: "POS terminals", icon: TerminalSquare },
      { to: "/apm", label: "APM", icon: Smartphone },
      { to: "/fx", label: "FX", icon: ArrowLeftRight },
      { to: "/pricing", label: "Pricing", icon: Percent },
      { to: "/payouts", label: "Payouts", icon: Wallet },
      { to: "/chargebacks", label: "Chargebacks", icon: Store },
      { to: "/false-declines", label: "False declines", icon: CreditCard },
      { to: "/hops", label: "Hops", icon: Waypoints },
      { to: "/interfaces", label: "Interface drops", icon: Radio },
      { to: "/success", label: "Success rate", icon: BadgePercent },
    ],
  },
  {
    label: "Governance",
    items: [
      { to: "/controls", label: "Control library", icon: Shield },
      { to: "/config", label: "Config & rules", icon: SlidersHorizontal },
      { to: "/kyc", label: "KYC & profile", icon: IdCard },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/models", label: "Model intelligence", icon: BrainCircuit },
      { to: "/open-data", label: "Open data sources", icon: Database },
      { to: "/contracts", label: "Contracts & rules", icon: BookOpen },
      { to: "/anomalies", label: "Anomalies", icon: ShieldAlert },
      { to: "/routing", label: "Routing optimisation", icon: Waypoints },
      { to: "/ask", label: "Ask your data", icon: Search },
      { to: "/cases", label: "Cases", icon: Workflow },
      { to: "/risks", label: "Risk library", icon: Shield },
      { to: "/files", label: "File completeness", icon: FileSpreadsheet },
      { to: "/ingestion", label: "File ingestion", icon: Radio },
    ],
  },
  {
    label: "Risk",
    items: [
      { to: "/tax", label: "Tax & regulatory", icon: Scale },
      { to: "/aml", label: "AML / fraud", icon: ShieldAlert },
      { to: "/network-risk", label: "Network risk", icon: Share2 },
    ],
  },
  {
    label: "Reconciliation",
    items: [
      { to: "/billing", label: "Billing", icon: FileSpreadsheet },
      { to: "/invoicing", label: "Invoicing", icon: Receipt },
      { to: "/cash", label: "Cash & AR", icon: Coins },
      { to: "/vendors", label: "Vendor costs", icon: BookOpen },
      { to: "/gl", label: "GL / ERP", icon: Workflow },
    ],
  },
  {
    label: "Agents & actions",
    items: [
      { to: "/agents", label: "Agents & queue", icon: Bot },
      { to: "/investigate", label: "Investigate", icon: Search },
      { to: "/review", label: "Review queue", icon: Scale },
      { to: "/trace", label: "Transaction trace", icon: ScanSearch },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/settings", label: "Settings", icon: Settings },
      { to: "/settings/data-sources", label: "Data sources", icon: Database },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-200">Acquiring RA</div>
        <div className="mt-1 text-sm font-semibold text-white">Revenue assurance</div>
      </div>
      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-6" aria-label="Primary">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</div>
            <div className="space-y-0.5">
              {g.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                      isActive ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white",
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}

function Breadcrumb() {
  const { pathname } = useLocation();
  const parts = useMemo(() => {
    if (pathname.startsWith("/investigate/")) {
      return [
        { to: "/", label: "Executive" },
        { to: "/investigate", label: "Investigate" },
        { to: pathname, label: "Exception" },
      ];
    }
    if (pathname.startsWith("/review/")) {
      return [
        { to: "/", label: "Executive" },
        { to: "/review", label: "Review queue" },
        { to: pathname, label: "Human review" },
      ];
    }
    const title = TITLES[pathname] ?? pathname.replace("/", "") ?? "Page";
    if (pathname === "/") return [{ to: "/", label: title }];
    return [
      { to: "/", label: "Executive" },
      { to: pathname, label: title },
    ];
  }, [pathname]);
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {parts.map((p, i) => (
          <li key={p.to} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden>/</span>}
            {i === parts.length - 1 ? (
              <span className="font-medium text-ink">{p.label}</span>
            ) : (
              <a href={p.to} className="hover:text-ink">{p.label}</a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const AREA_FILTER_SLUGS = new Set([
  "authorization",
  "scheme",
  "bank",
  "fees",
  "terminals",
  "apm",
  "fx",
  "pricing",
  "payouts",
  "chargebacks",
  "billing",
  "invoicing",
  "cash",
  "vendors",
  "gl",
  "hops",
  "settlement",
  "funding",
  "acquirer",
  "config",
  "tax",
  "kyc",
  "interfaces",
  "aml",
  "success",
  "false-declines",
]);

/** True only on Executive and Area pages, which honour merchant/scheme filters. */
export function pathHonoursFilters(pathname: string): boolean {
  if (pathname === "/") return true;
  const slug = pathname.replace(/^\//, "").split("/")[0];
  return AREA_FILTER_SLUGS.has(slug);
}

function FilterBar() {
  const { filters, setFilters, options } = useFilters();
  const merchants = [
    { value: "all", label: "All merchants" },
    ...(options?.merchants ?? []).map((m) => ({ value: m.merchant_id, label: `${m.merchant_id} · ${m.name}` })),
  ];
  const schemes = [
    { value: "all", label: "All schemes" },
    ...(options?.schemes ?? []).map((s) => ({ value: s, label: s })),
  ];
  return (
    <div className="space-y-2" data-testid="filter-bar">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted" data-testid="filter-applies-hint">
        Filters apply to this page
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
      <Select
        id="filter-period"
        label="Period"
        value={filters.period}
        onValueChange={(v) => setFilters({ period: v })}
        options={[{ value: "2026-10", label: options?.period.label ?? "October 2026" }]}
      />
      <Select
        id="filter-merchant"
        label="Merchant"
        value={filters.merchant}
        onValueChange={(v) => setFilters({ merchant: v })}
        options={merchants}
      />
      <Select
        id="filter-scheme"
        label="Scheme"
        value={filters.scheme}
        onValueChange={(v) => setFilters({ scheme: v })}
        options={schemes}
      />
      </div>
    </div>
  );
}

function Shell() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const showFilters = pathHonoursFilters(pathname);
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 bg-navy-900 text-white md:block print:hidden">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden print:hidden">
          <button type="button" className="absolute inset-0 bg-navy-950/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="relative z-50 h-full w-64 bg-navy-900 text-white shadow-xl">
            <button type="button" className="absolute right-3 top-3 rounded-md p-1 text-slate-300" aria-label="Close" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="topbar no-print border-b border-line bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-8">
            <button type="button" className="rounded-md p-1 text-ink md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <Breadcrumb />
            </div>
            <span className="hidden rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning sm:inline">
              Synthetic book
            </span>
          </div>
          {showFilters ? (
            <div className="mx-auto max-w-6xl border-t border-line px-4 py-3 md:px-8">
              <FilterBar />
            </div>
          ) : null}
        </header>
        <main id="main" className="mx-auto max-w-6xl p-4 md:p-8">
          <Routes>
            <Route path="/" element={<ExecutivePage />} />
            <Route path="/lifecycle" element={<SystemMapPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/investigate" element={<InvestigatePage />} />
            <Route path="/investigate/:exceptionId" element={<InvestigatePage />} />
            <Route path="/controls" element={<ControlsPage />} />
            <Route path="/trace" element={<TracePage />} />
            <Route path="/network-risk" element={<NetworkRiskPage />} />
            <Route path="/contracts" element={<ContractsPage />} />
            <Route path="/anomalies" element={<AnomaliesPage />} />
            <Route path="/routing" element={<RoutingPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/open-data" element={<OpenDataPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/data-sources" element={<DataSourcesPage />} />
            <Route path="/settings/data-sources/new/:connectorId" element={<DataSourcesPage />} />
            <Route path="/settings/data-sources/c/:connectionId" element={<DataSourcesPage />} />
            <Route path="/ask" element={<AskPage />} />
            <Route path="/cases" element={<CasesPage />} />
            <Route path="/risks" element={<RisksPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/ingestion" element={<IngestionPage />} />
            <Route path="/review" element={<ReviewQueuePage />} />
            <Route path="/review/:id" element={<ReviewPage />} />
            <Route path="/:slug" element={<AreaPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <FilterProvider>
        <Shell />
      </FilterProvider>
    </TooltipProvider>
  );
}
