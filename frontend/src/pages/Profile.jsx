import { useState } from "react";
import api, { CURRENCIES, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";

import { translate as tr } from "@/i18n";

export default function Profile() {
  const { user, refreshMe, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: user?.name || "", currency: user?.currency || "EUR" });
  const [pw, setPw] = useState({ current_password: "", new_password: "" });

  const initials = (user?.name || "").split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();

  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      await api.put("/auth/profile", form);
      await refreshMe();
      toast.success(tr("Perfil atualizado"));
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    try {
      await api.post("/auth/change-password", pw);
      toast.success(tr("Senha alterada"));
      setPw({ current_password: "", new_password: "" });
    } catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div className="space-y-6 max-w-2xl" data-testid="profile-page">
      <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>{tr("Perfil")}</h1>

      <div className="card-soft">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-medium"
            style={{ backgroundColor: user?.avatar_color || "#061B4A", fontFamily: "Outfit" }}>
            {initials}
          </div>
          <div>
            <div className="text-xl font-semibold" style={{ fontFamily: "Outfit" }}>{user?.name}</div>
            <div className="text-sm text-[#6B7068]">{user?.email}</div>
          </div>
        </div>

        <form onSubmit={saveProfile} className="mt-6 space-y-3">
          <div><Label>{tr("Nome")}</Label>
            <Input value={form.name} required data-testid="profile-name-input"
              onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>{tr("Moeda-base")}</Label>
            <Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}>
              <SelectTrigger data-testid="profile-currency-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(currency => (
                  <SelectItem key={currency.value} value={currency.value}>{currency.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-[#6B7068] mt-1">{tr("Dashboards e relatórios serão apresentados nesta moeda. Os valores originais não são alterados.")}</p>
          </div>
          <Button type="submit" data-testid="profile-save-button" className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">{tr("Salvar")}</Button>
        </form>
      </div>

      <div className="card-soft">
        <h3 className="text-lg font-semibold mb-3" style={{ fontFamily: "Outfit" }}>{tr("Alterar senha")}</h3>
        <form onSubmit={changePassword} className="space-y-3">
          <div><Label>{tr("Senha atual")}</Label>
            <Input type="password" value={pw.current_password} required data-testid="profile-current-password"
              onChange={e => setPw({ ...pw, current_password: e.target.value })} /></div>
          <div><Label>{tr("Nova senha")}</Label>
            <Input type="password" value={pw.new_password} required minLength={4} data-testid="profile-new-password"
              onChange={e => setPw({ ...pw, new_password: e.target.value })} /></div>
          <Button type="submit" data-testid="profile-change-password-button" className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
            {tr("Alterar senha")}
          </Button>
        </form>
      </div>

      <div className="card-soft">
        <Button onClick={() => { logout(); navigate("/login"); }} data-testid="profile-logout-button"
          className="bg-white border border-[#E5E4E0] text-[#D9453B] hover:bg-[#F1EFE7] rounded-xl">
          <LogOut size={16} className="mr-2" /> {tr("Sair")}
        </Button>
      </div>
    </div>
  );
}
