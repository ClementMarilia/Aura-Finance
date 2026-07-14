import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

function Field({ id, label, type, value, onChange, testid, placeholder, minLength, autoComplete }) {
  return (
    <div className="text-left">
      <label htmlFor={id} className="block text-[11px] tracking-[0.18em] uppercase text-white/40 mb-2">
        {label}
      </label>
      <input
        id={id}
        data-testid={testid}
        type={type}
        value={value}
        onChange={onChange}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        placeholder={placeholder}
        style={{ background: "transparent", color: "rgba(255,255,255,0.9)", borderColor: "rgba(255,255,255,0.15)" }}
        className="w-full border-0 border-b placeholder-white/20 text-base py-2 outline-none transition-colors duration-200 focus:border-b-[#6FB597]"
      />
    </div>
  );
}

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
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden" style={{ background: "#070A09" }}>
      {/* Soft radial sphere glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(circle at 50% 52%, rgba(111,181,151,0.10), rgba(30,63,51,0.05) 32%, transparent 60%)" }} />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: "min(94vw, 860px)", height: "min(94vw, 860px)",
          background: "radial-gradient(circle, rgba(255,255,255,0.045), rgba(255,255,255,0.015) 46%, transparent 68%)",
          boxShadow: "inset 0 0 140px rgba(255,255,255,0.025)",
        }} />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/2 -translate-x-1/2 rounded-full"
        style={{ width: "70vw", height: "70vw", background: "radial-gradient(circle, rgba(111,181,151,0.06), transparent 60%)" }} />

      <div className="relative z-10 w-full max-w-sm px-6 text-center auth-in">
        {/* Wordmark */}
        <div className="mb-12 flex items-center justify-center gap-3">
          <img src="/logo-mark-dark.png" alt="" className="h-7 w-auto opacity-90"
            onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <span className="text-white/90 text-lg font-light whitespace-nowrap" style={{ fontFamily: "Outfit", letterSpacing: "0.3em" }}>
            AURA FINANCE
          </span>
        </div>

        <p className="text-white/40 text-xs tracking-[0.12em] uppercase mb-8">Criar conta</p>

        <form onSubmit={submit} className="space-y-6">
          <Field id="reg-name" label="Nome" type="text" value={form.name} testid="register-name-input"
            autoComplete="name" placeholder="Seu nome"
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Field id="reg-email" label="E-mail" type="email" value={form.email} testid="register-email-input"
            autoComplete="email" placeholder="voce@exemplo.com"
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Field id="reg-password" label="Senha" type="password" value={form.password} testid="register-password-input"
            autoComplete="new-password" minLength={4} placeholder="••••••••"
            onChange={(e) => setForm({ ...form, password: e.target.value })} />

          <div className="text-left">
            <label htmlFor="reg-currency" className="block text-[11px] tracking-[0.18em] uppercase text-white/40 mb-2">
              Moeda padrão
            </label>
            <select
              id="reg-currency"
              data-testid="register-currency-select"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              style={{ background: "transparent", color: "rgba(255,255,255,0.9)", borderColor: "rgba(255,255,255,0.15)" }}
              className="w-full border-0 border-b text-base py-2 outline-none transition-colors duration-200 focus:border-b-[#6FB597]"
            >
              <option value="EUR" className="text-black">EUR (€)</option>
              <option value="BRL" className="text-black">BRL (R$)</option>
              <option value="USD" className="text-black">USD ($)</option>
            </select>
          </div>

          <button type="submit" disabled={loading} data-testid="register-submit-button"
            className="w-full mt-2 rounded-xl border border-white/12 bg-white/[0.04] hover:bg-white/[0.09] active:scale-[0.99] text-white/85 text-xs tracking-[0.28em] uppercase py-4 transition-colors duration-200 disabled:opacity-50">
            {loading ? "Criando..." : "Criar conta"}
          </button>
        </form>

        <div className="mt-6 text-xs text-white/40">
          Já tem conta?{" "}
          <Link to="/login" className="text-white/70 hover:text-white transition-colors" data-testid="link-login">
            Entrar
          </Link>
        </div>
      </div>
    </div>
  );
}
