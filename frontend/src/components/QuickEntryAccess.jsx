import { Link } from "react-router-dom";
import "@/i18n/ai";
import { translate as tr } from "@/i18n";

export default function QuickEntryAccess() {
  return <nav aria-label={tr("Adicionar rápido")} className="mb-5 flex flex-wrap gap-2">
    <Link to="/adicionar" className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#00C9A7] px-4 py-2 text-sm font-medium text-[#04112F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {tr("Adicionar rápido")}
    </Link>
    <Link to="/adicionar?instalar=1" className="inline-flex min-h-[44px] items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {tr("Criar atalho no celular")}
    </Link>
  </nav>;
}
