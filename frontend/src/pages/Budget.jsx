import { useEffect, useState } from "react";
import api, { fmtMoney } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

import { getMonthNames, translate as tr } from "@/i18n";
const COLORS = ["#061B4A", "#D96C5B", "#E5A83B", "#7EA193", "#C7BCA1"];
const MONTHS = getMonthNames("short");

export default function Budget() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.get("/dashboard", { params: period }).then(r => setData(r.data));
  }, [period.year, period.month]);

  const b = data?.budget;

  return (
    <div className="space-y-6" data-testid="budget-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>{tr("Orçamento Mensal")}</h1>
          <p className="text-[#6B7068]">{tr("Divisão automática baseada na sua receita do mês")}</p>
        </div>
        <div className="flex gap-2">
          <select value={period.month} onChange={e => setPeriod({ ...period, month: +e.target.value })}
            data-testid="budget-month-select" className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={period.year} onChange={e => setPeriod({ ...period, year: +e.target.value })}
            data-testid="budget-year-select" className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {!data ? <div className="text-[#6B7068]">{tr("Carregando...")}</div> : (
      <>
      <div className="card-soft">
        <div className="text-sm text-[#6B7068]">{tr("Receita de")} {MONTHS[period.month - 1]}/{period.year}</div>
        <div className="text-4xl font-semibold mt-1" style={{ fontFamily: "Outfit" }} data-testid="budget-income">
          {fmtMoney(b.income, curr)}
        </div>
        {b.income === 0 && (
          <div className="mt-3 text-sm text-amber-700 bg-amber-50 p-3 rounded-lg">
            {tr("Sem receita cadastrada neste mês. Cadastre uma receita (ou recorrência) para ver a divisão automática.")}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {b.rules.map((r, i) => (
          <div key={i} className="card-soft" data-testid={`budget-rule-${i}`}>
            <div className="flex items-center justify-between">
              <div className="text-sm text-[#6B7068]">{r.label}</div>
              <div className="text-xs px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: COLORS[i] }}>
                {r.percent}%
              </div>
            </div>
            <div className="text-2xl font-semibold mt-3" style={{ fontFamily: "Outfit" }}>
              {fmtMoney(r.amount, curr)}
            </div>
            <div className="mt-3 h-2 bg-[#F1EFE7] rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${r.percent}%`, backgroundColor: COLORS[i] }} />
            </div>
          </div>
        ))}
      </div>

      <div className="card-soft">
        <h3 className="text-lg font-semibold mb-3" style={{ fontFamily: "Outfit" }}>{tr("Como funciona?")}</h3>
        <ul className="text-sm text-[#6B7068] space-y-2 list-disc pl-5">
          <li><strong>{tr("50% Necessidades")}</strong>: moradia, contas fixas, mercado, transporte essencial.</li>
          <li><strong>{tr("20% Reserva / Investimentos")}</strong>: poupança, fundos, aplicações.</li>
          <li><strong>{tr("10% Lazer")}</strong>: restaurantes, entretenimento, viagens curtas.</li>
          <li><strong>{tr("10% Educação")}</strong>: cursos, livros, formação.</li>
          <li><strong>{tr("10% Outros objetivos")}</strong>: metas pessoais, presentes, doações.</li>
        </ul>
      </div>
      </>
      )}
    </div>
  );
}
