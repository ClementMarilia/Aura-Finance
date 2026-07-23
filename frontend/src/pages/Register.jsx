import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { CURRENCIES } from "@/lib/api";
import Logo from "@/components/Logo";
import LanguageSelector from "@/components/LanguageSelector";
import { getLanguage, translate as tr } from "@/i18n";

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
        className="w-full border-0 border-b placeholder-white/20 text-base py-2 outline-none transition-colors duration-200 focus:border-b-[#08D7A5]"
      />
    </div>
  );
}

export default function Register() {
  const { register, formatApiError } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "", currency: "EUR" });
  const [loading, setLoading] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await register({ ...form, language: getLanguage() });
      setSubmittedEmail(result.email || form.email);
      toast.success(tr("Cadastro enviado para aprovação"));
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden" style={{ background: "#04112F" }}>
      <LanguageSelector compact className="absolute right-4 top-4 z-20 text-white/70" />
      {/* Soft radial sphere glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(circle at 50% 52%, rgba(8,215,165,0.12), rgba(18,104,244,0.07) 32%, transparent 60%)" }} />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: "min(94vw, 860px)", height: "min(94vw, 860px)",
          background: "radial-gradient(circle, rgba(255,255,255,0.045), rgba(255,255,255,0.015) 46%, transparent 68%)",
          boxShadow: "inset 0 0 140px rgba(255,255,255,0.025)",
        }} />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/2 -translate-x-1/2 rounded-full"
        style={{ width: "70vw", height: "70vw", background: "radial-gradient(circle, rgba(8,182,231,0.08), transparent 60%)" }} />

      <div className="relative z-10 w-full max-w-sm px-6 text-center auth-in">
        <div className="mb-12 flex items-center justify-center">
          <Logo variant="full" surface="dark" className="h-14 w-auto max-w-[250px]" />
        </div>

        {submittedEmail ? (
          <div data-testid="register-pending-message">
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border border-[#08D7A5]/30 bg-[#08D7A5]/10 text-2xl text-[#08D7A5]">
              ✓
            </div>
            <p className="text-white/80 text-lg font-medium">{tr("Cadastro recebido")}</p>
            <p className="mt-3 text-sm leading-6 text-white/50">
              {tr("A conta")} <span className="text-white/75">{submittedEmail}</span>{" "}
              {tr("está aguardando aprovação. Você poderá entrar depois que a administradora liberar o acesso.")}
            </p>
            <Link
              to="/login"
              className="mt-8 inline-flex w-full justify-center rounded-xl border border-white/12 bg-white/[0.04] px-4 py-4 text-xs uppercase tracking-[0.22em] text-white/80 transition-colors hover:bg-white/[0.09]"
              data-testid="register-pending-login"
            >
              {tr("Voltar para o login")}
            </Link>
          </div>
        ) : (
          <>
            <p className="text-white/40 text-xs tracking-[0.12em] uppercase mb-8">{tr("Criar conta")}</p>

            <form onSubmit={submit} className="space-y-6">
              <Field id="reg-name" label={tr("Nome")} type="text" value={form.name} testid="register-name-input"
                autoComplete="name" placeholder={tr("Seu nome")}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Field id="reg-email" label={tr("E-mail")} type="email" value={form.email} testid="register-email-input"
                autoComplete="email" placeholder="voce@exemplo.com"
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <Field id="reg-password" label={tr("Senha")} type="password" value={form.password} testid="register-password-input"
                autoComplete="new-password" minLength={4} placeholder="••••••••"
                onChange={(e) => setForm({ ...form, password: e.target.value })} />

              <div className="text-left">
                <label htmlFor="reg-currency" className="block text-[11px] tracking-[0.18em] uppercase text-white/40 mb-2">
                  {tr("Moeda-base")}
                </label>
                <select
                  id="reg-currency"
                  data-testid="register-currency-select"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  style={{ background: "transparent", color: "rgba(255,255,255,0.9)", borderColor: "rgba(255,255,255,0.15)" }}
                  className="w-full border-0 border-b text-base py-2 outline-none transition-colors duration-200 focus:border-b-[#08D7A5]"
                >
                  {CURRENCIES.map(currency => (
                    <option key={currency.value} value={currency.value} className="text-black">{currency.label}</option>
                  ))}
                </select>
              </div>

              <button type="submit" disabled={loading} data-testid="register-submit-button"
                className="w-full mt-2 rounded-xl border border-white/12 bg-white/[0.04] hover:bg-white/[0.09] active:scale-[0.99] text-white/85 text-xs tracking-[0.28em] uppercase py-4 transition-colors duration-200 disabled:opacity-50">
                {loading ? tr("Enviando...") : tr("Solicitar acesso")}
              </button>
            </form>

            <div className="mt-6 text-xs text-white/40">
              {tr("Já tem conta?")}{" "}
              <Link to="/login" className="text-white/70 hover:text-white transition-colors" data-testid="link-login">
                {tr("Entrar")}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
