import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2, Plus, Pencil, X, RefreshCw, CheckCircle2, DownloadCloud, AlertTriangle, UserX, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/ConfirmDialog";
import ThemeToggle from "@/components/ThemeToggle";
import { usePWAUpdate } from "@/context/PWAUpdateContext";
import { useAuth } from "@/context/AuthContext";
import LanguageSelector from "@/components/LanguageSelector";
import { translate as tr } from "@/i18n";
import { useNavigate } from "react-router-dom";

const NOTIF_LABELS = {
  shared_expense_added: { title: tr("Despesas compartilhadas"), desc: tr("Quando você é adicionado a uma nova despesa.") },
  settlement_paid: { title: tr("Acertos recebidos"), desc: tr("Quando alguém marca um valor como pago a você.") },
  nudge: { title: tr("Lembretes (cutucadas)"), desc: tr("Quando alguém te lembra de uma dívida pendente.") },
  group_added: { title: tr("Grupos"), desc: tr("Quando você é adicionado a um grupo.") },
};

const KIND_LABEL = { expense: tr("Despesa"), income: tr("Receita"), both: tr("Ambos") };
const KIND_BADGE = {
  expense: "bg-rose-50 text-rose-700",
  income: "bg-emerald-50 text-emerald-700",
  both: "bg-[#F1EFE7] text-[#061B4A]",
};

const defaultCatForm = () => ({ name: "", color: "#061B4A", kind: "expense" });

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const {
    appVersion,
    supported: pwaSupported,
    updateAvailable,
    checking: checkingUpdate,
    applying: applyingUpdate,
    checkForUpdate,
    applyUpdate,
  } = usePWAUpdate();
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState(defaultCatForm());
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [tab, setTab] = useState("expense"); // expense | income | both
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState(null);
  const [deleteForm, setDeleteForm] = useState({ password: "", confirmation: "" });
  const [loadingDeleteImpact, setLoadingDeleteImpact] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [emailSettings, setEmailSettings] = useState(null);
  const [emailSettingsLoading, setEmailSettingsLoading] = useState(false);
  const [emailSettingsSaving, setEmailSettingsSaving] = useState(false);
  const [testEmail, setTestEmail] = useState(user?.email || "");
  const [sendingTestEmail, setSendingTestEmail] = useState(false);

  const load = () => api.get("/categories").then(r => setCats(r.data));
  const loadPrefs = () => api.get("/notifications/preferences").then(r => setPrefs(r.data));
  useEffect(() => { load(); loadPrefs(); }, []);
  useEffect(() => {
    if (!user?.is_super_admin) return;
    setEmailSettingsLoading(true);
    api.get("/admin/email-settings")
      .then(({ data }) => setEmailSettings(data))
      .catch((err) => toast.error(formatApiError(err)))
      .finally(() => setEmailSettingsLoading(false));
  }, [user?.is_super_admin]);

  const togglePref = async (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      await api.put("/notifications/preferences", { prefs: next });
    } catch (err) {
      toast.error(formatApiError(err));
      loadPrefs();
    }
  };

  const startEdit = (c) => {
    setEditing(c);
    setForm({ name: c.name, color: c.color || "#061B4A", kind: c.kind || "expense" });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(defaultCatForm());
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: form.name.trim(),
        color: form.color,
        kind: form.kind,
      };
      if (!payload.name) {
        toast.error(tr("Nome é obrigatório"));
        return;
      }
      if (editing) {
        await api.put(`/categories/${editing.id}`, payload);
        toast.success(tr("Categoria atualizada"));
      } else {
        await api.post("/categories", payload);
        toast.success(tr("Categoria criada"));
      }
      cancelEdit();
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const remove = async () => {
    if (!confirmDel) return;
    await api.delete(`/categories/${confirmDel.id}`);
    setConfirmDel(null);
    toast.success(tr("Categoria excluída"));
    load();
  };

  const filteredCats = cats.filter(c => {
    const k = c.kind || "expense";
    return k === tab;
  });

  const handleCheckForUpdate = async () => {
    const result = await checkForUpdate();
    if (result.error) {
      toast.error(tr("Não foi possível verificar atualizações. Confira sua conexão."));
    } else if (result.updateAvailable) {
      toast.success(tr("Nova versão pronta para instalar."));
    } else if (!result.supported) {
      toast.info(tr("A verificação automática está disponível no aplicativo instalado."));
    } else {
      toast.success(tr("Você já está usando a versão mais recente."));
    }
  };

  const openAccountDeletion = async () => {
    setDeleteOpen(true);
    setDeleteImpact(null);
    setDeleteForm({ password: "", confirmation: "" });
    setLoadingDeleteImpact(true);
    try {
      const { data } = await api.get("/auth/account/deletion-impact");
      setDeleteImpact(data);
    } catch (err) {
      toast.error(formatApiError(err));
      setDeleteOpen(false);
    } finally {
      setLoadingDeleteImpact(false);
    }
  };

  const deleteAccount = async () => {
    if (!deleteImpact?.can_delete || deletingAccount) return;
    setDeletingAccount(true);
    try {
      await api.delete("/auth/account", { data: deleteForm });
      logout();
      navigate("/login", { replace: true });
      toast.success(tr("Sua conta foi excluída definitivamente."));
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (detail && typeof detail === "object" && detail.message) {
        toast.error(tr(detail.message));
        try {
          const { data } = await api.get("/auth/account/deletion-impact");
          setDeleteImpact(data);
        } catch {
          // A mensagem original continua sendo a informação mais útil.
        }
      } else {
        toast.error(formatApiError(err));
      }
    } finally {
      setDeletingAccount(false);
    }
  };

  const deletionBlockerLabel = (blocker) => ({
    pending_settlements: tr("Existem despesas compartilhadas ou acertos pendentes."),
    last_active_admin: tr("Você é a única pessoa administradora ativa. Defina outra antes de excluir sua conta."),
  }[blocker] || blocker);

  const saveEmailSettings = async () => {
    if (!emailSettings || emailSettingsSaving) return;
    setEmailSettingsSaving(true);
    try {
      const { credential_configured, provider, ...payload } = emailSettings;
      const { data } = await api.put("/admin/email-settings", {
        ...payload,
        reply_to: payload.reply_to || null,
      });
      setEmailSettings(data);
      toast.success(tr("Configuração de e-mail salva."));
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setEmailSettingsSaving(false);
    }
  };

  const sendTestEmail = async () => {
    if (!testEmail || sendingTestEmail) return;
    setSendingTestEmail(true);
    try {
      await api.post("/admin/email-settings/test", {
        recipient: testEmail,
        language: user?.language || "pt",
      });
      toast.success(tr("E-mail de teste enviado."));
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSendingTestEmail(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl" data-testid="settings-page">
      <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>{tr("Configurações")}</h1>

      <div className="card-soft" data-testid="language-section">
        <h3 className="text-lg font-semibold mb-1" style={{ fontFamily: "Outfit" }}>{tr("Idioma")}</h3>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          {tr("Selecione o idioma usado no aplicativo.")}
        </p>
        <LanguageSelector persist />
      </div>

      <div className="card-soft" data-testid="theme-section">
        <h3 className="text-lg font-semibold mb-1" style={{ fontFamily: "Outfit" }}>{tr("Aparência")}</h3>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          {tr("Escolha como o app deve aparecer para você. Selecione “Sistema” para seguir automaticamente as preferências do seu celular ou computador.")}
        </p>
        <ThemeToggle />
      </div>

      <div className="card-soft" data-testid="app-update-section">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>
              {tr("Atualizações do aplicativo")}
            </h3>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {tr("A Crelith Finance avisa quando uma nova versão estiver pronta. A atualização só é aplicada quando você confirmar.")}
            </p>
          </div>
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
              updateAvailable
                ? "bg-blue-50 text-blue-600"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {updateAvailable ? <DownloadCloud size={20} /> : <CheckCircle2 size={20} />}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-[#E5E4E0] p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              {tr("Versão instalada")}
            </span>
            <span className="text-sm font-semibold" data-testid="app-version">
              v{appVersion}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              {tr("Status")}
            </span>
            <span
              className={`text-sm font-medium ${
                updateAvailable ? "text-blue-600" : "text-emerald-700"
              }`}
              data-testid="app-update-status"
            >
              {updateAvailable ? tr("Nova versão disponível") : tr("Aplicativo atualizado")}
            </span>
          </div>
        </div>

        {updateAvailable && (
          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            {tr("Salve qualquer lançamento em edição antes de atualizar. O aplicativo será recarregado uma única vez.")}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCheckForUpdate}
            disabled={checkingUpdate || applyingUpdate}
            data-testid="check-app-update"
            className="rounded-xl"
          >
            <RefreshCw size={16} className={`mr-2 ${checkingUpdate ? "animate-spin" : ""}`} />
            {checkingUpdate ? tr("Verificando...") : tr("Verificar atualizações")}
          </Button>
          {updateAvailable && (
            <Button
              type="button"
              onClick={applyUpdate}
              disabled={applyingUpdate}
              data-testid="apply-app-update"
              className="rounded-xl bg-[#061B4A] hover:bg-[#1268F4]"
            >
              <DownloadCloud size={16} className="mr-2" />
              {applyingUpdate ? tr("Atualizando...") : tr("Atualizar agora")}
            </Button>
          )}
        </div>

        {!pwaSupported && (
          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            {tr("Este navegador não oferece suporte à atualização de PWA.")}
          </p>
        )}
      </div>

      <div className="card-soft" data-testid="notif-prefs-section">
        <h3 className="text-lg font-semibold mb-1" style={{ fontFamily: "Outfit" }}>{tr("Notificações")}</h3>
        <p className="text-sm text-[#6B7068] mb-4">{tr("Escolha quais alertas você quer receber.")}</p>
        <div className="space-y-3">
          {Object.entries(NOTIF_LABELS).map(([key, { title, desc }]) => (
            <div key={key} className="flex items-center justify-between gap-4 p-3 border border-[#E5E4E0] rounded-xl">
              <div>
                <div className="text-sm font-medium text-[#1A1C1A]">{title}</div>
                <div className="text-xs text-[#6B7068]">{desc}</div>
              </div>
              <Switch
                data-testid={`notif-pref-${key}`}
                className="data-[state=checked]:bg-[#061B4A] data-[state=unchecked]:bg-[#D6D3CA]"
                checked={prefs ? prefs[key] !== false : true}
                onCheckedChange={(v) => togglePref(key, v)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card-soft">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>{tr("Categorias")}</h3>
          <p className="text-xs text-[#6B7068]">{tr("Crie categorias para Receitas (ex: Salário) e Despesas (ex: Gasolina).")}</p>
        </div>

        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end mb-4" data-testid="cat-form">
          <div className="sm:col-span-5">
            <Label>{tr("Nome")}</Label>
            <Input value={form.name} required data-testid="settings-cat-name"
              placeholder="Ex: Salário, Gasolina, Mercado"
              onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="sm:col-span-3">
            <Label>{tr("Tipo")}</Label>
            <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
              <SelectTrigger data-testid="settings-cat-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">{tr("Despesa")}</SelectItem>
                <SelectItem value="income">{tr("Receita")}</SelectItem>
                <SelectItem value="both">{tr("Ambos")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>{tr("Cor")}</Label>
            <Input type="color" value={form.color} className="w-full h-10 p-1" data-testid="settings-cat-color"
              onChange={e => setForm({ ...form, color: e.target.value })} />
          </div>
          <div className="sm:col-span-2 flex gap-1">
            <Button type="submit" data-testid="settings-add-cat" className="flex-1 bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
              {editing ? <Pencil size={16} className="mr-1" /> : <Plus size={16} className="mr-1" />}
              {editing ? tr("Salvar") : tr("Adicionar")}
            </Button>
            {editing && (
              <Button type="button" variant="outline" onClick={cancelEdit} data-testid="settings-cancel-edit" className="rounded-xl">
                <X size={16} />
              </Button>
            )}
          </div>
        </form>

        {/* Tabs por tipo */}
        <div className="flex gap-1 mb-3 border-b border-[#E5E4E0]" data-testid="cat-tabs">
          {[
            { key: "expense", label: tr("Despesas") },
            { key: "income", label: tr("Receitas") },
            { key: "both", label: tr("Ambos") },
          ].map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              data-testid={`cat-tab-${t.key}`}
              className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition ${
                tab === t.key
                  ? "border-[#061B4A] text-[#061B4A]"
                  : "border-transparent text-[#6B7068] hover:text-[#061B4A]"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-[#6B7068]">
                ({cats.filter(c => (c.kind || "expense") === t.key).length})
              </span>
            </button>
          ))}
        </div>

        {filteredCats.length === 0 ? (
          <div className="text-sm text-[#6B7068] py-8 text-center">
            Nenhuma categoria de {KIND_LABEL[tab].toLowerCase()} criada ainda.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {filteredCats.map(c => {
              const kind = c.kind || "expense";
              return (
                <div key={c.id} className="flex items-center justify-between p-3 border border-[#E5E4E0] rounded-xl" data-testid={`cat-row-${c.id}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                    <span className="truncate">{tr(c.name)}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${KIND_BADGE[kind]}`}>
                      {KIND_LABEL[kind]}
                    </span>
                    {c.is_default && <span className="text-xs text-[#6B7068]">(padrão)</span>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => startEdit(c)} className="text-[#6B7068] hover:text-[#061B4A] p-1" data-testid={`cat-edit-${c.id}`} title={tr("Editar")}>
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setConfirmDel(c)} className="text-[#6B7068] hover:text-[#D9453B] p-1" data-testid={`cat-delete-${c.id}`} title={tr("Excluir")}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {user?.is_super_admin && (
        <div id="transactional-email" className="card-soft scroll-mt-24" data-testid="transactional-email-section">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>
                {tr("E-mails transacionais")}
              </h3>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                {tr("Configure boas-vindas e recuperação de senha. A chave secreta permanece somente no servidor.")}
              </p>
            </div>
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <Mail size={20} />
            </div>
          </div>

          {emailSettingsLoading ? (
            <p className="mt-4 text-sm text-[#6B7068]">{tr("Carregando...")}</p>
          ) : emailSettings && (
            <div className="mt-5 space-y-5">
              <div className={`flex items-center gap-3 rounded-xl border p-3 ${
                emailSettings.credential_configured
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}>
                <ShieldCheck size={18} />
                <div className="text-sm">
                  <div className="font-semibold">
                    {emailSettings.credential_configured
                      ? tr("Resend configurado no servidor")
                      : tr("Resend ainda não configurado no servidor")}
                  </div>
                  <div className="mt-0.5 text-xs opacity-80">
                    {tr("A credencial nunca é exibida ou armazenada neste painel.")}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {[
                  ["enabled", tr("Ativar serviço de e-mail")],
                  ["registration_enabled", tr("Enviar confirmação de cadastro")],
                  ["welcome_enabled", tr("Enviar boas-vindas após aprovação")],
                  ["password_reset_enabled", tr("Permitir recuperação de senha")],
                ].map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-4">
                    <Label htmlFor={`email-${key}`}>{label}</Label>
                    <Switch id={`email-${key}`} checked={!!emailSettings[key]}
                      onCheckedChange={(checked) => setEmailSettings((current) => ({
                        ...current,
                        [key]: checked,
                      }))}
                      data-testid={`email-setting-${key}`} />
                  </div>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="email-from-name">{tr("Nome do remetente")}</Label>
                  <Input id="email-from-name" value={emailSettings.from_name}
                    onChange={(event) => setEmailSettings((current) => ({
                      ...current,
                      from_name: event.target.value,
                    }))}
                    data-testid="email-from-name" />
                </div>
                <div>
                  <Label htmlFor="email-from-address">{tr("E-mail do remetente")}</Label>
                  <Input id="email-from-address" type="email" value={emailSettings.from_email}
                    onChange={(event) => setEmailSettings((current) => ({
                      ...current,
                      from_email: event.target.value,
                    }))}
                    data-testid="email-from-address" />
                </div>
                <div>
                  <Label htmlFor="email-reply-to">{tr("Responder para (opcional)")}</Label>
                  <Input id="email-reply-to" type="email" value={emailSettings.reply_to || ""}
                    onChange={(event) => setEmailSettings((current) => ({
                      ...current,
                      reply_to: event.target.value,
                    }))}
                    data-testid="email-reply-to" />
                </div>
                <div>
                  <Label htmlFor="email-expiration">{tr("Validade do link (minutos)")}</Label>
                  <Input id="email-expiration" type="number" min="10" max="120"
                    value={emailSettings.reset_expires_minutes}
                    onChange={(event) => setEmailSettings((current) => ({
                      ...current,
                      reset_expires_minutes: Number(event.target.value),
                    }))}
                    data-testid="email-reset-expiration" />
                </div>
              </div>
              <div>
                <Label htmlFor="email-logo-url">{tr("URL da logo nos e-mails")}</Label>
                <Input id="email-logo-url" type="url" value={emailSettings.logo_url}
                  onChange={(event) => setEmailSettings((current) => ({
                    ...current,
                    logo_url: event.target.value,
                  }))}
                  data-testid="email-logo-url" />
              </div>
              <div>
                <Label htmlFor="email-reset-url">{tr("URL da tela de redefinição")}</Label>
                <Input id="email-reset-url" type="url" value={emailSettings.reset_url}
                  onChange={(event) => setEmailSettings((current) => ({
                    ...current,
                    reset_url: event.target.value,
                  }))}
                  data-testid="email-reset-url" />
              </div>
              <Button type="button" onClick={saveEmailSettings}
                disabled={emailSettingsSaving} className="rounded-xl bg-[#061B4A] hover:bg-[#1268F4]"
                data-testid="save-email-settings">
                {emailSettingsSaving ? tr("Salvando...") : tr("Salvar configuração")}
              </Button>

              <div className="border-t border-[#E5E4E0] pt-5">
                <Label htmlFor="email-test-recipient">{tr("Enviar teste para")}</Label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Input id="email-test-recipient" type="email" value={testEmail}
                    onChange={(event) => setTestEmail(event.target.value)}
                    data-testid="email-test-recipient" />
                  <Button type="button" variant="outline" onClick={sendTestEmail}
                    disabled={!emailSettings.credential_configured || sendingTestEmail}
                    className="rounded-xl" data-testid="send-test-email">
                    {sendingTestEmail ? tr("Enviando...") : tr("Enviar teste")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card-soft border border-rose-200" data-testid="account-section">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>
              {tr("Conta")}
            </h3>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {tr("Exclua sua conta e remova definitivamente seus dados pessoais e financeiros.")}
            </p>
          </div>
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-700">
            <UserX size={20} />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={openAccountDeletion}
          data-testid="delete-own-account"
          className="mt-4 rounded-xl border-rose-300 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
        >
          <Trash2 size={16} className="mr-2" />
          {tr("Excluir minha conta")}
        </Button>
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title={tr("Excluir categoria?")}
        description={confirmDel ? tr("\"{name}\" será removida. Lançamentos existentes não serão afetados.", { name: confirmDel.name }) : ""}
        onConfirm={remove}
        testId="cat-confirm-delete"
      />

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deletingAccount) setDeleteOpen(open);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="delete-account-dialog">
          <DialogHeader>
            <DialogTitle>{tr("Excluir minha conta")}</DialogTitle>
          </DialogHeader>

          {loadingDeleteImpact ? (
            <div className="py-8 text-center text-sm text-[#6B7068]">
              {tr("Verificando sua conta...")}
            </div>
          ) : deleteImpact && (
            <div className="space-y-4">
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 flex-shrink-0 text-rose-700" size={20} />
                  <div>
                    <p className="font-semibold text-rose-800">{tr("Esta ação é irreversível.")}</p>
                    <p className="mt-1 text-sm text-rose-700">
                      {tr("Sua conta, lançamentos, carteiras, metas, categorias e preferências serão excluídos. Todas as sessões serão encerradas.")}
                    </p>
                  </div>
                </div>
              </div>

              {deleteImpact.blockers?.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" data-testid="delete-account-blockers">
                  <p className="font-semibold text-amber-900">{tr("A exclusão está bloqueada")}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
                    {deleteImpact.blockers.map((blocker) => (
                      <li key={blocker}>{deletionBlockerLabel(blocker)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {deleteImpact.impact?.shared_expenses > 0 && (
                <p className="text-sm text-[#6B7068]">
                  {tr("O histórico compartilhado já concluído será mantido para os outros participantes com sua identidade anonimizada.")}
                </p>
              )}

              {deleteImpact.can_delete && (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="delete-account-password">{tr("Senha atual")}</Label>
                    <Input
                      id="delete-account-password"
                      type="password"
                      autoComplete="current-password"
                      value={deleteForm.password}
                      onChange={(event) => setDeleteForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))}
                      data-testid="delete-account-password"
                    />
                  </div>
                  <div>
                    <Label htmlFor="delete-account-confirmation">
                      {tr("Digite seu e-mail para confirmar")}
                    </Label>
                    <Input
                      id="delete-account-confirmation"
                      value={deleteForm.confirmation}
                      onChange={(event) => setDeleteForm((current) => ({
                        ...current,
                        confirmation: event.target.value,
                      }))}
                      placeholder={user?.email}
                      autoComplete="off"
                      data-testid="delete-account-confirmation"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deletingAccount}
              className="rounded-xl"
            >
              {tr("Cancelar")}
            </Button>
            {deleteImpact?.can_delete && (
              <Button
                type="button"
                onClick={deleteAccount}
                disabled={
                  deletingAccount
                  || !deleteForm.password
                  || deleteForm.confirmation.trim().toLowerCase() !== user?.email?.trim().toLowerCase()
                }
                data-testid="confirm-delete-own-account"
                className="rounded-xl bg-[#D9453B] text-white hover:bg-[#B83A30]"
              >
                {deletingAccount ? tr("Excluindo...") : tr("Excluir definitivamente")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
