import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Wallet } from "lucide-react";

export default function Login() {
  const { login, formatApiError } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

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

  const demo = (em) => { setEmail(em); setPassword("demo123"); };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#F9F8F6]">
      <div className="hidden md:flex md:w-1/2 relative bg-[#1E3F33] overflow-hidden">
        <img
          src="https://images.pexels.com/photos/3184178/pexels-photo-3184178.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
          alt="Friends sharing"
          className="absolute inset-0 w-full h-full object-cover opacity-60"
        />
        <div className="relative z-10 p-12 flex flex-col justify-between text-white">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
              <Wallet size={20} />
            </div>
            <span className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>Aurea</span>
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

          <div className="mt-6 text-sm text-center text-[#6B7068]">
            Não tem conta?{" "}
            <Link to="/cadastro" className="text-[#1E3F33] font-medium hover:underline" data-testid="link-register">
              Criar conta
            </Link>
          </div>

          <div className="mt-8 p-4 rounded-xl bg-[#F1EFE7] border border-[#E5E4E0]">
            <div className="text-xs text-[#6B7068] mb-2 font-medium">Contas demonstrativas (senha: demo123)</div>
            <div className="flex flex-wrap gap-2">
              {["wendy@demo.com","marilia@demo.com","nathalia@demo.com"].map(em => (
                <button key={em} type="button" onClick={() => demo(em)} data-testid={`demo-${em.split("@")[0]}`}
                  className="px-2.5 py-1 rounded-lg text-xs bg-white border border-[#E5E4E0] hover:bg-[#E5E4E0]">
                  {em.split("@")[0]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
