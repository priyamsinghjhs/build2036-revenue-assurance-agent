import { NavLink, Route, Routes } from "react-router-dom";
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
} from "lucide-react";
import Overview from "./pages/Overview";
import AreaPage from "./pages/AreaPage";
import AgentsPage from "./pages/AgentsPage";
import InvestigatePage from "./pages/InvestigatePage";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/authorization", label: "Authorization", icon: CreditCard },
  { to: "/scheme", label: "Scheme", icon: Landmark },
  { to: "/bank", label: "Bank / TRS", icon: Banknote },
  { to: "/fees", label: "Fees", icon: Percent },
  { to: "/terminals", label: "POS terminals", icon: TerminalSquare },
  { to: "/apm", label: "APM", icon: Smartphone },
  { to: "/fx", label: "FX", icon: ArrowLeftRight },
  { to: "/pricing", label: "Pricing", icon: Percent },
  { to: "/payouts", label: "Payouts", icon: Wallet },
  { to: "/chargebacks", label: "Chargebacks", icon: Store },
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/investigate", label: "Investigate", icon: Search },
];

export default function App() {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 border-r border-white/10 bg-[#0a101c] p-4 md:block">
        <div className="mb-6 px-2">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">Acquiring RA</div>
          <div className="mt-1 text-sm text-slate-400">Lifecycle recon</div>
        </div>
        <nav className="space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                  isActive ? "bg-cyan-500/15 text-cyan-200" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="flex gap-2 overflow-x-auto border-b border-white/10 px-3 py-2 md:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-full px-3 py-1 text-xs ${
                  isActive ? "bg-cyan-500/20 text-cyan-200" : "bg-white/5 text-slate-400"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
        <main className="mx-auto max-w-6xl p-4 md:p-8">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/investigate" element={<InvestigatePage />} />
            <Route path="/investigate/:exceptionId" element={<InvestigatePage />} />
            <Route path="/:slug" element={<AreaPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
