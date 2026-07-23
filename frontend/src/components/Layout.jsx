import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, ArrowLeftRight, CreditCard, HandCoins, PiggyBank,
  Users, FolderOpen, Scale, FileBarChart, Wallet, Bell, Target, Repeat, Settings,
  Menu, UserCircle, LogOut, ShieldCheck,
} from "lucide-react";
import NotificationsBell from "@/components/NotificationsBell";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/UserMenu";
import Logo from "@/components/Logo";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { translate as tr } from "@/i18n";

const nav = [
  { to: "/", icon: LayoutDashboard, label: tr("Painel"), end: true },
  { to: "/lancamentos", icon: ArrowLeftRight, label: tr("Lançamentos") },
  { to: "/recorrencias", icon: Repeat, label: tr("Recorrências") },
  { to: "/parcelamentos", icon: CreditCard, label: tr("Parcelamentos") },
  { to: "/contas-a-receber", icon: HandCoins, label: tr("Contas a Receber") },
  { to: "/orcamento", icon: PiggyBank, label: tr("Orçamento") },
  { to: "/carteiras", icon: Wallet, label: tr("Carteiras") },
  { to: "/metas", icon: Target, label: tr("Metas") },
  { to: "/despesas-compartilhadas", icon: Users, label: tr("Despesas Compartilhadas") },
  { to: "/grupos", icon: FolderOpen, label: tr("Grupos") },
  { to: "/acertos", icon: Scale, label: tr("Acertos") },
  { to: "/relatorios", icon: FileBarChart, label: tr("Relatórios") },
  { to: "/notificacoes", icon: Bell, label: tr("Notificações") },
];

// 4 primary destinations on the mobile bottom bar; everything else lives in tr("Mais")
const primaryMobile = nav.slice(0, 4);
const adminNav = { to: "/admin/usuarios", icon: ShieldCheck, label: tr("Aprovar Usuários") };

export default function Layout() {
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingUserCount, setPendingUserCount] = useState(0);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const visibleNav = user?.is_admin ? [...nav, adminNav] : nav;

  const loadPendingUserCount = useCallback(() => {
    if (!user?.is_admin) return;
    api.get("/admin/users/pending-count")
      .then(({ data }) => setPendingUserCount(Number(data?.count) || 0))
      .catch(() => {});
  }, [user?.is_admin]);

  useEffect(() => {
    if (!user?.is_admin) {
      setPendingUserCount(0);
      return undefined;
    }

    const syncCount = (event) => {
      if (typeof event.detail === "number") {
        setPendingUserCount(event.detail);
      } else {
        loadPendingUserCount();
      }
    };

    loadPendingUserCount();
    window.addEventListener("focus", loadPendingUserCount);
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") loadPendingUserCount();
    };
    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("crelith:pending-user-count", syncCount);
    const poll = window.setInterval(loadPendingUserCount, 60000);

    return () => {
      window.removeEventListener("focus", loadPendingUserCount);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.removeEventListener("crelith:pending-user-count", syncCount);
      window.clearInterval(poll);
    };
  }, [loadPendingUserCount, user?.is_admin]);

  const pendingBadge = (testId) => (pendingUserCount > 0 ? (
      <span
        data-testid={testId}
        aria-label={tr("{count} cadastros pendentes", { count: pendingUserCount })}
        className="ml-auto inline-flex min-w-[20px] h-5 items-center justify-center rounded-full bg-[#D96C5B] px-1.5 text-[10px] font-semibold text-white"
      >
        {pendingUserCount > 99 ? "99+" : pendingUserCount}
      </span>
    ) : null);

  const linkCls = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors duration-200 ${
      isActive
        ? "bg-[#F1EFE7] text-[#061B4A] font-medium"
        : "text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#061B4A]"
    }`;

  const go = (to) => { setMoreOpen(false); navigate(to); };

  return (
    <div className="min-h-screen flex" style={{ background: "var(--bg)" }}>
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r p-4"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-center py-4 mb-4">
          <Logo variant="full" className="h-16 w-auto" />
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {visibleNav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={linkCls} data-testid={`nav-${n.to.replace(/\//g, "") || "painel"}`}>
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.to === adminNav.to && pendingBadge("admin-pending-count")}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Desktop header — glass, avatar/menu sempre visível no topo direito */}
        <header className="hidden md:flex items-center justify-end gap-2 px-6 py-3 border-b sticky top-0 z-20 backdrop-blur-xl"
          style={{ background: "color-mix(in srgb, var(--surface) 72%, transparent)", borderColor: "var(--border)" }}
          data-testid="desktop-header">
          <NotificationsBell />
          <ThemeToggle variant="icon" />
          <UserMenu pendingUserCount={pendingUserCount} />
        </header>

        {/* Mobile header — glass */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b sticky top-0 z-20 backdrop-blur-xl"
          style={{ background: "color-mix(in srgb, var(--surface) 72%, transparent)", borderColor: "var(--border)" }}>
          <Logo variant="full" className="h-9 w-auto" />
          <div className="flex items-center gap-1">
            <NotificationsBell />
            <ThemeToggle variant="icon" />
            <UserMenu compact pendingUserCount={pendingUserCount} />
          </div>
        </header>

        <div className="flex-1 p-4 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
          <Outlet />
        </div>

        {/* Bottom mobile nav — 4 primary + Mais */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t flex justify-around py-2 z-30 backdrop-blur-xl"
          style={{ background: "color-mix(in srgb, var(--surface) 88%, transparent)", borderColor: "var(--border)" }}>
          {primaryMobile.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] transition-colors ${
                isActive ? "text-[#061B4A] font-medium" : "text-[#6B7068]"
              }`}
              data-testid={`mobile-nav-${n.to.replace(/\//g, "") || "painel"}`}>
              <n.icon size={18} />
              <span>{n.label.split(" ")[0]}</span>
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            data-testid="mobile-nav-more"
            className="relative flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] text-[#6B7068] transition-colors">
            <Menu size={18} />
            <span>{tr("Mais")}</span>
            {user?.is_admin && pendingUserCount > 0 && (
              <span
                data-testid="mobile-admin-pending-count"
                aria-label={tr("{count} cadastros pendentes", { count: pendingUserCount })}
                className="absolute -right-1 top-0 inline-flex min-w-[16px] h-4 items-center justify-center rounded-full bg-[#D96C5B] px-1 text-[9px] font-semibold text-white"
              >
                {pendingUserCount > 99 ? "99+" : pendingUserCount}
              </span>
            )}
          </button>
        </nav>

        {/* Full menu drawer (mobile) */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="right" className="w-[86%] max-w-sm overflow-y-auto p-0" data-testid="mobile-more-sheet">
            <SheetHeader className="px-5 pt-5 pb-3">
              <SheetTitle style={{ fontFamily: "Outfit" }}>{tr("Menu")}</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 px-3 pb-4">
              {visibleNav.map((n) => (
                <button key={n.to} onClick={() => go(n.to)} data-testid={`more-nav-${n.to.replace(/\//g, "") || "painel"}`}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-left text-[#1A1C1A] hover:bg-[#F1EFE7] hover:text-[#061B4A] transition-colors">
                  <n.icon size={18} className="text-[#6B7068]" />
                  <span>{n.label}</span>
                  {n.to === adminNav.to && pendingBadge("more-admin-pending-count")}
                </button>
              ))}
              <div className="my-2 border-t" style={{ borderColor: "var(--border)" }} />
              <button onClick={() => go("/perfil")} data-testid="more-nav-perfil"
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-left text-[#1A1C1A] hover:bg-[#F1EFE7] hover:text-[#061B4A] transition-colors">
                <UserCircle size={18} className="text-[#6B7068]" /> <span>{tr("Perfil")}</span>
              </button>
              <button onClick={() => go("/configuracoes")} data-testid="more-nav-configuracoes"
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-left text-[#1A1C1A] hover:bg-[#F1EFE7] hover:text-[#061B4A] transition-colors">
                <Settings size={18} className="text-[#6B7068]" /> <span>{tr("Configurações")}</span>
              </button>
              <button onClick={() => { setMoreOpen(false); logout(); }} data-testid="more-nav-logout"
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-left text-rose-600 hover:bg-rose-50 transition-colors">
                <LogOut size={18} /> <span>{tr("Sair")}</span>
              </button>
            </nav>
          </SheetContent>
        </Sheet>
      </main>
    </div>
  );
}
