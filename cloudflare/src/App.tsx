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
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AuthProvider, useAuth } from "@/auth";
import LoginPage from "@/pages/LoginPage";
import UsersPage from "@/pages/UsersPage";
import { Users } from "lucide-react";
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
import RecoveryPage from "@/pages/RecoveryPage";
import ReconRulesPage from "@/pages/ReconRulesPage";
import ModelsPage from "@/pages/ModelsPage";
import OpenDataPage from "@/pages/OpenDataPage";
import SettingsPage from "@/pages/SettingsPage";
import DataSourcesPage from "@/pages/DataSourcesPage";
import GlossaryPage from "@/pages/GlossaryPage";
import { FilterProvider, useFilters } from "@/filters";
import { Select } from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TITLES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/brand";
import { BrandMark } from "@/components/BrandMark";
import { AppFooter } from "@/components/AppFooter";

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
      { to: "/glossary", label: "Glossary", icon: BookOpen },
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
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <BrandMark />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{APP_NAME}</div>
          <div className="truncate text-xs text-muted-foreground">{user?.name || "Revenue assurance"}</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{g.label}</div>
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 border-r md:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute left-0 top-0 h-full w-64 bg-background" onClick={(e) => e.stopPropagation()}>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-4 py-2 md:hidden">
          <button onClick={() => setOpen(true)} aria-label="Menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">{APP_NAME}</span>
        </header>
        <main className="flex-1">{children}</main>
        <AppFooter />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <FilterProvider>
        <TooltipProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/*"
              element={
                <RequireAuth>
                  <AppShell>
                    <Routes>
                      <Route path="/" element={<ExecutivePage />} />
                      <Route path="/lifecycle" element={<SystemMapPage />} />
                      <Route path="/agents" element={<AgentsPage />} />
                      <Route path="/investigate" element={<InvestigatePage />} />
                      <Route path="/investigate/:exceptionId" element={<InvestigatePage />} />
                      <Route path="/controls" element={<ControlsPage />} />
                      <Route path="/glossary" element={<GlossaryPage />} />
                      <Route path="/trace" element={<TracePage />} />
                      <Route path="/network-risk" element={<NetworkRiskPage />} />
                      <Route path="/contracts" element={<ContractsPage />} />
                      <Route path="/anomalies" element={<AnomaliesPage />} />
                      <Route path="/routing" element={<RoutingPage />} />
                      <Route path="/ask" element={<AskPage />} />
                      <Route path="/cases" element={<CasesPage />} />
                      <Route path="/risks" element={<RisksPage />} />
                      <Route path="/files" element={<FilesPage />} />
                      <Route path="/ingestion" element={<IngestionPage />} />
                      <Route path="/review" element={<ReviewQueuePage />} />
                      <Route path="/review/:id" element={<ReviewPage />} />
                      <Route path="/recovery" element={<RecoveryPage />} />
                      <Route path="/recon-rules" element={<ReconRulesPage />} />
                      <Route path="/models" element={<ModelsPage />} />
                      <Route path="/open-data" element={<OpenDataPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/settings/data-sources" element={<DataSourcesPage />} />
                      <Route path="/settings/users" element={<UsersPage />} />
                      <Route path="/:slug" element={<AreaPage />} />
                    </Routes>
                  </AppShell>
                </RequireAuth>
              }
            />
          </Routes>
        </TooltipProvider>
      </FilterProvider>
    </AuthProvider>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}
