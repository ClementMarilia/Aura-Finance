import { useEffect, useState } from "react";
import api, { fmtMoney, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Check, Bell, History as HistoryIcon } from "lucide-react";
import { toast } from "sonner";

import { translate as tr } from "@/i18n";
function Initials({ name, color, size = 32 }) {
  const initials = (name || "?").split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="rounded-full flex items-center justify-center text-white text-xs font-medium"
      style={{ width: size, height: size, backgroundColor: color || "#061B4A" }}>
      {initials}
    </div>
  );
}

export default function Settlements() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [data, setData] = useState({ rows: [], summary: [] });
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState("open");

  const load = () => api.get("/settlements").then(r => setData(r.data));
  const loadHistory = () => api.get("/settlements/history").then(r => setHistory(r.data));
  useEffect(() => { load(); loadHistory(); }, []);

  const nudge = async (uid, name) => {
    try {
      const r = await api.post(`/settlements/nudge/${uid}`);
      toast.success(tr("Lembrete enviado para {name} ({amount})", { name, amount: fmtMoney(r.data.amount, curr) }));
    } catch (err) { toast.error(err?.response?.data?.detail || "Erro"); }
  };

  const settleAll = async (otherUserId, name) => {
    if (!window.confirm(tr("Marcar TODAS as dívidas pendentes entre você e {name} como pagas?", { name }))) return;
    const r = await api.post(`/settlements/settle-between/${otherUserId}`);
    toast.success(`${r.data.expenses_updated} despesa(s) quitada(s)`);
    load();
    loadHistory();
  };

  const markPaid = async (row) => {
    await api.post(`/shared-expenses/${row.expense_id}/settle/${row.debtor_id}`);
    toast.success(tr("Acerto registrado"));
    load();
    loadHistory();
  };

  return (
    <div className="space-y-6" data-testid="settlements-page">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>{tr("Acertos")}</h1>
        <p className="text-[#6B7068]">{tr("Quem deve pagar, para quem, e quanto")}</p>
      </div>

      <div className="flex gap-2 border-b border-[#E5E4E0]">
        <button onClick={() => setTab("open")} data-testid="tab-open"
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === "open" ? "border-[#061B4A] text-[#061B4A]" : "border-transparent text-[#6B7068] hover:text-[#061B4A]"}`}>
          <Check size={16} /> {tr("Pendentes")}
        </button>
        <button onClick={() => setTab("history")} data-testid="tab-history"
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === "history" ? "border-[#061B4A] text-[#061B4A]" : "border-transparent text-[#6B7068] hover:text-[#061B4A]"}`}>
          <HistoryIcon size={16} /> {tr("Histórico")}
        </button>
      </div>

      {tab === "open" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.summary.length === 0 && <div className="card-soft md:col-span-3 text-center text-[#6B7068]">{tr("Tudo certo! Sem acertos pendentes.")}</div>}
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
                      <div className="text-sm text-[#6B7068]">{tr("Te deve")}</div>
                      <div className="text-2xl font-semibold text-emerald-600" style={{ fontFamily: "Outfit" }}>{fmtMoney(s.net, curr)}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm text-[#6B7068]">{tr("Você deve")}</div>
                      <div className="text-2xl font-semibold text-rose-600" style={{ fontFamily: "Outfit" }}>{fmtMoney(Math.abs(s.net), curr)}</div>
                    </>
                  )}
                </div>
                <div className="mt-4 flex gap-2">
                  {s.net > 0 && (
                    <button onClick={() => nudge(s.user?.id, s.user?.name)} data-testid={`nudge-${s.user?.id}`}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs border border-[#061B4A] text-[#061B4A] hover:bg-[#061B4A] hover:text-white flex items-center justify-center gap-1 transition-colors">
                      <Bell size={12} /> {tr("Cutucar")}
                    </button>
                  )}
                  <button onClick={() => settleAll(s.user?.id, s.user?.name)} data-testid={`settle-all-${s.user?.id}`}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-[#061B4A] text-white hover:bg-[#1268F4] flex items-center justify-center gap-1 transition-colors">
                    <Check size={12} /> {tr("Quitar tudo")}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="card-soft">
            <h3 className="text-lg font-semibold mb-3" style={{ fontFamily: "Outfit" }}>{tr("Acertos simplificados")}</h3>
            <p className="text-xs text-[#6B7068] mb-4">{tr("Cálculo otimizado: menor número possível de transferências para zerar todas as dívidas.")}</p>
            {(!data.transfers || data.transfers.length === 0) && (
              <div className="text-sm text-[#6B7068] py-4 text-center">{tr("Nenhum acerto pendente.")}</div>
            )}
            <div className="space-y-2">
              {(data.transfers || []).map((t, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-[#F1EFE7]" data-testid={`transfer-${i}`}>
                  <div className="flex items-center gap-3 text-sm">
                    <Initials name={t.debtor?.name} color={t.debtor?.avatar_color} size={28} />
                    <span className="font-medium">{t.debtor?.name}</span>
                    <span className="text-[#6B7068]">paga</span>
                    <span className="font-semibold text-[#061B4A]">{fmtMoney(t.amount, curr)}</span>
                    <span className="text-[#6B7068]">para</span>
                    <Initials name={t.creditor?.name} color={t.creditor?.avatar_color} size={28} />
                    <span className="font-medium">{t.creditor?.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card-soft overflow-x-auto p-0">
            <h3 className="text-lg font-semibold p-4 pb-2" style={{ fontFamily: "Outfit" }}>{tr("Lançamentos pendentes")}</h3>
            <table className="w-full text-sm">
              <thead className="bg-[#F1EFE7] text-[#6B7068]">
                <tr>
                  <th className="text-left py-3 px-4">{tr("Devedor")}</th>
                  <th className="text-left py-3 px-4">Para</th>
                  <th className="text-left py-3 px-4">{tr("Despesa")}</th>
                  <th className="text-left py-3 px-4">{tr("Data")}</th>
                  <th className="text-right py-3 px-4">{tr("Valor")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-[#6B7068]">{tr("Nenhum acerto pendente")}</td></tr>}
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
                          className="px-3 py-1.5 rounded-lg text-xs bg-[#061B4A] text-white hover:bg-[#1268F4] flex items-center gap-1">
                          <Check size={12} /> {tr("Marcar pago")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "history" && (
        <div className="card-soft overflow-x-auto p-0" data-testid="history-section">
          <h3 className="text-lg font-semibold p-4 pb-2" style={{ fontFamily: "Outfit" }}>{tr("Histórico de acertos")}</h3>
          <table className="w-full text-sm">
            <thead className="bg-[#F1EFE7] text-[#6B7068]">
              <tr>
                <th className="text-left py-3 px-4">De</th>
                <th className="text-left py-3 px-4">Para</th>
                <th className="text-left py-3 px-4">{tr("Despesa")}</th>
                <th className="text-left py-3 px-4">{tr("Quitado em")}</th>
                <th className="text-right py-3 px-4">{tr("Valor")}</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-[#6B7068]">{tr("Nenhum acerto registrado ainda")}</td></tr>}
              {history.map((h, i) => (
                <tr key={i} className="border-b border-[#E5E4E0]" data-testid={`history-row-${i}`}>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Initials name={h.debtor?.name} color={h.debtor?.avatar_color} size={24} />
                      <span>{h.debtor?.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Initials name={h.creditor?.name} color={h.creditor?.avatar_color} size={24} />
                      <span>{h.creditor?.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">{h.expense_title || "—"}</td>
                  <td className="py-3 px-4">{fmtDate(h.paid_at)}</td>
                  <td className="py-3 px-4 text-right font-semibold text-emerald-600">{fmtMoney(h.amount, curr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
