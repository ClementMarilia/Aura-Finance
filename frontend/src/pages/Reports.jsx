import { useEffect, useState } from "react";
import api, { fmtMoney } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { exportCSV, exportPDF } from "@/lib/exporters";
import { FileDown, FileText, TrendingUp, TrendingDown } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend
} from "recharts";

const MONTH = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function DeltaCard({ label, value, prev, curr, invert }) {
  const diff = value - prev;
  const pct = prev !== 0 ? Math.round(Math.abs(diff) / Math.abs(prev) * 100) : (value !== 0 ? 100 : 0);
  const up = diff > 0;
  // invert=true means "up is bad" (expenses)
  const good = invert ? !up : up;
  const neutral = diff === 0;
  return (
    <div className="card-soft hover:shadow-md hover:-translate-y-0.5 transition-[box-shadow,transform] duration-200">
      <div className="stat-label">{label}</div>
      <div className="text-3xl md:text-4xl font-light tracking-tight tabular-nums mt-2" style={{ fontFamily: "Outfit" }}>
        {fmtMoney(value, curr)}
      </div>
      {neutral ? (
        <div className="mt-3 text-xs text-[#6B7068]">igual ao ano anterior</div>
      ) : (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
            {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {pct}%
          </span>
          <span className="text-xs text-[#6B7068]">vs {fmtMoney(prev, curr)} no ano anterior</span>
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/reports/annual", { params: { year } }).then(r => setData(r.data));
  }, [year]);

  if (!data) return <div>Carregando...</div>;

  const chartData = data.months.map((m, i) => ({
    name: MONTH[m.month - 1],
    income: m.income,
    expense: m.expense,
    prevExpense: data.prev_months[i]?.expense || 0,
  }));
  const t = data.totals;
  const pt = data.prev_totals;

  const csvRows = data.months.map(m => [
    MONTH[m.month - 1], m.income, m.expense, m.balance,
    data.prev_months[m.month - 1]?.expense || 0,
  ]);

  const handleCSV = () => exportCSV(
    `relatorio_${year}.csv`,
    ["Mês", `Receita ${year}`, `Despesa ${year}`, `Saldo ${year}`, `Despesa ${data.prev_year}`],
    csvRows,
  );

  const handlePDF = () => exportPDF(
    `Relatório Anual ${year}`,
    `Comparativo com ${data.prev_year} — gerado para ${user?.name}`,
    ["Mês", "Receita", "Despesa", "Saldo"],
    data.months.map(m => [MONTH[m.month - 1], fmtMoney(m.income, curr), fmtMoney(m.expense, curr), fmtMoney(m.balance, curr)]),
    ["Total", fmtMoney(t.income, curr), fmtMoney(t.expense, curr), fmtMoney(t.balance, curr)],
  );

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Relatórios</h1>
          <p className="text-[#6B7068]">Histórico anual e comparativo com {data.prev_year}</p>
        </div>
        <div className="flex gap-2 items-center">
          <Button variant="outline" onClick={handleCSV} data-testid="export-csv-btn" className="rounded-xl">
            <FileDown size={16} className="mr-1" /> CSV
          </Button>
          <Button variant="outline" onClick={handlePDF} data-testid="export-pdf-btn" className="rounded-xl">
            <FileText size={16} className="mr-1" /> PDF
          </Button>
          <select value={year} onChange={e => setYear(+e.target.value)} data-testid="reports-year-select"
            className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
            {[year - 2, year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DeltaCard label="Receita anual" value={t.income} prev={pt.income} curr={curr} />
        <DeltaCard label="Despesa anual" value={t.expense} prev={pt.expense} curr={curr} invert />
        <DeltaCard label="Saldo anual" value={t.balance} prev={pt.balance} curr={curr} />
      </div>

      <div className="card-soft">
        <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "Outfit" }}>
          Receita vs Despesa por mês <span className="text-sm font-normal text-[#6B7068]">(vs despesa {data.prev_year})</span>
        </h3>
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
              <Bar dataKey="prevExpense" name={`Despesa ${data.prev_year}`} fill="#C7BCA1" radius={[6, 6, 0, 0]} />
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
          <tfoot>
            <tr className="bg-[#F1EFE7] font-semibold">
              <td className="py-3 px-4">Total</td>
              <td className="py-3 px-4 text-right text-emerald-600">{fmtMoney(t.income, curr)}</td>
              <td className="py-3 px-4 text-right text-rose-600">{fmtMoney(t.expense, curr)}</td>
              <td className="py-3 px-4 text-right text-[#1E3F33]">{fmtMoney(t.balance, curr)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
