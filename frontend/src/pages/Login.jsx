import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import Logo from "@/components/Logo";

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
    <div className="min-h-screen flex flex-col md:flex-row bg-[#F9F8F6]">
      <div className="hidden md:flex md:w-1/2 relative bg-[#1E3F33] overflow-hidden">
        <img
          src="https://images.pexels.com/photos/3184178/pexels-photo-3184178.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
          alt="Friends sharing"
          className="absolute inset-0 w-full h-full object-cover opacity-60"
        />
        <div className="relative z-10 p-12 flex flex-col justify-between text-white">
          <div className="flex items-center gap-3">
            <img src="/logo-mark-dark.png" alt="Aura Finance" className="h-12 w-auto drop-shadow-lg" />
            <span className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>Aura Finance</span>
          </div>
          <div>
            <h1 className="text-4xl lg:text-5xl font-semibold leading-tight" style={{ fontFamily: "Outfit" }}>
              Suas finanças,<br/>juntas ou separadas.
            </h1>
            <p className="mt-4 text-white/85 max-w-md">
              Controle pessoal privado, despesas compartilhadas com cálculo automático de acertos.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-sm">
          <h2 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Entrar</h2>
          <p className="text-[#6B7068] mt-1 text-sm">Acesse seu painel financeiro</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" data-testid="login-email-input" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} required className="mt-1.5" placeholder="voce@exemplo.com" />
            </div>
            <div>
              <Label htmlFor="password">Senha</Label>
              <Input id="password" data-testid="login-password-input" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} required className="mt-1.5" placeholder="••••••••" />
            </div>
            <Button type="submit" disabled={loading} data-testid="login-submit-button"
              className="w-full bg-[#1E3F33] hover:bg-[#2C5C4A] text-white rounded-xl py-5">
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>

          <div className="mt-3 text-center">
            <button type="button" onClick={openForgot} data-testid="forgot-password-link"
              className="text-sm text-[#1E3F33] hover:underline">
              Esqueci minha senha
            </button>
          </div>

          <div className="mt-6 text-sm text-center text-[#6B7068]">
            Não tem conta?{" "}
            <Link to="/cadastro" className="text-[#1E3F33] font-medium hover:underline" data-testid="link-register">
              Criar conta
            </Link>
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
                className="w-full bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">
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
                className="w-full bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">
                {fpLoading ? "Redefinindo..." : "Redefinir senha"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
