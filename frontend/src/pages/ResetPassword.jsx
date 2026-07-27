import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Logo from "@/components/Logo";
import LanguageSelector from "@/components/LanguageSelector";
import { translate as tr } from "@/i18n";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token] = useState(() => (
    new URLSearchParams(window.location.hash.slice(1)).get("token")
    || params.get("token")
    || ""
  ));
  const [validating, setValidating] = useState(true);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setValidating(false);
      return;
    }
    window.history.replaceState({}, document.title, "/redefinir-senha");
    api.post("/auth/password-reset/validate", { token })
      .then(() => setValid(true))
      .catch(() => setValid(false))
      .finally(() => setValidating(false));
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    if (password !== confirmation) {
      toast.error(tr("As senhas não coincidem."));
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/password-reset/confirm", {
        token,
        new_password: password,
      });
      toast.success(tr("Senha redefinida. Entre com sua nova senha."));
      navigate("/login", { replace: true });
    } catch (error) {
      toast.error(formatApiError(error));
      if (error?.response?.status === 400) setValid(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#04112F] px-6">
      <LanguageSelector compact className="absolute right-4 top-4 z-20 text-white/70" />
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(circle at 50% 52%, rgba(8,215,165,0.12), rgba(18,104,244,0.07) 32%, transparent 60%)" }} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.04] p-7 text-white shadow-2xl">
        <Logo variant="full" surface="dark" className="mx-auto mb-10 h-12 w-auto max-w-[220px]" />
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "Outfit" }}>
          {tr("Redefinir senha")}
        </h1>

        {validating ? (
          <p className="mt-4 text-sm text-white/55">{tr("Validando link...")}</p>
        ) : !valid ? (
          <div className="mt-5 space-y-5">
            <p className="rounded-xl border border-rose-300/30 bg-rose-400/10 p-4 text-sm text-rose-100">
              {tr("Este link é inválido, expirou ou já foi utilizado.")}
            </p>
            <Link to="/login" className="block text-center text-sm text-[#08D7A5] hover:text-white">
              {tr("Solicitar um novo link")}
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-5">
            <div>
              <Label htmlFor="reset-password" className="text-white/70">{tr("Nova senha")}</Label>
              <div className="relative mt-2">
                <Input id="reset-password" type={revealed ? "text" : "password"}
                  value={password} onChange={(event) => setPassword(event.target.value)}
                  minLength={8} maxLength={128} required autoComplete="new-password"
                  data-testid="reset-password-input"
                  className="border-white/15 bg-transparent pr-11 text-white" />
                <button type="button" onClick={() => setRevealed((current) => !current)}
                  aria-label={revealed ? tr("Ocultar senha") : tr("Mostrar senha")}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-white/50"
                  data-testid="reset-password-visibility-toggle">
                  {revealed ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div>
              <Label htmlFor="reset-confirmation" className="text-white/70">{tr("Confirmar nova senha")}</Label>
              <Input id="reset-confirmation" type={revealed ? "text" : "password"}
                value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
                minLength={8} maxLength={128} required autoComplete="new-password"
                data-testid="reset-password-confirmation"
                className="mt-2 border-white/15 bg-transparent text-white" />
            </div>
            <p className="text-xs text-white/45">{tr("Use pelo menos 8 caracteres.")}</p>
            <Button type="submit" disabled={submitting}
              data-testid="reset-password-submit"
              className="w-full rounded-xl bg-[#1268F4] hover:bg-[#08B6E7]">
              {submitting ? tr("Redefinindo...") : tr("Redefinir senha")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
