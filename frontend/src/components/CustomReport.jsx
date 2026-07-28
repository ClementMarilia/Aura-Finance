import { useEffect, useMemo, useState } from "react";
import api, { fmtDate, fmtMoney, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { exportCSV, exportPDF } from "@/lib/exporters";
import {
  CalendarDays, FileDown, FileText, Search, SlidersHorizontal, X,
} from "lucide-react";
import { toast } from "sonner";
import { translate as tr } from "@/i18n";

const emptyFilters = {
  description: "",
  category_ids: [],
  participant_ids: [],
  statuses: [],
  types: [],
  period: "all",
  specific_date: "",
  month: "",
  year: "",
  start_date: "",
  end_date: "",
  account_ids: [],
};

const TYPE_OPTIONS = [
  ["income", "Receita"],
  ["expense", "Despesa"],
  ["transfer", "Transferência"],
  ["shared_expense", "Despesa compartilhada"],
  ["settlement", "Acerto"],
];

const STATUS_OPTIONS = [
  ["paid", "Pago"],
  ["pending", "Pendente"],
  ["overdue", "Vencido"],
  ["completed", "Concluído"],
];

const TYPE_LABELS = Object.fromEntries(TYPE_OPTIONS);
const STATUS_LABELS = Object.fromEntries(STATUS_OPTIONS);

function MultiFilter({ label, options, values, onChange, testId }) {
  const toggle = (value) => {
    onChange(values.includes(value)
      ? values.filter(item => item !== value)
      : [...values, value]);
  };
  return (
    <details className="relative" data-testid={testId}>
      <summary className="list-none cursor-pointer min-h-10 bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm flex items-center justify-between gap-2">
        <span>{label}</span>
        {values.length > 0 && (
          <span className="rounded-full bg-[#061B4A] text-white text-[10px] min-w-5 h-5 px-1 flex items-center justify-center">
            {values.length}
          </span>
        )}
      </summary>
      <div className="absolute z-30 mt-1 w-full min-w-56 max-h-64 overflow-y-auto bg-white border border-[#E5E4E0] rounded-xl shadow-xl p-2">
        {options.length === 0 && (
          <div className="px-2 py-3 text-xs text-[#6B7068]">{tr("Nenhuma opção")}</div>
        )}
        {options.map(option => (
          <label key={option.value} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[#F1EFE7] text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={values.includes(option.value)}
              onChange={() => toggle(option.value)}
              className="accent-[#061B4A]"
            />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

function Summary({ data, currency }) {
  const cards = [
    ["Receitas", data.income, "text-emerald-600"],
    ["Despesas", data.expense, "text-rose-600"],
    ["A receber", data.shared_receivable, "text-emerald-600"],
    ["A pagar", data.shared_payable, "text-rose-600"],
    ["Acertos concluídos", data.settled, "text-[#061B4A]"],
    ["Saldo filtrado", data.balance, data.balance < 0 ? "text-rose-600" : "text-[#061B4A]"],
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
      {cards.map(([label, value, tone]) => (
        <div key={label} className="card-soft min-w-0 p-4">
          <div className="text-xs text-[#6B7068]">{tr(label)}</div>
          <div className={`money-value font-semibold mt-1 ${tone}`}>{fmtMoney(value, currency)}</div>
        </div>
      ))}
    </div>
  );
}

function ParticipantSummary({ data, currency }) {
  if (!data) return null;
  const cards = [
    ["Ainda deve receber", data.to_receive, "text-emerald-600"],
    ["Ainda deve pagar", data.to_pay, "text-rose-600"],
    ["Já recebeu", data.received, "text-emerald-600"],
    ["Já pagou", data.paid, "text-[#061B4A]"],
  ];
  return (
    <div className="card-soft" data-testid="participant-report-summary">
      <div className="mb-3">
        <div className="text-xs text-[#6B7068]">{tr("Resumo da pessoa")}</div>
        <div className="font-semibold text-lg">{data.name}</div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(([label, value, tone]) => (
          <div key={label} className="rounded-xl bg-[#F8F6EE] p-3">
            <div className="text-xs text-[#6B7068]">{tr(label)}</div>
            <div className={`money-value font-semibold mt-1 ${tone}`}>{fmtMoney(value, currency)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CustomReport({ user }) {
  const [options, setOptions] = useState({ categories: [], accounts: [], participants: [] });
  const [filters, setFilters] = useState(emptyFilters);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const currency = report?.base_currency || user?.currency || "EUR";

  const loadReport = async (nextFilters = filters) => {
    setLoading(true);
    try {
      const response = await api.post("/reports/filtered", {
        ...nextFilters,
        year: nextFilters.year ? Number(nextFilters.year) : null,
        specific_date: nextFilters.specific_date || null,
        month: nextFilters.month || null,
        start_date: nextFilters.start_date || null,
        end_date: nextFilters.end_date || null,
      });
      setReport(response.data);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.get("/reports/filter-options")
      .then(response => setOptions(response.data))
      .catch(error => toast.error(formatApiError(error)));
    loadReport(emptyFilters);
    // The initial report intentionally loads once when the custom view mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedLabels = useMemo(() => {
    const labels = [];
    if (filters.description) labels.push(`${tr("Descrição")}: ${filters.description}`);
    labels.push(...filters.category_ids.map(id => options.categories.find(item => item.id === id)?.name).filter(Boolean));
    labels.push(...filters.participant_ids.map(id => options.participants.find(item => item.id === id)?.name).filter(Boolean));
    labels.push(...filters.statuses.map(value => tr(STATUS_LABELS[value])));
    labels.push(...filters.types.map(value => tr(TYPE_LABELS[value])));
    labels.push(...filters.account_ids.map(id => options.accounts.find(item => item.id === id)?.name).filter(Boolean));
    if (filters.period !== "all") labels.push(tr("Período personalizado"));
    return labels;
  }, [filters, options]);

  const update = (field, value) => setFilters(current => ({ ...current, [field]: value }));
  const apply = event => {
    event.preventDefault();
    loadReport(filters);
  };
  const clear = () => {
    setFilters(emptyFilters);
    loadReport(emptyFilters);
  };

  const exportRows = () => (report?.rows || []).map(row => [
    row.date,
    tr(TYPE_LABELS[row.type] || row.type),
    row.description,
    row.category,
    (row.participant_names || []).join(" / "),
    tr(STATUS_LABELS[row.status] || row.status),
    row.account,
    row.amount,
    row.currency,
    row.base_amount,
  ]);
  const headers = [
    tr("Data"), tr("Tipo"), tr("Descrição"), tr("Categoria"), tr("Pessoa/participante"),
    tr("Status"), tr("Carteira"), tr("Valor original"), tr("Moeda original"),
    `${tr("Valor")} (${currency})`,
  ];
  const exportCsv = () => exportCSV("relatorio_personalizado.csv", headers, exportRows());
  const exportPdf = () => exportPDF(
    tr("Relatório personalizado"),
    selectedLabels.length ? selectedLabels.join(" · ") : tr("Todos os registros"),
    headers,
    exportRows().map(row => row.map((value, index) => index >= 7 && typeof value === "number" ? fmtMoney(value, index === 7 ? row[8] : currency) : value)),
    ["", "", tr("Saldo filtrado"), "", "", "", "", "", "", fmtMoney(report?.summary?.balance, currency)],
  );

  return (
    <div className="space-y-5" data-testid="custom-report">
      <form onSubmit={apply} className="card-soft space-y-4" data-testid="custom-report-filters">
        <div className="flex items-center gap-2 font-medium">
          <SlidersHorizontal size={17} /> {tr("Filtros combináveis")}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="relative md:col-span-2">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7068]" />
            <Input
              value={filters.description}
              onChange={event => update("description", event.target.value)}
              placeholder={tr("Descrição, observação, categoria ou pessoa")}
              className="pl-9"
              data-testid="report-description"
            />
          </div>
          <MultiFilter
            label={tr("Categorias")}
            options={options.categories.map(item => ({ value: item.id, label: item.name }))}
            values={filters.category_ids}
            onChange={value => update("category_ids", value)}
            testId="report-categories"
          />
          <MultiFilter
            label={tr("Pessoa/participante")}
            options={options.participants.map(item => ({
              value: item.id,
              label: `${item.name}${item.external ? ` · ${tr("externa")}` : ""}`,
            }))}
            values={filters.participant_ids}
            onChange={value => update("participant_ids", value)}
            testId="report-participants"
          />
          <MultiFilter
            label={tr("Status")}
            options={STATUS_OPTIONS.map(([value, label]) => ({ value, label: tr(label) }))}
            values={filters.statuses}
            onChange={value => update("statuses", value)}
            testId="report-statuses"
          />
          <MultiFilter
            label={tr("Tipo")}
            options={TYPE_OPTIONS.map(([value, label]) => ({ value, label: tr(label) }))}
            values={filters.types}
            onChange={value => update("types", value)}
            testId="report-types"
          />
          <MultiFilter
            label={tr("Carteira/conta")}
            options={options.accounts.map(item => ({ value: item.id, label: item.name }))}
            values={filters.account_ids}
            onChange={value => update("account_ids", value)}
            testId="report-accounts"
          />
          <select
            value={filters.period}
            onChange={event => update("period", event.target.value)}
            className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm"
            data-testid="report-period"
          >
            <option value="all">{tr("Todo o período")}</option>
            <option value="date">{tr("Data específica")}</option>
            <option value="month">{tr("Mês")}</option>
            <option value="year">{tr("Ano")}</option>
            <option value="range">{tr("Intervalo personalizado")}</option>
          </select>
        </div>

        {filters.period === "date" && (
          <Input type="date" value={filters.specific_date} onChange={event => update("specific_date", event.target.value)} className="max-w-xs" required />
        )}
        {filters.period === "month" && (
          <Input type="month" value={filters.month} onChange={event => update("month", event.target.value)} className="max-w-xs" required />
        )}
        {filters.period === "year" && (
          <Input type="number" min="1900" max="2200" value={filters.year} onChange={event => update("year", event.target.value)} className="max-w-xs" required />
        )}
        {filters.period === "range" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
            <Input type="date" value={filters.start_date} onChange={event => update("start_date", event.target.value)} aria-label={tr("Data inicial")} required />
            <Input type="date" value={filters.end_date} onChange={event => update("end_date", event.target.value)} aria-label={tr("Data final")} required />
          </div>
        )}

        {selectedLabels.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="active-report-filters">
            {selectedLabels.map((label, index) => (
              <span key={`${label}-${index}`} className="pill">{label}</span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2">
          <div className="text-xs text-[#6B7068] flex items-center gap-1">
            <CalendarDays size={14} /> {tr("Os totais e as exportações respeitam os filtros aplicados.")}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={clear} data-testid="clear-custom-report">
              <X size={14} className="mr-1" /> {tr("Limpar filtros")}
            </Button>
            <Button type="submit" disabled={loading} className="bg-[#061B4A] hover:bg-[#1268F4]" data-testid="apply-custom-report">
              <Search size={14} className="mr-1" /> {loading ? tr("Buscando...") : tr("Aplicar filtros")}
            </Button>
          </div>
        </div>
      </form>

      {report && (
        <>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={!report.rows.length}>
              <FileDown size={15} className="mr-1" /> CSV
            </Button>
            <Button variant="outline" onClick={exportPdf} disabled={!report.rows.length}>
              <FileText size={15} className="mr-1" /> PDF
            </Button>
          </div>
          <Summary data={report.summary} currency={currency} />
          <ParticipantSummary data={report.participant_summary} currency={currency} />
          <div className="card-soft overflow-x-auto p-0">
            <div className="p-4 flex items-center justify-between gap-3">
              <h3 className="font-semibold">{tr("Registros filtrados")}</h3>
              <span className="text-xs text-[#6B7068]">{tr("{count} resultado(s)", { count: report.summary.count })}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-[#F1EFE7] text-[#6B7068]">
                <tr>
                  <th className="text-left py-3 px-4">{tr("Data")}</th>
                  <th className="text-left py-3 px-4">{tr("Tipo")}</th>
                  <th className="text-left py-3 px-4">{tr("Descrição")}</th>
                  <th className="text-left py-3 px-4">{tr("Categoria")}</th>
                  <th className="text-left py-3 px-4">{tr("Pessoa/participante")}</th>
                  <th className="text-left py-3 px-4">{tr("Status")}</th>
                  <th className="text-right py-3 px-4">{tr("Valor")}</th>
                </tr>
              </thead>
              <tbody>
                {!loading && report.rows.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-12 text-[#6B7068]">{tr("Nenhum registro encontrado")}</td></tr>
                )}
                {report.rows.map(row => (
                  <tr key={`${row.type}-${row.id}`} className="border-b border-[#E5E4E0]">
                    <td className="py-3 px-4 whitespace-nowrap">{fmtDate(row.date)}</td>
                    <td className="py-3 px-4 whitespace-nowrap">{tr(TYPE_LABELS[row.type] || row.type)}</td>
                    <td className="py-3 px-4 min-w-48">
                      <div>{row.description}</div>
                      {row.notes && <div className="text-xs text-[#6B7068] mt-0.5">{row.notes}</div>}
                    </td>
                    <td className="py-3 px-4">{row.category}</td>
                    <td className="py-3 px-4">{(row.participant_names || []).join(" → ") || "—"}</td>
                    <td className="py-3 px-4"><span className="pill">{tr(STATUS_LABELS[row.status] || row.status)}</span></td>
                    <td className="py-3 px-4 text-right font-semibold whitespace-nowrap">{fmtMoney(row.base_amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
