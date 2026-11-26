import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
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
import { useEffect, useMemo, useState, lazy, Suspense, type ReactNode } from "react";
import { AuthProvider, useAuth } from "@/auth";
import LoginPage from "@/pages/LoginPage";
import { Users } from "lucide-react";
import { AccessDenied } from "@/pages/AccessDenied";
import { FilterProvider, useFilters } from "@/filters";
import { Select } from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TITLES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/brand";
import { BrandMark } from "@/components/BrandMark";
import { AppFooter } from "@/components/AppFooter";

const LazyExecutive = lazy(() => import("@/pages/ExecutivePage"));
const LazySystemMap = lazy(() => import("@/pages/SystemMapPage"));
const LazyAgents = lazy(() => import("@/pages/AgentsPage"));
const LazyInvestigate = lazy(() => import("@/pages/InvestigatePage"));
const LazyControls = lazy(() => import("@/pages/ControlsPage"));
const LazyTrace = lazy(() => import("@/pages/TracePage"));
const LazyNetworkRisk = lazy(() => import("@/pages/NetworkRiskPage"));
const LazyContracts = lazy(() => import("@/pages/ContractsPage"));
const LazyAnomalies = lazy(() => import("@/pages/AnomaliesPage"));
const LazyRouting = lazy(() => import("@/pages/RoutingPage"));
const LazyAsk = lazy(() => import("@/pages/AskPage"));
const LazyCases = lazy(() => import("@/pages/CasesPage"));
const LazyRisks = lazy(() => import("@/pages/RisksPage"));
const LazyFiles = lazy(() => import("@/pages/FilesPage"));
const LazyIngestion = lazy(() => import("@/pages/IngestionPage"));
const LazyReviewQueue = lazy(() => import("@/pages/ReviewQueuePage"));
const LazyReview = lazy(() => import("@/pages/ReviewPage"));
const LazyRecovery = lazy(() => import("@/pages/RecoveryPage"));
const LazyReconRules = lazy(() => import("@/pages/ReconRulesPage"));
const LazyModels = lazy(() => import("@/pages/ModelsPage"));
const LazyOpenData = lazy(() => import("@/pages/OpenDataPage"));
const LazySettings = lazy(() => import("@/pages/SettingsPage"));
const LazyDataSources = lazy(() => import("@/pages/DataSourcesPage"));
const LazyUsers = lazy(() => import("@/pages/UsersPage"));
const LazyArea = lazy(() => import("@/pages/AreaPage"));

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p className="p-8 text-sm text-muted">Loading…</p>}>{children}</Suspense>;
}

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
      { to: "/recon-rules", label: "Recon rules", icon: SlidersHorizontal },
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
      { to: "/recovery", label: "Recovery tracker", icon: Coins },
      { to: "/trace", label: "Transaction trace", icon: ScanSearch },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/settings", label: "Settings", icon: Settings },
      { to: "/settings/data-sources", label: "Data sources", icon: Database },
      { to: "/settings/users", label: "Users", icon: Users },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { navVisible, user } = useAuth();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((item) => navVisible(item.to)) })).filter((g) => g.items.length);
  return (
    <div className="flex h-full flex-col">
      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-6 pt-4" aria-label="Primary">
        {groups.map((g) => (
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
      {user ? (
        <div className="border-t border-white/10 px-4 py-3 text-xs text-slate-300" data-testid="signed-in-user">
          <div className="truncate font-medium text-white">{user.name}</div>
          <div className="truncate font-mono text-[11px] text-slate-400">{user.id}</div>
          <div className="uppercase tracking-wide text-slate-400">{user.role}</div>
        </div>
      ) : null}
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

function pageTitle(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith("/review/")) return "Human review";
  if (pathname.startsWith("/investigate/")) return "Exception";
  const slug = pathname.replace(/^\//, "");
  return slug || "Page";
}

function usePageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = `${pageTitle(pathname)} — ${APP_NAME}`;
  }, [pathname]);
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { pathname, search } = useLocation();
  if (loading) return <p className="p-8 text-sm text-muted">Checking session…</p>;
  if (!user) {
    const next = encodeURIComponent(pathname + search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

function Shell() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const showFilters = pathHonoursFilters(pathname);
  const { user, logout, can } = useAuth();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="brand-bar sticky top-0 z-50 h-14 shrink-0 bg-navy-900 text-white shadow-sm">
        <div className="flex h-full items-center gap-3 px-3 md:px-4">
          <button type="button" className="rounded-md p-1 text-white md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <BrandMark />
          <div className="ml-auto flex items-center gap-2 print:hidden">
            <span className="hidden rounded-full border border-gold-400/40 bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gold-200 sm:inline">
              Synthetic book
            </span>
            {user ? (
              <>
                <span className="hidden max-w-[160px] truncate text-xs text-slate-200 sm:inline" data-testid="header-user">
                  {user.id}
                </span>
                <button
                  type="button"
                  className="rounded-md border border-white/20 px-2 py-1 text-xs text-white hover:bg-white/10"
                  onClick={() => void logout().then(() => { window.location.assign("/login"); })}
                  data-testid="logout"
                >
                  Sign out
                </button>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 bg-navy-900 text-white md:block print:hidden">
          <Sidebar />
        </aside>
        {open && (
          <div className="fixed inset-x-0 bottom-0 top-14 z-40 md:hidden print:hidden">
            <button type="button" className="absolute inset-0 bg-navy-950/40" aria-label="Close menu" onClick={() => setOpen(false)} />
            <aside className="relative z-50 h-full w-64 bg-navy-900 text-white shadow-xl">
              <button type="button" className="absolute right-3 top-3 rounded-md p-1 text-slate-300" aria-label="Close" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </button>
              <Sidebar onNavigate={() => setOpen(false)} />
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="topbar no-print border-b border-line bg-white">
            <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-8">
              <div className="min-w-0 flex-1">
                <Breadcrumb />
              </div>
            </div>
            {showFilters ? (
              <div className="mx-auto max-w-6xl border-t border-line px-4 py-3 md:px-8">
                <FilterBar />
              </div>
            ) : null}
          </header>
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">
          <Routes>
            <Route path="/" element={<Page><LazyExecutive /></Page>} />
            <Route path="/lifecycle" element={<Page><LazySystemMap /></Page>} />
            <Route path="/agents" element={<Page><LazyAgents /></Page>} />
            <Route path="/investigate" element={<Page><LazyInvestigate /></Page>} />
            <Route path="/investigate/:exceptionId" element={<Page><LazyInvestigate /></Page>} />
            <Route path="/controls" element={<Page><LazyControls /></Page>} />
            <Route path="/trace" element={<Page><LazyTrace /></Page>} />
            <Route path="/network-risk" element={<Page><LazyNetworkRisk /></Page>} />
            <Route path="/contracts" element={<Page><LazyContracts /></Page>} />
            <Route path="/anomalies" element={<Page><LazyAnomalies /></Page>} />
            <Route path="/routing" element={<Page><LazyRouting /></Page>} />
            <Route path="/models" element={<Page><LazyModels /></Page>} />
            <Route path="/open-data" element={<Page><LazyOpenData /></Page>} />
            {can("settings") ? (
              <>
                <Route path="/settings" element={<Page><LazySettings /></Page>} />
                <Route path="/settings/data-sources" element={<Page><LazyDataSources /></Page>} />
                <Route path="/settings/data-sources/new/:connectorId" element={<Page><LazyDataSources /></Page>} />
                <Route path="/settings/data-sources/c/:connectionId" element={<Page><LazyDataSources /></Page>} />
              </>
            ) : (
              <Route path="/settings/*" element={<AccessDenied feature="Settings" required="admin" />} />
            )}
            {can("users") ? <Route path="/settings/users" element={<Page><LazyUsers /></Page>} /> : (
              <Route path="/settings/users" element={<AccessDenied feature="Users" required="admin" />} />
            )}
            <Route path="/ask" element={<Page><LazyAsk /></Page>} />
            <Route path="/cases" element={<Page><LazyCases /></Page>} />
            <Route path="/risks" element={<Page><LazyRisks /></Page>} />
            <Route path="/files" element={<Page><LazyFiles /></Page>} />
            <Route path="/ingestion" element={<Page><LazyIngestion /></Page>} />
            <Route path="/review" element={<Page><LazyReviewQueue /></Page>} />
            <Route path="/review/:id" element={<Page><LazyReview /></Page>} />
            <Route path="/recovery" element={<Page><LazyRecovery /></Page>} />
            {can("settings") || can("approve_review") ? (
              <Route path="/recon-rules" element={<Page><LazyReconRules /></Page>} />
            ) : (
              <Route path="/recon-rules" element={<AccessDenied feature="Recon Rules" required="admin or approver" />} />
            )}
            <Route path="/:slug" element={<Page><LazyArea /></Page>} />
          </Routes>
          </main>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}

function AppRoutes() {
  usePageTitle();
  const { pathname } = useLocation();
  if (pathname === "/login") return <LoginPage />;
  return (
    <RequireAuth>
      <Shell />
    </RequireAuth>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <AuthProvider>
        <FilterProvider>
          <AppRoutes />
        </FilterProvider>
      </AuthProvider>
    </TooltipProvider>
  );
}
