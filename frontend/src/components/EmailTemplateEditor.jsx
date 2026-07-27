import { useEffect, useMemo, useState } from "react";
import { Eye, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { translate as tr } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TYPES = [
  { value: "registration_received", label: "Cadastro recebido" },
  { value: "welcome", label: "Acesso aprovado" },
  { value: "password_reset", label: "Recuperação de senha" },
];

const LANGUAGES = [
  { value: "pt", label: "Português" },
  { value: "it", label: "Italiano" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

const editablePayload = (template) => ({
  subject: template.subject,
  title: template.title,
  body: template.body,
  button_text: template.button_text || "",
  button_url: template.button_url || "",
  footer: template.footer || "",
});

export default function EmailTemplateEditor() {
  const [templates, setTemplates] = useState([]);
  const [templateType, setTemplateType] = useState("registration_received");
  const [language, setLanguage] = useState("pt");
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const selected = useMemo(
    () => templates.find(
      (item) => item.template_type === templateType && item.language === language
    ),
    [templates, templateType, language]
  );

  useEffect(() => {
    api.get("/admin/email-templates")
      .then(({ data }) => setTemplates(data.templates || []))
      .catch((error) => toast.error(formatApiError(error)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setDraft(editablePayload(selected));
    setPreview(null);
  }, [selected]);

  const change = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setPreview(null);
  };

  const replaceSelected = (template) => {
    setTemplates((current) => current.map((item) => (
      item.template_type === template.template_type && item.language === template.language
        ? template
        : item
    )));
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const { data } = await api.put(
        `/admin/email-templates/${templateType}/${language}`,
        draft
      );
      replaceSelected(data);
      toast.success(tr("Modelo de e-mail salvo."));
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setSaving(false);
    }
  };

  const showPreview = async () => {
    if (!draft || previewing) return;
    setPreviewing(true);
    try {
      const { data } = await api.post(
        `/admin/email-templates/${templateType}/${language}/preview`,
        draft
      );
      setPreview(data);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setPreviewing(false);
    }
  };

  const restore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const { data } = await api.delete(
        `/admin/email-templates/${templateType}/${language}`
      );
      replaceSelected(data);
      toast.success(tr("Modelo padrão restaurado."));
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setRestoring(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-[#6B7068]">{tr("Carregando...")}</p>;
  }
  if (!draft || !selected) return null;

  return (
    <div className="space-y-5" data-testid="email-template-editor">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>{tr("Tipo de e-mail")}</Label>
          <Select value={templateType} onValueChange={setTemplateType}>
            <SelectTrigger className="mt-1" data-testid="email-template-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((item) => (
                <SelectItem key={item.value} value={item.value}>{tr(item.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{tr("Idioma do modelo")}</Label>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="mt-1" data-testid="email-template-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
        <div className="font-medium">{tr("Variáveis disponíveis")}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {selected.placeholders.length ? selected.placeholders.map((placeholder) => (
            <code key={placeholder} className="rounded bg-white px-2 py-1 text-xs">
              {`{${placeholder}}`}
            </code>
          )) : <span className="text-xs">{tr("Nenhuma variável disponível.")}</span>}
        </div>
        <p className="mt-2 text-xs opacity-80">
          {tr("Use somente essas variáveis. O sistema substitui os valores no envio.")}
        </p>
      </div>

      <div>
        <Label htmlFor="email-template-subject">{tr("Assunto")}</Label>
        <Input id="email-template-subject" className="mt-1" value={draft.subject}
          onChange={(event) => change("subject", event.target.value)}
          data-testid="email-template-subject" />
      </div>
      <div>
        <Label htmlFor="email-template-title">{tr("Título")}</Label>
        <Input id="email-template-title" className="mt-1" value={draft.title}
          onChange={(event) => change("title", event.target.value)}
          data-testid="email-template-title" />
      </div>
      <div>
        <Label htmlFor="email-template-body">{tr("Conteúdo")}</Label>
        <Textarea id="email-template-body" className="mt-1 min-h-32" value={draft.body}
          onChange={(event) => change("body", event.target.value)}
          data-testid="email-template-body" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="email-template-button">{tr("Texto do botão")}</Label>
          <Input id="email-template-button" className="mt-1" value={draft.button_text}
            onChange={(event) => change("button_text", event.target.value)}
            placeholder={tr("Deixe vazio para não mostrar botão")}
            data-testid="email-template-button" />
        </div>
        <div>
          <Label htmlFor="email-template-button-url">{tr("Link do botão")}</Label>
          <Input id="email-template-button-url" className="mt-1" type="url"
            value={selected.button_url_managed ? tr("Gerado com segurança pelo sistema") : draft.button_url}
            disabled={selected.button_url_managed}
            onChange={(event) => change("button_url", event.target.value)}
            data-testid="email-template-button-url" />
        </div>
      </div>
      <div>
        <Label htmlFor="email-template-footer">{tr("Rodapé")}</Label>
        <Textarea id="email-template-footer" className="mt-1 min-h-20" value={draft.footer}
          onChange={(event) => change("footer", event.target.value)}
          data-testid="email-template-footer" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={saving}
          className="rounded-xl bg-[#061B4A] hover:bg-[#1268F4]">
          <Save size={16} className="mr-2" />
          {saving ? tr("Salvando...") : tr("Salvar modelo")}
        </Button>
        <Button type="button" variant="outline" onClick={showPreview} disabled={previewing}
          className="rounded-xl">
          <Eye size={16} className="mr-2" />
          {previewing ? tr("Carregando...") : tr("Visualizar")}
        </Button>
        <Button type="button" variant="ghost" onClick={restore}
          disabled={restoring || !selected.is_customized} className="rounded-xl">
          <RotateCcw size={16} className="mr-2" />
          {tr("Restaurar padrão")}
        </Button>
      </div>

      {preview && (
        <div className="space-y-2" data-testid="email-template-preview">
          <div className="rounded-xl border border-[#E5E4E0] bg-[#F8F7F4] p-3 text-sm">
            <span className="font-semibold">{tr("Assunto")}:</span> {preview.subject}
          </div>
          <iframe
            title={tr("Pré-visualização do e-mail")}
            srcDoc={preview.html}
            sandbox=""
            className="h-[620px] w-full rounded-xl border border-[#E5E4E0] bg-white"
          />
        </div>
      )}
    </div>
  );
}
