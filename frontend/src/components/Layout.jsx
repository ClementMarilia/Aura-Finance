import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, ArrowLeftRight, CreditCard, HandCoins, PiggyBank,
  Users, FolderOpen, Scale, FileBarChart, Wallet, Bell, Target, Repeat, Settings,
  Menu, UserCircle, LogOut, ShieldCheck,
  ReceiptText, CalendarDays, HeartPulse, TrendingUp, Plus, FileUp,
} from "lucide-react";
import NotificationsBell from "@/components/NotificationsBell";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/UserMenu";
import Logo from "@/components/Logo";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { translate as tr } from "@/i18n";

// Grouped by what the user is doing, so a long menu reads as a few short ones.
const navGroups = [
  {
    id: "daily", label: tr("Dia a dia"), items: [
      { to: "/", icon: LayoutDashboard, label: tr("Painel"), end: true },
      { to: "/lancamentos", icon: ArrowLeftRight, label: tr("Lançamentos") },
      { to: "/importar-extrato", icon: FileUp, label: tr("Importar extrato") },
      { to: "/carteiras", icon: Wallet, label: tr("Carteiras") },
      { to: "/extrato-financeiro", icon: ReceiptText, label: tr("Extrato financeiro") },
      { to: "/notificacoes", icon: Bell, label: tr("Notificações") },
    ],
  },
  {
    id: "bills", label: tr("Contas e compromissos"), items: [
      { to: "/recorrencias", icon: Repeat, label: tr("Recorrências") },
      { to: "/parcelamentos", icon: CreditCard, label: tr("Parcelamentos") },
      { to: "/contas-a-receber", icon: HandCoins, label: tr("Contas a Receber") },
      { to: "/calendario-financeiro", icon: CalendarDays, label: tr("Calendário financeiro") },
    ],
  },
  {
    id: "planning", label: tr("Planejamento"), items: [
      { to: "/orcamento", icon: PiggyBank, label: tr("Orçamento") },
      { to: "/metas", icon: Target, label: tr("Metas") },
      { to: "/fluxo-de-caixa", icon: TrendingUp, label: tr("Fluxo de caixa") },
      { to: "/saude-financeira", icon: HeartPulse, label: tr("Saúde financeira") },
      { to: "/relatorios", icon: FileBarChart, label: tr("Relatórios") },
    ],
  },
  {
    id: "shared", label: tr("Compartilhado"), items: [
      { to: "/despesas-compartilhadas", icon: Users, label: tr("Despesas Compartilhadas") },
      { to: "/acertos", icon: Scale, label: tr("Acertos") },
      { to: "/pessoas", icon: UserCircle, label: tr("Pessoas") },
      { to: "/grupos", icon: FolderOpen, label: tr("Grupos") },
    ],
  },
];

const adminNav = { to: "/admin/usuarios", icon: ShieldCheck, label: tr("Usuários") };
const adminGroup = { id: "admin", label: tr("Administração"), items: [adminNav] };

// Bottom bar on phones: two destinations each side of a central quick-add.
const mobileLeft = ["/", "/lancamentos"];
const mobileRight = ["/carteiras"];
const findItem = (to) => navGroups.flatMap((group) => group.items).find((item) => item.to === to);
const mobileBarPaths = new Set([...mobileLeft, ...mobileRight]);
const testIdFor = (to) => to.replace(/\//g, "") || "painel";

export default function Layout() {
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingUserCount, setPendingUserCount] = useState(0);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const visibleGroups = user?.is_admin ? [...navGroups, adminGroup] : navGroups;
  // Everything not already on the bottom bar belongs to "Mais".
  const moreGroups = visibleGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => !mobileBarPaths.has(item.to)) }))
    .filter((group) => group.items.length > 0);
  const moreActive = !mobileBarPaths.has(pathname)
    && moreGroups.some((group) => group.items.some((item) => pathname.startsWith(item.to)));

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
  const barItem = "flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-0.5 px-1 pt-2 text-[10px] transition-colors";

  return (
    <div className="min-h-screen flex" style={{ background: "var(--bg)" }}>
      <aside className="hidden md:flex flex-col w-64 border-r p-4"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-center py-4 mb-4">
          <Logo variant="full" className="h-16 w-auto" />
        </div>
        <nav className="flex flex-col flex-1 overflow-y-auto pr-1">
          {visibleGroups.map((group, index) => (
            <div key={group.id} className={index > 0 ? "mt-4" : ""}>
              {index > 0 && (
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7068]">{group.label}</div>
              )}
              <div className="flex flex-col gap-1">
                {group.items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} className={linkCls} data-testid={`nav-${testIdFor(n.to)}`}>
                    <n.icon size={18} />
                    <span>{n.label}</span>
                    {n.to === adminNav.to && pendingBadge("admin-pending-count")}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="hidden md:flex items-center justify-end gap-2 px-6 py-3 border-b sticky top-0 z-20 backdrop-blur-xl"
          style={{ background: "color-mix(in srgb, var(--surface) 72%, transparent)", borderColor: "var(--border)" }}
          data-testid="desktop-header">
          <NotificationsBell />
          <ThemeToggle variant="icon" />
          <UserMenu pendingUserCount={pendingUserCount} />
        </header>

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

        <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t grid grid-cols-5 items-end z-30 backdrop-blur-xl"
          style={{
            background: "color-mix(in srgb, var(--surface) 88%, transparent)",
            borderColor: "var(--border)",
            paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
          }}
          aria-label={tr("Menu")}>
          {mobileLeft.map(findItem).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `${barItem} ${isActive ? "text-[#061B4A] font-medium" : "text-[#6B7068]"}`}
              data-testid={`mobile-nav-${testIdFor(n.to)}`}>
              <n.icon size={20} />
              <span className="max-w-full truncate">{n.label.split(" ")[0]}</span>
            </NavLink>
          ))}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => navigate("/lancamentos?novo=1")}
              aria-label={tr("Novo lançamento")}
              data-testid="mobile-nav-quick-add"
              className="-mt-5 mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-[#061B4A] text-white shadow-lg ring-4 ring-[var(--bg)] transition active:scale-95"
            >
              <Plus size={26} />
            </button>
          </div>
          {mobileRight.map(findItem).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `${barItem} ${isActive ? "text-[#061B4A] font-medium" : "text-[#6B7068]"}`}
              data-testid={`mobile-nav-${testIdFor(n.to)}`}>
              <n.icon size={20} />
              <span className="max-w-full truncate">{n.label.split(" ")[0]}</span>
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            data-testid="mobile-nav-more"
            aria-current={moreActive ? "page" : undefined}
            className={`relative ${barItem} ${moreActive ? "text-[#061B4A] font-medium" : "text-[#6B7068]"}`}>
            <Menu size={20} />
            <span>{tr("Mais")}</span>
            {user?.is_admin && pendingUserCount > 0 && (
              <span
                data-testid="mobile-admin-pending-count"
                aria-label={tr("{count} cadastros pendentes", { count: pendingUserCount })}
                className="absolute right-3 top-1 inline-flex min-w-[16px] h-4 items-center justify-center rounded-full bg-[#D96C5B] px-1 text-[9px] font-semibold text-white"
              >
                {pendingUserCount > 99 ? "99+" : pendingUserCount}
              </span>
            )}
          </button>
        </nav>

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-3xl p-0" data-testid="mobile-more-sheet">
            <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-[#D6D3CA]" aria-hidden="true" />
            <SheetHeader className="px-5 pt-3 pb-1 text-left">
              <SheetTitle style={{ fontFamily: "Outfit" }}>{tr("Menu")}</SheetTitle>
            </SheetHeader>
            <nav className="px-4 pb-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
              {moreGroups.map((group) => (
                <section key={group.id} className="mt-4" data-testid={`more-group-${group.id}`}>
                  <h3 className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7068]">{group.label}</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {group.items.map((n) => {
                      const active = pathname.startsWith(n.to);
                      return (
                        <button key={n.to} type="button" onClick={() => go(n.to)} data-testid={`more-nav-${testIdFor(n.to)}`}
                          aria-current={active ? "page" : undefined}
                          className={`relative flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl border px-1 py-2 text-center text-xs leading-tight transition-colors ${
                            active
                              ? "border-[#061B4A] bg-[#F1EFE7] font-medium text-[#061B4A]"
                              : "border-[#E5E4E0] bg-white text-[#1A1C1A] hover:bg-[#F1EFE7]"
                          }`}>
                          <n.icon size={20} className={active ? "text-[#061B4A]" : "text-[#6B7068]"} />
                          <span>{n.label}</span>
                          {n.to === adminNav.to && pendingUserCount > 0 && (
                            <span data-testid="more-admin-pending-count"
                              aria-label={tr("{count} cadastros pendentes", { count: pendingUserCount })}
                              className="absolute right-1.5 top-1.5 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-[#D96C5B] px-1 text-[10px] font-semibold text-white">
                              {pendingUserCount > 99 ? "99+" : pendingUserCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              <div className="mt-5 divide-y divide-[#E5E4E0] rounded-2xl border border-[#E5E4E0]">
                <button onClick={() => go("/perfil")} data-testid="more-nav-perfil"
                  className="flex w-full items-center gap-3 px-4 py-3 text-sm text-left text-[#1A1C1A] hover:bg-[#F1EFE7]">
                  <UserCircle size={18} className="text-[#6B7068]" /> <span>{tr("Perfil")}</span>
                </button>
                <button onClick={() => go("/configuracoes")} data-testid="more-nav-configuracoes"
                  className="flex w-full items-center gap-3 px-4 py-3 text-sm text-left text-[#1A1C1A] hover:bg-[#F1EFE7]">
                  <Settings size={18} className="text-[#6B7068]" /> <span>{tr("Configurações")}</span>
                </button>
                <button onClick={() => { setMoreOpen(false); logout(); }} data-testid="more-nav-logout"
                  className="flex w-full items-center gap-3 px-4 py-3 text-sm text-left text-rose-600 hover:bg-rose-50">
                  <LogOut size={18} /> <span>{tr("Sair")}</span>
                </button>
              </div>
            </nav>
          </SheetContent>
        </Sheet>
      </main>
    </div>
  );
}
