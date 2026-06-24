import { useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";

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
      toast.success("Perfil atualizado");
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    try {
      await api.post("/auth/change-password", pw);
      toast.success("Senha alterada");
      setPw({ current_password: "", new_password: "" });
    } catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div className="space-y-6 max-w-2xl" data-testid="profile-page">
      <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Perfil</h1>

      <div className="card-soft">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-medium"
            style={{ backgroundColor: user?.avatar_color || "#1E3F33", fontFamily: "Outfit" }}>
            {initials}
          </div>
          <div>
            <div className="text-xl font-semibold" style={{ fontFamily: "Outfit" }}>{user?.name}</div>
            <div className="text-sm text-[#6B7068]">{user?.email}</div>
          </div>
        </div>

        <form onSubmit={saveProfile} className="mt-6 space-y-3">
          <div><Label>Nome</Label>
            <Input value={form.name} required data-testid="profile-name-input"
              onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Moeda padrão</Label>
            <Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}>
              <SelectTrigger data-testid="profile-currency-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EUR">EUR (€)</SelectItem>
                <SelectItem value="BRL">BRL (R$)</SelectItem>
                <SelectItem value="USD">USD ($)</SelectItem>
              </SelectContent>
            </Select></div>
          <Button type="submit" data-testid="profile-save-button" className="bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">Salvar</Button>
        </form>
      </div>

      <div className="card-soft">
        <h3 className="text-lg font-semibold mb-3" style={{ fontFamily: "Outfit" }}>Alterar senha</h3>
        <form onSubmit={changePassword} className="space-y-3">
          <div><Label>Senha atual</Label>
            <Input type="password" value={pw.current_password} required data-testid="profile-current-password"
              onChange={e => setPw({ ...pw, current_password: e.target.value })} /></div>
          <div><Label>Nova senha</Label>
            <Input type="password" value={pw.new_password} required minLength={4} data-testid="profile-new-password"
              onChange={e => setPw({ ...pw, new_password: e.target.value })} /></div>
          <Button type="submit" data-testid="profile-change-password-button" className="bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">
            Alterar senha
          </Button>
        </form>
      </div>

      <div className="card-soft">
        <Button onClick={() => { logout(); navigate("/login"); }} data-testid="profile-logout-button"
          className="bg-white border border-[#E5E4E0] text-[#D9453B] hover:bg-[#F1EFE7] rounded-xl">
          <LogOut size={16} className="mr-2" /> Sair
        </Button>
      </div>
    </div>
  );
}
