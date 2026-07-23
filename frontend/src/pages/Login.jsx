import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Check } from "lucide-react";
import Logo from "@/components/Logo";

function Field({ id, label, type, value, onChange, testid, placeholder, autoComplete }) {
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
        autoComplete={autoComplete}
        placeholder={placeholder}
        style={{ background: "transparent", color: "rgba(255,255,255,0.9)", borderColor: "rgba(255,255,255,0.15)" }}
        className="w-full border-0 border-b placeholder-white/20 text-base py-2 outline-none transition-colors duration-200 focus:border-b-[#08D7A5]"
      />
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
  const [fpStep, setFpStep] = useState(1);
  const [fpEmail, setFpEmail] = useState("");
  const [fpQuestion, setFpQuestion] = useState("");
  const [fpAnswer, setFpAnswer] = useState("");
  const [fpNewPassword, setFpNewPassword] = useState("");
  const [fpLoading, setFpLoading] = useState(false);

  const openForgot = () => {
    setFpStep(1); setFpEmail(email); setFpQuestion(""); setFpAnswer(""); setFpNewPassword("");
    setFpOpen(true);
  };

  const fpFindQuestion = async (e) => {
    e.preventDefault();
    setFpLoading(true);
    try {
      const r = await api.get("/auth/security-question", { params: { email: fpEmail } });
      if (!r.data?.question) {
        toast.error("Esta conta não tem pergunta de segurança configurada. Configure no Perfil após entrar.");
        return;
      }
      setFpQuestion(r.data.question);
      setFpStep(2);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setFpLoading(false); }
  };

  const fpReset = async (e) => {
    e.preventDefault();
    setFpLoading(true);
    try {
      await api.post("/auth/reset-password-security", {
        email: fpEmail, answer: fpAnswer, new_password: fpNewPassword,
      });
      toast.success("Senha redefinida! Faça login com a nova senha.");
      setEmail(fpEmail); setPassword("");
      setFpOpen(false);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setFpLoading(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      nav("/");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden" style={{ background: "#04112F" }}>
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
          <Field id="email" label="E-mail" type="email" value={email} testid="login-email-input"
            autoComplete="email" placeholder="voce@exemplo.com"
            onChange={(e) => setEmail(e.target.value)} />
          <Field id="password" label="Senha" type="password" value={password} testid="login-password-input"
            autoComplete="current-password" placeholder="••••••••"
            onChange={(e) => setPassword(e.target.value)} />

          <button type="submit" disabled={loading} data-testid="login-submit-button"
            className="w-full mt-2 rounded-xl border border-white/12 bg-white/[0.04] hover:bg-white/[0.09] active:scale-[0.99] text-white/85 text-xs tracking-[0.28em] uppercase py-4 transition-colors duration-200 disabled:opacity-50">
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <div className="mt-6 text-xs text-white/40">
          <button type="button" onClick={openForgot} data-testid="forgot-password-link"
            className="hover:text-white/75 transition-colors">
            Esqueci minha senha
          </button>
        </div>

        <div className="mt-3 text-xs text-white/40">
          Não tem conta?{" "}
          <Link to="/cadastro" className="text-white/70 hover:text-white transition-colors" data-testid="link-register">
            Criar conta
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
            <DialogTitle style={{ fontFamily: "Outfit" }}>Recuperar senha</DialogTitle>
          </DialogHeader>
          {fpStep === 1 ? (
            <form onSubmit={fpFindQuestion} className="space-y-3" data-testid="forgot-step-email">
              <p className="text-sm text-[#6B7068]">Informe seu e-mail para buscar sua pergunta de segurança.</p>
              <div>
                <Label>E-mail</Label>
                <Input type="email" value={fpEmail} required data-testid="forgot-email-input"
                  onChange={e => setFpEmail(e.target.value)} placeholder="voce@exemplo.com" />
              </div>
              <Button type="submit" disabled={fpLoading} data-testid="forgot-continue-button"
                className="w-full bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
                {fpLoading ? "Buscando..." : "Continuar"}
              </Button>
            </form>
          ) : (
            <form onSubmit={fpReset} className="space-y-3" data-testid="forgot-step-reset">
              <div className="text-sm">
                <span className="text-[#6B7068]">Pergunta de segurança:</span>
                <div className="font-medium mt-1" data-testid="forgot-question-text">{fpQuestion}</div>
              </div>
              <div>
                <Label>Sua resposta</Label>
                <Input value={fpAnswer} required data-testid="forgot-answer-input"
                  onChange={e => setFpAnswer(e.target.value)} />
              </div>
              <div>
                <Label>Nova senha</Label>
                <Input type="password" value={fpNewPassword} required minLength={4} data-testid="forgot-new-password-input"
                  onChange={e => setFpNewPassword(e.target.value)} placeholder="••••••••" />
              </div>
              <Button type="submit" disabled={fpLoading} data-testid="forgot-reset-button"
                className="w-full bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
                {fpLoading ? "Redefinindo..." : "Redefinir senha"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
