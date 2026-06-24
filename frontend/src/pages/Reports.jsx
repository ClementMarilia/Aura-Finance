import { useEffect, useState } from "react";
import api, { fmtMoney } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend
} from "recharts";

const MONTH = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

export default function Reports() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/reports/annual", { params: { year } }).then(r => setData(r.data));
  }, [year]);

  if (!data) return <div>Carregando...</div>;

  const chartData = data.months.map(m => ({ ...m, name: MONTH[m.month - 1] }));
  const totalInc = data.months.reduce((s, m) => s + m.income, 0);
  const totalExp = data.months.reduce((s, m) => s + m.expense, 0);

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Relatórios</h1>
          <p className="text-[#6B7068]">Histórico anual</p>
        </div>
        <select value={year} onChange={e => setYear(+e.target.value)} data-testid="reports-year-select"
          className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
          {[year - 2, year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card-soft">
          <div className="text-sm text-[#6B7068]">Receita anual</div>
          <div className="text-3xl font-semibold text-emerald-600 mt-1" style={{ fontFamily: "Outfit" }} data-testid="report-total-income">
            {fmtMoney(totalInc, curr)}
          </div>
        </div>
        <div className="card-soft">
          <div className="text-sm text-[#6B7068]">Despesa anual</div>
          <div className="text-3xl font-semibold text-rose-600 mt-1" style={{ fontFamily: "Outfit" }} data-testid="report-total-expense">
            {fmtMoney(totalExp, curr)}
          </div>
        </div>
        <div className="card-soft">
          <div className="text-sm text-[#6B7068]">Saldo anual</div>
          <div className="text-3xl font-semibold text-[#1E3F33] mt-1" style={{ fontFamily: "Outfit" }} data-testid="report-total-balance">
            {fmtMoney(totalInc - totalExp, curr)}
          </div>
        </div>
      </div>

      <div className="card-soft">
        <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "Outfit" }}>Receita vs Despesa por mês</h3>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E4E0" />
              <XAxis dataKey="name" stroke="#6B7068" fontSize={12} />
              <YAxis stroke="#6B7068" fontSize={12} />
              <Tooltip formatter={(v) => fmtMoney(v, curr)} />
              <Legend />
              <Bar dataKey="income" name="Receita" fill="#2C7A51" radius={[6, 6, 0, 0]} />
              <Bar dataKey="expense" name="Despesa" fill="#D9453B" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card-soft overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-[#F1EFE7] text-[#6B7068]">
            <tr>
              <th className="text-left py-3 px-4">Mês</th>
              <th className="text-right py-3 px-4">Receita</th>
              <th className="text-right py-3 px-4">Despesa</th>
              <th className="text-right py-3 px-4">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map(m => (
              <tr key={m.month} className="border-b border-[#E5E4E0]">
                <td className="py-3 px-4 font-medium">{MONTH[m.month - 1]}</td>
                <td className="py-3 px-4 text-right text-emerald-600">{fmtMoney(m.income, curr)}</td>
                <td className="py-3 px-4 text-right text-rose-600">{fmtMoney(m.expense, curr)}</td>
                <td className={`py-3 px-4 text-right font-semibold ${m.balance >= 0 ? "text-[#1E3F33]" : "text-rose-600"}`}>
                  {fmtMoney(m.balance, curr)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
