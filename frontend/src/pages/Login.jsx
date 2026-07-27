import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Check, Eye, EyeOff } from "lucide-react";
import Logo from "@/components/Logo";
import LanguageSelector from "@/components/LanguageSelector";
import { getLanguage, translate as tr } from "@/i18n";

function Field({
  id,
  label,
  type,
  value,
  onChange,
  testid,
  placeholder,
  autoComplete,
  revealable = false,
}) {
  const [revealed, setRevealed] = useState(false);
  const inputType = revealable && revealed ? "text" : type;

  return (
    <div className="text-left">
      <label htmlFor={id} className="block text-[11px] tracking-[0.18em] uppercase text-white/40 mb-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          data-testid={testid}
          type={inputType}
          value={value}
          onChange={onChange}
          required
          autoComplete={autoComplete}
          placeholder={placeholder}
          style={{ background: "transparent", color: "rgba(255,255,255,0.9)", borderColor: "rgba(255,255,255,0.15)" }}
          className={`w-full border-0 border-b placeholder-white/20 text-base py-2 outline-none transition-colors duration-200 focus:border-b-[#08D7A5] ${revealable ? "pr-10" : ""}`}
        />
        {revealable && (
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-white/40 transition-colors hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#08D7A5] focus-visible:ring-offset-2 focus-visible:ring-offset-[#04112F]"
            aria-controls={id}
            aria-label={revealed ? tr("Ocultar senha") : tr("Mostrar senha")}
            aria-pressed={revealed}
            title={revealed ? tr("Ocultar senha") : tr("Mostrar senha")}
            data-testid={`${testid}-visibility-toggle`}
          >
            {revealed ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Login() {
  const { login, formatApiError } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const [fpOpen, setFpOpen] = useState(false);
  const [fpEmail, setFpEmail] = useState("");
  const [fpLoading, setFpLoading] = useState(false);
  const [fpSent, setFpSent] = useState(false);

  const openForgot = () => {
    setFpEmail(email);
    setFpSent(false);
    setFpOpen(true);
  };

  const fpRequest = async (e) => {
    e.preventDefault();
    setFpLoading(true);
    try {
      await api.post("/auth/password-reset/request", { email: fpEmail });
      setFpSent(true);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setFpLoading(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const previousLanguage = getLanguage();
      const signedInUser = await login(email, password);
      if (signedInUser?.language && signedInUser.language !== previousLanguage) {
        window.location.assign("/");
      } else {
        nav("/");
      }
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
        <div className="mb-16 flex items-center justify-center">
          <Logo variant="full" surface="dark" className="h-14 w-auto max-w-[250px]" />
        </div>

        <form onSubmit={submit} className="space-y-7">
          <Field id="email" label={tr("E-mail")} type="email" value={email} testid="login-email-input"
            autoComplete="email" placeholder="voce@exemplo.com"
            onChange={(e) => setEmail(e.target.value)} />
          <Field id="password" label={tr("Senha")} type="password" value={password} testid="login-password-input"
            autoComplete="current-password" placeholder="••••••••" revealable
            onChange={(e) => setPassword(e.target.value)} />

          <button type="submit" disabled={loading} data-testid="login-submit-button"
            className="w-full mt-2 rounded-xl border border-white/12 bg-white/[0.04] hover:bg-white/[0.09] active:scale-[0.99] text-white/85 text-xs tracking-[0.28em] uppercase py-4 transition-colors duration-200 disabled:opacity-50">
            {loading ? tr("Entrando...") : tr("Entrar")}
          </button>
        </form>

        <div className="mt-6 text-xs text-white/40">
          <button type="button" onClick={openForgot} data-testid="forgot-password-link"
            className="hover:text-white/75 transition-colors">
            {tr("Esqueci minha senha")}
          </button>
        </div>

        <div className="mt-3 text-xs text-white/40">
          {tr("Não tem conta?")}{" "}
          <Link to="/cadastro" className="text-white/70 hover:text-white transition-colors" data-testid="link-register">
            {tr("Criar conta")}
          </Link>
        </div>

        {/* Decorative spinner-check */}
        <div className="mt-16 flex justify-center">
          <div className="relative w-9 h-9 rounded-full border border-white/10 flex items-center justify-center">
            <span className="absolute inset-0 rounded-full border-t border-[#08B6E7]/70 animate-spin" style={{ animationDuration: "2.6s" }} />
            <Check size={13} className="text-white/45" />
          </div>
        </div>
      </div>

      <Dialog open={fpOpen} onOpenChange={setFpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Outfit" }}>{tr("Recuperar senha")}</DialogTitle>
          </DialogHeader>
          {!fpSent ? (
            <form onSubmit={fpRequest} className="space-y-3" data-testid="forgot-step-email">
              <p className="text-sm text-[#6B7068]">
                {tr("Informe seu e-mail para receber o link de recuperação.")}
              </p>
              <div>
                <Label>{tr("E-mail")}</Label>
                <Input type="email" value={fpEmail} required data-testid="forgot-email-input"
                  onChange={e => setFpEmail(e.target.value)} placeholder="voce@exemplo.com" />
              </div>
              <Button type="submit" disabled={fpLoading} data-testid="forgot-send-button"
                className="w-full bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
                {fpLoading ? tr("Enviando...") : tr("Enviar link")}
              </Button>
            </form>
          ) : (
            <div className="space-y-4 py-2" data-testid="forgot-request-sent">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                {tr("Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.")}
              </div>
              <p className="text-sm text-[#6B7068]">
                {tr("Confira também a caixa de spam. O link expira e funciona apenas uma vez.")}
              </p>
              <Button type="button" variant="outline" onClick={() => setFpOpen(false)}
                data-testid="forgot-close-button" className="w-full rounded-xl">
                {tr("Voltar para o login")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
