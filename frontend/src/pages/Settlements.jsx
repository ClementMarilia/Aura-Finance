import { useCallback, useEffect, useState } from "react";
import api, { CURRENCIES, fmtMoney, fmtDate, formatApiError, postCreate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import AmountInput from "@/components/AmountInput";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, Bell, History as HistoryIcon, Search, X, Wallet, Clock, Ban, ArrowRight, SlidersHorizontal, ChevronDown } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useIsDesktop } from "@/hooks/useMediaQuery";
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
  const [accounts, setAccounts] = useState([]);
  const [paymentDialog, setPaymentDialog] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [closeDialog, setCloseDialog] = useState(null);
  const [closeReason, setCloseReason] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(false);
  const isDesktop = useIsDesktop();

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
  useEffect(() => {
    load();
    loadHistory();
    api.get("/accounts").then(response => setAccounts(response.data));
  }, [loadHistory]);

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
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const openWalletDialog = (mode, row) => {
    setPaymentDialog({ mode, row });
    setSelectedAccountId("");
    setPaymentAmount(
      mode === "send" ? String(row.settlement_amount || "") : "",
    );
  };

  const closeWalletDialog = () => {
    if (paymentBusy) return;
    setPaymentDialog(null);
    setSelectedAccountId("");
    setPaymentAmount("");
  };

  const submitWalletAction = async () => {
    if (!paymentDialog || paymentBusy) return;
    const amount = Number(paymentAmount);
    if (
      paymentDialog.mode === "send"
      && (!selectedAccountId || !Number.isFinite(amount) || amount <= 0)
    ) return;
    setPaymentBusy(true);
    try {
      if (paymentDialog.mode === "send") {
        await postCreate("/settlements/payments", {
          expense_id: paymentDialog.row.expense_id,
          account_id: selectedAccountId,
          amount,
        });
        toast.success(tr("Pagamento registrado. Aguardando confirmação."));
      } else {
        await api.post(
          `/settlements/payments/${paymentDialog.row.payment.id}/confirm`,
          { account_id: selectedAccountId },
        );
        toast.success(tr("Recebimento confirmado"));
      }
      setPaymentDialog(null);
      setSelectedAccountId("");
      setPaymentAmount("");
      await Promise.all([load(), loadHistory(historyFilters)]);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setPaymentBusy(false);
    }
  };

  // Cancel / reject used window.confirm + window.prompt, which render as
  // browser pop-ups (and are blocked in some installed PWAs).
  const closePayment = (row, action) => {
    setCloseReason("");
    setCloseDialog({ row, action });
  };

  const submitClosePayment = async () => {
    if (!closeDialog || closeBusy) return;
    const { row, action } = closeDialog;
    setCloseBusy(true);
    try {
      await api.post(
        `/settlements/payments/${row.payment.id}/${action}`,
        { reason: closeReason },
      );
      toast.success(
        action === "cancel"
          ? tr("Pagamento cancelado com reversão registrada")
          : tr("Pagamento colocado em contestação"),
      );
      setCloseDialog(null);
      await load();
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setCloseBusy(false);
    }
  };

  const confirmExternalPayment = async (row) => {
    try {
      await api.post(`/shared-expenses/${row.expense_id}/settle/${row.debtor_id}`);
      toast.success(tr("Acerto registrado"));
      await Promise.all([load(), loadHistory(historyFilters)]);
    } catch (error) {
      toast.error(formatApiError(error));
    }
  };

  const primaryAction = "min-h-[40px] px-3 py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5";

  const renderRowActions = (r, i) => (
    <>
      {!r.payment && r.external_debtor && r.managed_by_user && (
        <button onClick={() => confirmExternalPayment(r)} data-testid={`confirm-external-${i}`}
          className={`${primaryAction} bg-[#061B4A] text-white hover:bg-[#1268F4]`}>
          <Check size={14} /> {tr("Confirmar manualmente")}
        </button>
      )}
      {!r.payment && !r.external_debtor && r.debtor_id === user.id && (
        <button onClick={() => openWalletDialog("send", r)} data-testid={`send-payment-${i}`}
          className={`${primaryAction} bg-[#061B4A] text-white hover:bg-[#1268F4]`}>
          <Wallet size={14} /> {tr("Registrar pagamento")}
        </button>
      )}
      {!r.payment && !r.external_debtor && r.creditor_id === user.id && (
        <span className="text-xs text-[#6B7068] flex items-center gap-1"><Clock size={12} /> {tr("Aguardando pagamento")}</span>
      )}
      {r.payment?.status === "sent" && r.payment.is_sender && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-amber-700 flex items-center gap-1">
            <Clock size={12} /> {tr("Aguardando confirmação")}
          </span>
          <button onClick={() => closePayment(r, "cancel")}
            className="min-h-[40px] text-xs font-medium text-rose-600 hover:underline"
            data-testid={`cancel-payment-${i}`}>
            {tr("Cancelar")}
          </button>
        </div>
      )}
      {r.payment?.status === "sent" && r.payment.is_receiver && (
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
          <button onClick={() => openWalletDialog("confirm", r)}
            className={`${primaryAction} bg-emerald-700 text-white hover:bg-emerald-800`}
            data-testid={`confirm-payment-${i}`}>
            <Check size={14} /> {tr("Confirmar recebimento")}
          </button>
          <button onClick={() => closePayment(r, "reject")}
            className={`${primaryAction} border border-rose-200 text-rose-700 hover:bg-rose-50`}
            data-testid={`reject-payment-${i}`}>
            <Ban size={14} /> {tr("Rejeitar")}
          </button>
        </div>
      )}
      {r.payment?.status === "disputed" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-rose-700 flex items-center gap-1">
            <Ban size={12} /> {tr("Pagamento em contestação")}
          </span>
          {r.payment.is_receiver && (
            <button onClick={() => openWalletDialog("confirm", r)}
              className="min-h-[40px] text-xs font-medium text-emerald-700 hover:underline"
              data-testid={`confirm-disputed-payment-${i}`}>
              {tr("Confirmar após verificar")}
            </button>
          )}
          {r.payment.is_sender && (
            <button onClick={() => closePayment(r, "cancel")}
              className="min-h-[40px] text-xs font-medium text-rose-600 hover:underline"
              data-testid={`cancel-disputed-payment-${i}`}>
              {tr("Cancelar registro")}
            </button>
          )}
        </div>
      )}
      {["confirming", "cancelling"].includes(r.payment?.status) && (
        <span className="text-xs text-[#6B7068] flex items-center gap-1">
          <Clock size={12} /> {tr("Processando confirmação...")}
        </span>
      )}
    </>
  );

  // Original amount when the expense was in another currency.
  const originalAmount = (r) => (
    r.settlement_currency && r.settlement_currency !== curr && r.settlement_amount
      ? fmtMoney(r.settlement_amount, r.settlement_currency)
      : null
  );

  const paymentAccounts = accounts.filter(account => (
    (account.currency || curr) === paymentDialog?.row?.settlement_currency
  ));

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
                      className="flex-1 min-h-[40px] px-3 py-2 rounded-xl text-sm border border-[#061B4A] text-[#061B4A] hover:bg-[#061B4A] hover:text-white flex items-center justify-center gap-1.5 transition-colors">
                      <Bell size={12} /> {tr("Cutucar")}
                    </button>
                  )}
                  {s.net < 0 && (
                    <a href="#pending-settlements" className="text-xs font-medium text-[#1268F4] flex items-center gap-1.5 min-h-[32px]">
                      <Wallet size={12} /> {tr("Pague pelos lançamentos abaixo")}
                    </a>
                  )}
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
                <div key={i} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#F1EFE7]" data-testid={`transfer-${i}`}>
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <Initials name={t.debtor?.name} color={t.debtor?.avatar_color} size={28} />
                    <span className="truncate font-medium">{t.debtor?.name}</span>
                    <ArrowRight size={14} className="flex-shrink-0 text-[#6B7068]" aria-label={tr("paga para")} />
                    <Initials name={t.creditor?.name} color={t.creditor?.avatar_color} size={28} />
                    <span className="truncate font-medium">{t.creditor?.name}</span>
                  </div>
                  <span className="whitespace-nowrap font-semibold text-[#061B4A]">{fmtMoney(t.amount, curr)}</span>
                </div>
              ))}
            </div>
          </div>

          {isDesktop ? (
          <div className="card-soft overflow-x-auto p-0" id="pending-settlements">
            <h3 className="text-lg font-semibold p-4 pb-2" style={{ fontFamily: "Outfit" }}>{tr("Lançamentos pendentes")}</h3>
            <table className="w-full text-sm">
              <thead className="bg-[#F1EFE7] text-[#6B7068]">
                <tr>
                  <th className="text-left py-3 px-4">{tr("Devedor")}</th>
                  <th className="text-left py-3 px-4">{tr("Para")}</th>
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
                    <td className="py-3 px-4 text-right font-semibold">
                      {fmtMoney(r.amount, curr)}
                      {originalAmount(r) && <div className="text-xs font-normal text-[#6B7068]">{originalAmount(r)}</div>}
                    </td>
                    <td className="py-3 px-4 min-w-[190px]">
                      {renderRowActions(r, i)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          ) : (
            <div className="space-y-2" id="pending-settlements" data-testid="pending-settlements-list">
              <h3 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>{tr("Lançamentos pendentes")}</h3>
              {data.rows.length === 0 && (
                <div className="card-soft py-10 text-center text-[#6B7068]">{tr("Nenhum acerto pendente")}</div>
              )}
              {data.rows.map((r, i) => (
                <div key={i} className="card-soft p-4 space-y-3" data-testid={`row-settlement-${i}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-[#1A1C1A]">{r.title}</div>
                      <div className="text-xs text-[#6B7068]">{fmtDate(r.date)}</div>
                    </div>
                    <div className="text-right">
                      <div className="whitespace-nowrap font-semibold text-[#1A1C1A]">{fmtMoney(r.amount, curr)}</div>
                      {originalAmount(r) && <div className="text-xs text-[#6B7068]">{originalAmount(r)}</div>}
                    </div>
                  </div>
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <Initials name={r.debtor?.name} color={r.debtor?.avatar_color} size={24} />
                    <span className="truncate">{r.debtor?.name}</span>
                    <ArrowRight size={14} className="flex-shrink-0 text-[#6B7068]" aria-label={tr("paga para")} />
                    <Initials name={r.creditor?.name} color={r.creditor?.avatar_color} size={24} />
                    <span className="truncate">{r.creditor?.name}</span>
                  </div>
                  <div className="[&>button]:w-full">{renderRowActions(r, i)}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "history" && (
        <div className="space-y-4" data-testid="history-section">
          <form onSubmit={applyHistoryFilters} className="card-soft space-y-3" data-testid="history-filters">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="relative flex gap-2 md:col-span-2">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7068]" />
                <Input
                  value={historyFilters.search}
                  onChange={event => updateHistoryFilter("search", event.target.value)}
                  placeholder={tr("Buscar por pessoa, despesa, categoria ou observação")}
                  className="pl-9"
                  data-testid="history-search"
                />
                <button type="button" onClick={() => setHistoryFiltersOpen(value => !value)}
                  aria-expanded={historyFiltersOpen} aria-label={tr("Filtros")} data-testid="history-filters-toggle"
                  className="md:hidden flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[#E5E4E0] text-[#6B7068]">
                  <SlidersHorizontal size={16} />
                </button>
              </div>
              <div className={`${historyFiltersOpen ? "grid" : "hidden"} md:contents grid-cols-1 gap-3`}>
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

            <div className={`${historyFiltersOpen ? "flex" : "hidden"} md:flex flex-wrap gap-2 justify-end`}>
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
            {isDesktop ? (
            <table className="w-full text-sm">
              <thead className="bg-[#F1EFE7] text-[#6B7068]">
                <tr>
                  <th className="text-left py-3 px-4">{tr("De")}</th>
                  <th className="text-left py-3 px-4">{tr("Para")}</th>
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
            ) : (
              <div className="divide-y divide-[#E5E4E0]" data-testid="history-list">
                {!historyLoading && history.length === 0 && (
                  <div className="py-10 text-center text-[#6B7068]">{tr("Nenhum acerto encontrado")}</div>
                )}
                {history.map((h, i) => (
                  <div key={h.id || `${h.expense_id}-${h.debtor_id}-${i}`} className="px-4 py-3" data-testid={`history-row-${i}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[#1A1C1A]">{h.expense_title || "—"}</div>
                        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-[#6B7068]">
                          <span className="truncate">{h.debtor?.name}</span>
                          <ArrowRight size={12} className="flex-shrink-0" aria-label={tr("paga para")} />
                          <span className="truncate">{h.creditor?.name}</span>
                          <span aria-hidden="true">·</span>
                          <span className="whitespace-nowrap">{fmtDate(h.paid_at)}</span>
                        </div>
                      </div>
                      <span className="whitespace-nowrap text-sm font-semibold text-emerald-600">{fmtMoney(h.amount, h.currency || curr)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={Boolean(paymentDialog)} onOpenChange={open => !open && closeWalletDialog()}>
        <DialogContent className="max-w-md" data-testid="settlement-wallet-dialog">
          <DialogHeader>
            <DialogTitle>
              {paymentDialog?.mode === "send"
                ? tr("Registrar pagamento")
                : tr("Confirmar recebimento")}
            </DialogTitle>
          </DialogHeader>
          {paymentDialog && (
            <div className="space-y-4">
              <div className="rounded-xl bg-[#F1EFE7] p-3">
                <div className="text-sm font-medium">{paymentDialog.row.title}</div>
                <div className="mt-1 text-xl font-semibold" style={{ fontFamily: "Outfit" }}>
                  {fmtMoney(
                    paymentDialog.row.settlement_amount,
                    paymentDialog.row.settlement_currency,
                  )}
                </div>
              </div>
              {paymentDialog.mode === "send" && (
                <div className="space-y-2">
                  <Label htmlFor="settlement-amount">{tr("Valor do pagamento")}</Label>
                  <AmountInput
                    id="settlement-amount"
                    min="0.01"
                    max={paymentDialog.row.settlement_amount}
                    value={paymentAmount}
                    currency={paymentDialog.row.currency || curr}
                    onValueChange={setPaymentAmount}
                    data-testid="settlement-amount"
                  />
                  <p className="text-xs text-[#6B7068]">
                    {tr("Você pode registrar um pagamento parcial de até {amount}.", {
                      amount: fmtMoney(
                        paymentDialog.row.settlement_amount,
                        paymentDialog.row.settlement_currency,
                      ),
                    })}
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label>
                  {paymentDialog.mode === "send"
                    ? tr("Carteira de saída")
                    : tr("Carteira de entrada (opcional)")}
                </Label>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger data-testid="settlement-account">
                    <SelectValue
                      placeholder={
                        paymentDialog.mode === "send"
                          ? tr("Selecione uma carteira")
                          : tr("Confirmar sem adicionar a uma carteira")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentAccounts.map(account => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name} · {fmtMoney(account.balance, account.currency || curr)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {paymentDialog.mode === "confirm" && selectedAccountId && (
                  <button
                    type="button"
                    onClick={() => setSelectedAccountId("")}
                    className="text-xs text-[#1268F4] hover:underline"
                  >
                    {tr("Não adicionar a uma carteira")}
                  </button>
                )}
                {paymentAccounts.length === 0 && paymentDialog.mode === "send" && (
                  <p className="text-xs text-rose-600">
                    {tr("Você não possui uma carteira na moeda deste acerto.")}
                  </p>
                )}
              </div>
              <p className="text-xs text-[#6B7068]">
                {paymentDialog.mode === "send"
                  ? tr("O valor sairá agora da carteira e ficará aguardando a confirmação de quem recebe.")
                  : selectedAccountId
                    ? tr("Ao confirmar, o valor entrará na carteira escolhida e reduzirá a dívida.")
                    : tr("A dívida será atualizada sem alterar nenhuma carteira sua.")}
              </p>
            </div>
          )}
          <DialogFooter>
            <button type="button" onClick={closeWalletDialog}
              disabled={paymentBusy}
              className="px-4 py-2 rounded-xl text-sm border border-[#E5E4E0]">
              {tr("Voltar")}
            </button>
            <button type="button" onClick={submitWalletAction}
              disabled={
                paymentBusy
                || (
                  paymentDialog?.mode === "send"
                  && (
                    !selectedAccountId
                    || !Number.isFinite(Number(paymentAmount))
                    || Number(paymentAmount) <= 0
                    || Number(paymentAmount) > Number(paymentDialog.row.settlement_amount)
                  )
                )
              }
              className="px-4 py-2 rounded-xl text-sm bg-[#061B4A] text-white disabled:opacity-50"
              data-testid="settlement-wallet-submit">
              {paymentBusy ? tr("Salvando...") : (
                paymentDialog?.mode === "send"
                  ? tr("Confirmar envio")
                  : tr("Confirmar recebimento")
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(closeDialog)} onOpenChange={open => !open && !closeBusy && setCloseDialog(null)}>
        <DialogContent className="max-w-md" data-testid="settlement-close-dialog">
          <DialogHeader>
            <DialogTitle>
              {closeDialog?.action === "cancel" ? tr("Cancelar registro") : tr("Rejeitar")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#6B7068]">
            {closeDialog?.action === "cancel"
              ? tr("Cancelar o registro? O app criará uma reversão na sua carteira. Faça isso somente se o pagamento não aconteceu.")
              : tr("Rejeitar este pagamento? O débito de quem enviou será mantido e o acerto ficará em contestação.")}
          </p>
          <div className="space-y-2">
            <Label htmlFor="settlement-close-reason">
              {closeDialog?.action === "cancel"
                ? tr("Informe o motivo do cancelamento (opcional)")
                : tr("Informe o motivo da contestação (opcional)")}
            </Label>
            <Textarea id="settlement-close-reason" value={closeReason}
              onChange={event => setCloseReason(event.target.value)} data-testid="settlement-close-reason" />
          </div>
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setCloseDialog(null)} disabled={closeBusy}
              className="min-h-[40px] px-4 py-2 rounded-xl text-sm border border-[#E5E4E0]">
              {tr("Voltar")}
            </button>
            <button type="button" onClick={submitClosePayment} disabled={closeBusy}
              className="min-h-[40px] px-4 py-2 rounded-xl text-sm bg-[#D9453B] text-white disabled:opacity-50"
              data-testid="settlement-close-submit">
              {closeBusy ? tr("Salvando...") : (closeDialog?.action === "cancel" ? tr("Cancelar registro") : tr("Rejeitar"))}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
