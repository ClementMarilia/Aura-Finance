import { Languages } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { getLanguage, LANGUAGES, setLanguage, translate as tr } from "@/i18n";

export default function LanguageSelector({ compact = false, persist = false, className = "" }) {
  const { user } = useAuth();

  const changeLanguage = async (event) => {
    const language = event.target.value;
    if (persist && user) {
      try {
        await api.put("/auth/profile", { language });
      } catch (error) {
        toast.error(formatApiError(error));
        return;
      }
    }
    setLanguage(language);
  };

  return (
    <label className={`inline-flex items-center gap-2 ${className}`}>
      {!compact && <Languages size={16} aria-hidden />}
      <span className="sr-only">{tr("Idioma")}</span>
      <select
        value={getLanguage()}
        onChange={changeLanguage}
        aria-label={tr("Idioma")}
        className="rounded-lg border border-current/15 bg-transparent px-2 py-1.5 text-xs outline-none"
        data-testid="language-selector"
      >
        {LANGUAGES.map((language) => (
          <option key={language.value} value={language.value} className="text-black">
            {language.label}
          </option>
        ))}
      </select>
    </label>
  );
}
