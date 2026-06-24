import { useEffect, useState } from "react";
import api, { fmtMoney, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Check } from "lucide-react";
import { toast } from "sonner";

function Initials({ name, color, size = 32 }) {
  const initials = (name || "?").split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="rounded-full flex items-center justify-center text-white text-xs font-medium"
      style={{ width: size, height: size, backgroundColor: color || "#1E3F33" }}>
      {initials}
    </div>
  );
}

export default function Settlements() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [data, setData] = useState({ rows: [], summary: [] });

  const load = () => api.get("/settlements").then(r => setData(r.data));
  useEffect(() => { load(); }, []);

  const settleAll = async (otherUserId, name) => {
    if (!window.confirm(`Marcar TODAS as dívidas pendentes entre você e ${name} como pagas?`)) return;
    const r = await api.post(`/settlements/settle-between/${otherUserId}`);
    toast.success(`${r.data.expenses_updated} despesa(s) quitada(s)`);
    load();
  };

  const markPaid = async (row) => {
    await api.post(`/shared-expenses/${row.expense_id}/settle/${row.debtor_id}`);
    toast.success("Acerto registrado");
    load();
  };

  return (
    <div className="space-y-6" data-testid="settlements-page">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Acertos</h1>
        <p className="text-[#6B7068]">Quem deve pagar, para quem, e quanto</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.summary.length === 0 && <div className="card-soft md:col-span-3 text-center text-[#6B7068]">Tudo certo! Sem acertos pendentes.</div>}
        {data.summary.map((s, i) => (
          <div key={i} className="card-soft" data-testid={`summary-${s.user?.id}`}>
            <div className="flex items-center gap-3">
              <Initials name={s.user?.name} color={s.user?.avatar_color} size={40} />
              <div>
                <div className="font-medium">{s.user?.name}</div>
                <div className="text-xs text-[#6B7068]">{s.user?.email}</div>
              </div>
            </div>
            <div className="mt-4">
              {s.net > 0 ? (
                <>
                  <div className="text-sm text-[#6B7068]">Te deve</div>
                  <div className="text-2xl font-semibold text-emerald-600" style={{ fontFamily: "Outfit" }}>{fmtMoney(s.net, curr)}</div>
                </>
              ) : (
                <>
                  <div className="text-sm text-[#6B7068]">Você deve</div>
                  <div className="text-2xl font-semibold text-rose-600" style={{ fontFamily: "Outfit" }}>{fmtMoney(Math.abs(s.net), curr)}</div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="card-soft">
        <h3 className="text-lg font-semibold mb-3" style={{ fontFamily: "Outfit" }}>Acertos simplificados</h3>
        <p className="text-xs text-[#6B7068] mb-4">Cálculo otimizado: menor número possível de transferências para zerar todas as dívidas.</p>
        {(!data.transfers || data.transfers.length === 0) && (
          <div className="text-sm text-[#6B7068] py-4 text-center">Nenhum acerto pendente.</div>
        )}
        <div className="space-y-2">
          {(data.transfers || []).map((t, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-[#F1EFE7]" data-testid={`transfer-${i}`}>
              <div className="flex items-center gap-3 text-sm">
                <Initials name={t.debtor?.name} color={t.debtor?.avatar_color} size={28} />
                <span className="font-medium">{t.debtor?.name}</span>
                <span className="text-[#6B7068]">paga</span>
                <span className="font-semibold text-[#1E3F33]">{fmtMoney(t.amount, curr)}</span>
                <span className="text-[#6B7068]">para</span>
                <Initials name={t.creditor?.name} color={t.creditor?.avatar_color} size={28} />
                <span className="font-medium">{t.creditor?.name}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card-soft overflow-x-auto p-0">
        <h3 className="text-lg font-semibold p-4 pb-2" style={{ fontFamily: "Outfit" }}>Lançamentos pendentes</h3>
        <table className="w-full text-sm">
          <thead className="bg-[#F1EFE7] text-[#6B7068]">
            <tr>
              <th className="text-left py-3 px-4">Devedor</th>
              <th className="text-left py-3 px-4">Para</th>
              <th className="text-left py-3 px-4">Despesa</th>
              <th className="text-left py-3 px-4">Data</th>
              <th className="text-right py-3 px-4">Valor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-[#6B7068]">Nenhum acerto pendente</td></tr>}
            {data.rows.map((r, i) => (
              <tr key={i} className="border-b border-[#E5E4E0]" data-testid={`row-settlement-${i}`}>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <Initials name={r.debtor?.name} color={r.debtor?.avatar_color} size={24} />
                    <span>{r.debtor?.name}</span>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <Initials name={r.creditor?.name} color={r.creditor?.avatar_color} size={24} />
                    <span>{r.creditor?.name}</span>
                  </div>
                </td>
                <td className="py-3 px-4">{r.title}</td>
                <td className="py-3 px-4">{fmtDate(r.date)}</td>
                <td className="py-3 px-4 text-right font-semibold">{fmtMoney(r.amount, curr)}</td>
                <td className="py-3 px-4">
                  {(r.debtor_id === user.id || r.creditor_id === user.id) && (
                    <button onClick={() => markPaid(r)} data-testid={`mark-paid-${i}`}
                      className="px-3 py-1.5 rounded-lg text-xs bg-[#1E3F33] text-white hover:bg-[#2C5C4A] flex items-center gap-1">
                      <Check size={12} /> Marcar pago
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
