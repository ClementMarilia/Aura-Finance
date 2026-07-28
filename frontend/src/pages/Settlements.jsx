import { useCallback, useEffect, useState } from "react";
import api, { CURRENCIES, fmtMoney, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, Bell, History as HistoryIcon, Search, X } from "lucide-react";
import { toast } from "sonner";

import { translate as tr } from "@/i18n";

const emptyHistoryFilters = {
  search: "",
  period: "all",
  specificDate: "",
  month: "",
  year: "",
  startDate: "",
  endDate: "",
  sort: "recent",
  currency: "",
};

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
  const [historyFilters, setHistoryFilters] = useState(emptyHistoryFilters);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [tab, setTab] = useState("open");

  const load = () => api.get("/settlements").then(r => setData(r.data));
  const loadHistory = useCallback(async (filters = emptyHistoryFilters) => {
    const params = { search: filters.search.trim() || undefined, sort: filters.sort };
    if (filters.currency) params.currency = filters.currency;
    if (filters.period === "date") params.specific_date = filters.specificDate || undefined;
    if (filters.period === "month") params.month = filters.month || undefined;
    if (filters.period === "year") params.year = filters.year || undefined;
    if (filters.period === "range") {
      params.start_date = filters.startDate || undefined;
      params.end_date = filters.endDate || undefined;
    }
    setHistoryLoading(true);
    try {
      const response = await api.get("/settlements/history", { params });
      setHistory(response.data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || tr("Não foi possível carregar o histórico."));
    } finally {
      setHistoryLoading(false);
    }
  }, []);
  useEffect(() => { load(); loadHistory(); }, [loadHistory]);

  const updateHistoryFilter = (field, value) => {
    setHistoryFilters(current => ({ ...current, [field]: value }));
  };

  const applyHistoryFilters = (event) => {
    event.preventDefault();
    loadHistory(historyFilters);
  };

  const clearHistoryFilters = () => {
    setHistoryFilters(emptyHistoryFilters);
    loadHistory(emptyHistoryFilters);
  };

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
    loadHistory(historyFilters);
  };

  const markPaid = async (row) => {
    await api.post(`/shared-expenses/${row.expense_id}/settle/${row.debtor_id}`);
    toast.success(tr("Acerto registrado"));
    load();
    loadHistory(historyFilters);
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
                    <div className="text-xs text-[#6B7068]">
                      {s.user?.external ? tr("Pessoa externa") : s.user?.email}
                    </div>
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
                  {s.net > 0 && !s.user?.external && (
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
                      {(r.debtor_id === user.id || r.creditor_id === user.id || r.managed_by_user) && (
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
        <div className="space-y-4" data-testid="history-section">
          <form onSubmit={applyHistoryFilters} className="card-soft space-y-3" data-testid="history-filters">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="relative md:col-span-2">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7068]" />
                <Input
                  value={historyFilters.search}
                  onChange={event => updateHistoryFilter("search", event.target.value)}
                  placeholder={tr("Buscar por pessoa, despesa, categoria ou observação")}
                  className="pl-9"
                  data-testid="history-search"
                />
              </div>
              <Select value={historyFilters.period} onValueChange={value => updateHistoryFilter("period", value)}>
                <SelectTrigger data-testid="history-period"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tr("Todo o período")}</SelectItem>
                  <SelectItem value="date">{tr("Data específica")}</SelectItem>
                  <SelectItem value="month">{tr("Mês")}</SelectItem>
                  <SelectItem value="year">{tr("Ano")}</SelectItem>
                  <SelectItem value="range">{tr("Intervalo de datas")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={historyFilters.sort} onValueChange={value => updateHistoryFilter("sort", value)}>
                <SelectTrigger data-testid="history-sort"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">{tr("Mais recentes primeiro")}</SelectItem>
                  <SelectItem value="oldest">{tr("Mais antigos primeiro")}</SelectItem>
                  <SelectItem value="amount_desc">{tr("Maior valor")}</SelectItem>
                  <SelectItem value="amount_asc">{tr("Menor valor")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={historyFilters.currency || "all"} onValueChange={value => updateHistoryFilter("currency", value === "all" ? "" : value)}>
                <SelectTrigger data-testid="history-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tr("Todas as moedas")}</SelectItem>
                  {CURRENCIES.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {historyFilters.period === "date" && (
              <Input
                type="date"
                value={historyFilters.specificDate}
                onChange={event => updateHistoryFilter("specificDate", event.target.value)}
                className="max-w-xs"
                data-testid="history-specific-date"
              />
            )}
            {historyFilters.period === "month" && (
              <Input
                type="month"
                value={historyFilters.month}
                onChange={event => updateHistoryFilter("month", event.target.value)}
                className="max-w-xs"
                data-testid="history-month"
              />
            )}
            {historyFilters.period === "year" && (
              <Input
                type="number"
                min="1900"
                max="2200"
                value={historyFilters.year}
                onChange={event => updateHistoryFilter("year", event.target.value)}
                placeholder={tr("Ano")}
                className="max-w-xs"
                data-testid="history-year"
              />
            )}
            {historyFilters.period === "range" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
                <Input
                  type="date"
                  value={historyFilters.startDate}
                  onChange={event => updateHistoryFilter("startDate", event.target.value)}
                  aria-label={tr("Data inicial")}
                  data-testid="history-start-date"
                />
                <Input
                  type="date"
                  value={historyFilters.endDate}
                  onChange={event => updateHistoryFilter("endDate", event.target.value)}
                  aria-label={tr("Data final")}
                  data-testid="history-end-date"
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={clearHistoryFilters}
                className="px-4 py-2 rounded-xl text-sm border border-[#E5E4E0] text-[#6B7068] hover:bg-[#F1EFE7] flex items-center gap-2"
                data-testid="history-clear"
              >
                <X size={14} /> {tr("Limpar filtros")}
              </button>
              <button
                type="submit"
                disabled={historyLoading}
                className="px-4 py-2 rounded-xl text-sm bg-[#061B4A] text-white hover:bg-[#1268F4] disabled:opacity-60 flex items-center gap-2"
                data-testid="history-apply"
              >
                <Search size={14} /> {historyLoading ? tr("Buscando...") : tr("Aplicar filtros")}
              </button>
            </div>
          </form>

          <div className="card-soft overflow-x-auto p-0">
            <div className="p-4 pb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>{tr("Histórico de acertos")}</h3>
              <span className="text-xs text-[#6B7068]">{tr("{count} resultado(s)", { count: history.length })}</span>
            </div>
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
                {!historyLoading && history.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-[#6B7068]">{tr("Nenhum acerto encontrado")}</td></tr>}
                {history.map((h, i) => (
                  <tr key={h.id || `${h.expense_id}-${h.debtor_id}-${i}`} className="border-b border-[#E5E4E0]" data-testid={`history-row-${i}`}>
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
                    <td className="py-3 px-4">
                      <div>{h.expense_title || "—"}</div>
                      {(h.category || h.notes) && (
                        <div className="text-xs text-[#6B7068] mt-0.5">
                          {[h.category, h.notes].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">{fmtDate(h.paid_at)}</td>
                    <td className="py-3 px-4 text-right font-semibold text-emerald-600">{fmtMoney(h.amount, h.currency || curr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
