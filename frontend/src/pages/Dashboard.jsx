import { useEffect, useState } from "react";
import api from "@/lib/api";
import { fmtMoney } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  TrendingUp, TrendingDown, Wallet, Clock, HandCoins, CreditCard
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend
} from "recharts";

const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  useEffect(() => {
    api.get("/dashboard", { params: period }).then(r => setData(r.data));
  }, [period.year, period.month]);

  const curr = user?.currency || "EUR";

  if (!data) return <div className="text-[#6B7068]">Carregando painel...</div>;

  const stats = [
    { label: "Receita do mês", value: data.income, icon: TrendingUp, accent: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Despesa do mês", value: data.expense, icon: TrendingDown, accent: "text-rose-600", bg: "bg-rose-50" },
    { label: "Saldo atual", value: data.balance, icon: Wallet, accent: "text-[#1E3F33]", bg: "bg-[#F1EFE7]" },
    { label: "Contas pendentes", value: data.pending_payable, icon: Clock, accent: "text-amber-700", bg: "bg-amber-50" },
    { label: "A receber", value: data.receivable_total, icon: HandCoins, accent: "text-blue-600", bg: "bg-blue-50" },
    { label: "Parcelas futuras", value: data.future_installments_total, icon: CreditCard, accent: "text-[#D96C5B]", bg: "bg-orange-50" },
  ];

  return (
    <div className="space-y-6" data-testid="dashboard-root">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>
            Olá, {user?.name?.split(" ")[0]}
          </h1>
          <p className="text-[#6B7068] mt-1">
            {months[period.month - 1]} de {period.year}
          </p>
        </div>
        <div className="flex gap-2">
          <select value={period.month} onChange={(e) => setPeriod({ ...period, month: +e.target.value })}
            data-testid="dashboard-month-select"
            className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
            {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={period.year} onChange={(e) => setPeriod({ ...period, year: +e.target.value })}
            data-testid="dashboard-year-select"
            className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
            {[period.year - 1, period.year, period.year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Hero balance */}
      <div className="card-soft bg-gradient-to-br from-[#1E3F33] to-[#2C5C4A] text-white border-transparent">
        <div className="text-sm uppercase tracking-wide opacity-80">Saldo atual</div>
        <div className="text-5xl font-semibold tracking-tight mt-2" style={{ fontFamily: "Outfit" }}
          data-testid="dashboard-balance">
          {fmtMoney(data.balance, curr)}
        </div>
        <div className="mt-3 flex gap-6 text-sm">
          <span>Receita: <strong>{fmtMoney(data.income, curr)}</strong></span>
          <span>Despesa: <strong>{fmtMoney(data.expense, curr)}</strong></span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="card-soft" data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center ${s.accent} mb-3`}>
              <s.icon size={18} />
            </div>
            <div className="stat-label">{s.label}</div>
            <div className={`stat-value mt-1 ${s.accent}`}>{fmtMoney(s.value, curr)}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card-soft lg:col-span-2">
          <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "Outfit" }}>Evolução (6 meses)</h3>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={data.evolution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E4E0" />
                <XAxis dataKey="month" stroke="#6B7068" fontSize={12} />
                <YAxis stroke="#6B7068" fontSize={12} />
                <Tooltip formatter={(v) => fmtMoney(v, curr)} />
                <Legend />
                <Line type="monotone" dataKey="income" name="Receita" stroke="#2C7A51" strokeWidth={2} />
                <Line type="monotone" dataKey="expense" name="Despesa" stroke="#D9453B" strokeWidth={2} />
                <Line type="monotone" dataKey="balance" name="Saldo" stroke="#1E3F33" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-soft">
          <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "Outfit" }}>Gastos por categoria</h3>
          {data.category_breakdown.length === 0 ? (
            <div className="text-sm text-[#6B7068] py-12 text-center">Sem despesas neste período</div>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data.category_breakdown} dataKey="amount" nameKey="category"
                    innerRadius={50} outerRadius={90}>
                    {data.category_breakdown.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => fmtMoney(v, curr)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Budget */}
      <div className="card-soft">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>Orçamento 50/20/10/10/10</h3>
          <div className="text-sm text-[#6B7068]">Base: {fmtMoney(data.budget.income, curr)}</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {data.budget.rules.map((r, i) => (
            <div key={i} className="border border-[#E5E4E0] rounded-xl p-4">
              <div className="text-xs text-[#6B7068]">{r.label}</div>
              <div className="text-xl font-semibold mt-1" style={{ fontFamily: "Outfit" }}>{fmtMoney(r.amount, curr)}</div>
              <div className="mt-2 h-2 bg-[#F1EFE7] rounded-full overflow-hidden">
                <div className="h-full rounded-full"
                  style={{ width: `${r.percent}%`, backgroundColor: ["#1E3F33","#D96C5B","#E5A83B","#7EA193","#C7BCA1"][i] }} />
              </div>
              <div className="text-xs text-[#6B7068] mt-1">{r.percent}%</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
