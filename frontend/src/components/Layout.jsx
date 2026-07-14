import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard, ArrowLeftRight, CreditCard, HandCoins, PiggyBank,
  Users, FolderOpen, Scale, FileBarChart, Wallet, Bell, Target, Repeat, Settings,
} from "lucide-react";
import NotificationsBell from "@/components/NotificationsBell";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/UserMenu";
import Logo from "@/components/Logo";

const nav = [
  { to: "/", icon: LayoutDashboard, label: "Painel", end: true },
  { to: "/lancamentos", icon: ArrowLeftRight, label: "Lançamentos" },
  { to: "/recorrencias", icon: Repeat, label: "Recorrências" },
  { to: "/parcelamentos", icon: CreditCard, label: "Parcelamentos" },
  { to: "/contas-a-receber", icon: HandCoins, label: "Contas a Receber" },
  { to: "/orcamento", icon: PiggyBank, label: "Orçamento" },
  { to: "/carteiras", icon: Wallet, label: "Carteiras" },
  { to: "/metas", icon: Target, label: "Metas" },
  { to: "/despesas-compartilhadas", icon: Users, label: "Despesas Compartilhadas" },
  { to: "/grupos", icon: FolderOpen, label: "Grupos" },
  { to: "/acertos", icon: Scale, label: "Acertos" },
  { to: "/relatorios", icon: FileBarChart, label: "Relatórios" },
  { to: "/notificacoes", icon: Bell, label: "Notificações" },
];

export default function Layout() {
  const linkCls = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
      isActive
        ? "bg-[#F1EFE7] text-[#1E3F33] font-medium"
        : "text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#1E3F33]"
    }`;

  return (
    <div className="min-h-screen flex" style={{ background: "var(--bg)" }}>
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r p-4"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-center py-4 mb-4">
          <Logo variant="full" className="h-16 w-auto" />
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={linkCls} data-testid={`nav-${n.to.replace(/\//g, "") || "home"}`}>
              <n.icon size={18} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Desktop header — avatar/menu sempre visível no topo direito */}
        <header className="hidden md:flex items-center justify-end gap-2 px-6 py-3 border-b"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
          data-testid="desktop-header">
          <NotificationsBell />
          <ThemeToggle variant="icon" />
          <UserMenu />
        </header>

        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <Logo variant="full" className="h-9 w-auto" />
          <div className="flex items-center gap-1">
            <NotificationsBell />
            <ThemeToggle variant="icon" />
            <UserMenu compact />
          </div>
        </header>

        <div className="flex-1 p-4 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
          <Outlet />
        </div>

        {/* Bottom mobile nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t flex justify-around py-2 z-30"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          {nav.slice(0, 5).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] ${
                isActive ? "text-[#1E3F33]" : "text-[#6B7068]"
              }`}
              data-testid={`mobile-nav-${n.to.replace(/\//g, "") || "home"}`}>
              <n.icon size={18} />
              <span>{n.label.split(" ")[0]}</span>
            </NavLink>
          ))}
          <NavLink to="/configuracoes"
            className={({ isActive }) => `flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] ${
              isActive ? "text-[#1E3F33]" : "text-[#6B7068]"
            }`}>
            <Settings size={18} />
            <span>Mais</span>
          </NavLink>
        </nav>
      </main>
    </div>
  );
}
