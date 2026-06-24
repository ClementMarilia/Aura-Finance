import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function Register() {
  const { register, formatApiError } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", currency: "EUR" });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(form);
      toast.success("Conta criada!");
      nav("/");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#F9F8F6]">
      <div className="w-full max-w-md card-soft">
        <h2 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Criar conta</h2>
        <p className="text-[#6B7068] mt-1 text-sm">Comece a controlar suas finanças hoje</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label>Nome</Label>
            <Input data-testid="register-name-input" value={form.name} required className="mt-1.5"
              onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Seu nome" />
          </div>
          <div>
            <Label>E-mail</Label>
            <Input data-testid="register-email-input" type="email" value={form.email} required className="mt-1.5"
              onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="voce@exemplo.com" />
          </div>
          <div>
            <Label>Senha</Label>
            <Input data-testid="register-password-input" type="password" value={form.password} required minLength={4} className="mt-1.5"
              onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div>
            <Label>Moeda padrão</Label>
            <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
              <SelectTrigger data-testid="register-currency-select" className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EUR">EUR (€)</SelectItem>
                <SelectItem value="BRL">BRL (R$)</SelectItem>
                <SelectItem value="USD">USD ($)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={loading} data-testid="register-submit-button"
            className="w-full bg-[#1E3F33] hover:bg-[#2C5C4A] text-white rounded-xl py-5">
            {loading ? "Criando..." : "Criar conta"}
          </Button>
        </form>

        <div className="mt-6 text-sm text-center text-[#6B7068]">
          Já tem conta?{" "}
          <Link to="/login" className="text-[#1E3F33] font-medium hover:underline" data-testid="link-login">Entrar</Link>
        </div>
      </div>
    </div>
  );
}
