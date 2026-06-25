import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, ArrowLeftRight, CreditCard, HandCoins, PiggyBank,
  Users, FolderOpen, Scale, FileBarChart, UserCircle, Settings, LogOut, Wallet, Bell, Target, Repeat
} from "lucide-react";import { useAuth } from "@/context/AuthContext";
import NotificationsBell from "@/components/NotificationsBell";

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
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const initials = (user?.name || "").split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();

  const linkCls = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
      isActive
        ? "bg-[#F1EFE7] text-[#1E3F33] font-medium"
        : "text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#1E3F33]"
    }`;

  return (
    <div className="min-h-screen flex bg-[#F9F8F6]">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-[#E5E4E0] p-4">
        <div className="flex items-center gap-2 px-2 py-4 mb-4">
          <div className="w-9 h-9 rounded-xl bg-[#1E3F33] flex items-center justify-center text-white">
            <Wallet size={18} />
          </div>
          <div>
            <div className="font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Aurea</div>
            <div className="text-xs text-[#6B7068]">Controle Financeiro</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={linkCls} data-testid={`nav-${n.to.replace(/\//g, "") || "home"}`}>
              <n.icon size={18} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-[#E5E4E0] pt-3 mt-3 flex items-center gap-2 min-w-0">
          <button
            onClick={() => navigate("/perfil")}
            data-testid="profile-button"
            className="flex items-center gap-2 flex-1 hover:bg-[#F1EFE7] hover:text-[#1E3F33] rounded-lg p-2 text-left"
          >
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-medium"
              style={{ backgroundColor: user?.avatar_color || "#1E3F33" }}>
              {initials || "U"}
            </div>
            <div className="text-sm min-w-0 overflow-hidden">
              <div className="font-medium text-[#1A1C1A] truncate">{user?.name}</div>
              <div className="text-xs text-[#6B7068] truncate">{user?.email}</div>
            </div>
          </button>
          <NotificationsBell />
          <button
            onClick={() => navigate("/perfil")}
            data-testid="profile-button"
            className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden hover:bg-[#F1EFE7] hover:text-[#1E3F33] rounded-lg p-2 text-left"
            >
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-[#E5E4E0]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#1E3F33] flex items-center justify-center text-white">
              <Wallet size={16} />
            </div>
            <span className="font-semibold" style={{ fontFamily: "Outfit" }}>Aurea</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationsBell />
            <button onClick={() => navigate("/perfil")} data-testid="mobile-profile-button"
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-medium"
              style={{ backgroundColor: user?.avatar_color || "#1E3F33" }}>
              {initials || "U"}
            </button>
          </div>
        </header>

        <div className="flex-1 p-4 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
          <Outlet />
        </div>

        {/* Bottom mobile nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[#E5E4E0] flex justify-around py-2 z-30">
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
