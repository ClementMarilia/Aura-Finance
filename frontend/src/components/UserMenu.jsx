import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, UserCircle, Settings, LogOut, ShieldCheck } from "lucide-react";

/**
 * UserMenu — avatar + nome do usuário no canto superior direito.
 * Ao clicar abre dropdown com: Perfil, Configurações, Sair.
 *
 * Props:
 *  - compact (bool): no mobile mostra só o avatar; no desktop mostra avatar + nome
 */
export default function UserMenu({ compact = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const initials = (user?.name || "")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="user-menu-trigger"
          className="flex items-center gap-2 rounded-xl px-1.5 py-1 transition outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary)] hover:bg-[#F1EFE7]"
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0"
            style={{ backgroundColor: user.avatar_color || "#061B4A" }}
            data-testid="user-menu-avatar"
          >
            {initials || "U"}
          </div>
          {!compact && (
            <div className="text-sm min-w-0 overflow-hidden text-left hidden md:block">
              <div
                className="font-medium truncate max-w-[140px]"
                style={{ color: "var(--text-main)" }}
                data-testid="user-menu-name"
              >
                {user.name}
              </div>
              <div className="text-xs truncate max-w-[140px]" style={{ color: "var(--text-muted)" }}>
                {user.email}
              </div>
            </div>
          )}
          {!compact && (
            <ChevronDown size={16} className="hidden md:block" style={{ color: "var(--text-muted)" }} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-56" data-testid="user-menu-content">
        <DropdownMenuLabel>
          <div className="font-medium truncate">{user.name}</div>
          <div className="text-xs font-normal opacity-70 truncate">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/perfil")} data-testid="user-menu-perfil">
          <UserCircle size={16} className="mr-2" /> Perfil
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/configuracoes")} data-testid="user-menu-configuracoes">
          <Settings size={16} className="mr-2" /> Configurações
        </DropdownMenuItem>
        {user.is_admin && (
          <DropdownMenuItem onClick={() => navigate("/admin/usuarios")} data-testid="user-menu-admin-users">
            <ShieldCheck size={16} className="mr-2" /> Aprovar usuários
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={logout}
          data-testid="user-menu-logout"
          className="text-rose-600 focus:text-rose-700 focus:bg-rose-50"
        >
          <LogOut size={16} className="mr-2" /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
