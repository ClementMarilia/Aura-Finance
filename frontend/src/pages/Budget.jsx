import { useEffect, useState } from "react";
import api, { fmtMoney } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const COLORS = ["#1E3F33", "#D96C5B", "#E5A83B", "#7EA193", "#C7BCA1"];

export default function Budget() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [data, setData] = useState(null);

  useEffect(() => {
    const d = new Date();
    api.get("/dashboard", { params: { year: d.getFullYear(), month: d.getMonth() + 1 } })
      .then(r => setData(r.data));
  }, []);

  if (!data) return <div>Carregando...</div>;
  const b = data.budget;

  return (
    <div className="space-y-6" data-testid="budget-page">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Orçamento Mensal</h1>
        <p className="text-[#6B7068]">Divisão automática baseada na sua receita do mês</p>
      </div>

      <div className="card-soft">
        <div className="text-sm text-[#6B7068]">Receita do mês</div>
        <div className="text-4xl font-semibold mt-1" style={{ fontFamily: "Outfit" }} data-testid="budget-income">
          {fmtMoney(b.income, curr)}
        </div>
        {b.income === 0 && (
          <div className="mt-3 text-sm text-amber-700 bg-amber-50 p-3 rounded-lg">
            Cadastre uma receita em Lançamentos para ver a divisão automática.
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
        <h3 className="text-lg font-semibold mb-3" style={{ fontFamily: "Outfit" }}>Como funciona?</h3>
        <ul className="text-sm text-[#6B7068] space-y-2 list-disc pl-5">
          <li><strong>50% Necessidades</strong>: moradia, contas fixas, mercado, transporte essencial.</li>
          <li><strong>20% Reserva / Investimentos</strong>: poupança, fundos, aplicações.</li>
          <li><strong>10% Lazer</strong>: restaurantes, entretenimento, viagens curtas.</li>
          <li><strong>10% Educação</strong>: cursos, livros, formação.</li>
          <li><strong>10% Outros objetivos</strong>: metas pessoais, presentes, doações.</li>
        </ul>
      </div>
    </div>
  );
}
