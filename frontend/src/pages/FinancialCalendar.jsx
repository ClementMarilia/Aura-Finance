import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight,
  CircleAlert, Filter, Search,
} from "lucide-react";
import api from "@/lib/api";
import { getLocale, translate as tr } from "@/i18n";

const sourceLabels = {
  transaction: "Lançamento",
  recurrence: "Recorrência",
  installment: "Parcela",
  receivable: "Conta a receber",
};

const statusLabels = {
  paid: "Pago",
  pending: "Pendente",
  received: "Recebido",
  cancelled: "Cancelado",
};

function isoDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthWindow(value = new Date()) {
  const year = value.getFullYear();
  const month = value.getMonth();
  return {
    start: isoDate(new Date(year, month, 1)),
    end: isoDate(new Date(year, month + 1, 0)),
  };
}

function addMonths(value, amount) {
  const [year, month] = value.split("-").map(Number);
  return monthWindow(new Date(year, month - 1 + amount, 1));
}

function parseDay(value) {
  return new Date(`${value}T12:00:00`);
}

function money(value, currency) {
  return new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: currency || "EUR",
  }).format(Number(value) || 0);
}

function longDate(value) {
  return new Intl.DateTimeFormat(getLocale(), {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  }).format(parseDay(value));
}

function periodTitle(start, end) {
  const startValue = parseDay(start);
  const endValue = parseDay(end);
  if (startValue.getFullYear() === endValue.getFullYear() && startValue.getMonth() === endValue.getMonth()) {
    return new Intl.DateTimeFormat(getLocale(), { month: "long", year: "numeric" }).format(startValue);
  }
  const formatter = new Intl.DateTimeFormat(getLocale(), { day: "2-digit", month: "short", year: "numeric" });
  return `${formatter.format(startValue)} — ${formatter.format(endValue)}`;
}

function calendarDays(start, end) {
  const first = parseDay(start);
  const last = parseDay(end);
  const mondayOffset = (first.getDay() + 6) % 7;
  first.setDate(first.getDate() - mondayOffset);
  const days = [];
  for (const cursor = new Date(first); cursor <= last || days.length % 7; cursor.setDate(cursor.getDate() + 1)) {
    days.push(isoDate(cursor));
  }
  return days;
}

function cleanParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value));
}

export default function FinancialCalendar() {
  const initial = useMemo(() => monthWindow(), []);
  const [period, setPeriod] = useState(initial);
  const [filters, setFilters] = useState({ account_id: "", category_id: "", type: "", status: "", source: "" });
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = isoDate(new Date());
    return today >= initial.start && today <= initial.end ? today : initial.start;
  });

  const queryParams = useMemo(() => cleanParams({
    start_date: period.start,
    end_date: period.end,
    ...filters,
    search,
  }), [period, filters, search]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["financial-calendar", queryParams],
    queryFn: async () => (await api.get("/calendar", { params: queryParams })).data,
    staleTime: 30_000,
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", "calendar-filters"],
    queryFn: async () => (await api.get("/accounts")).data,
    staleTime: 60_000,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories", "calendar-filters"],
    queryFn: async () => (await api.get("/categories")).data,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (selectedDate < period.start || selectedDate > period.end) setSelectedDate(period.start);
  }, [period, selectedDate]);

  const eventsByDay = useMemo(() => {
    const grouped = new Map();
    for (const event of data?.events || []) {
      if (!grouped.has(event.date)) grouped.set(event.date, []);
      grouped.get(event.date).push(event);
    }
    return grouped;
  }, [data?.events]);
  const gridDays = useMemo(() => calendarDays(period.start, period.end), [period]);
  const selectedEvents = eventsByDay.get(selectedDate) || [];
  const weekdayLabels = useMemo(() => {
    const monday = new Date(2026, 7, 3);
    return Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(getLocale(), { weekday: "short" })
      .format(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)));
  }, []);

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const changeMonth = (amount) => {
    const next = addMonths(period.start, amount);
    setPeriod(next);
    setSelectedDate(next.start);
  };
  const goToday = () => {
    const today = isoDate(new Date());
    setPeriod(monthWindow());
    setSelectedDate(today);
  };

  return (
    <div className="space-y-6" data-testid="financial-calendar-page">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-[#6B7068]">
            <CalendarDays size={17} /> {tr("Planejamento financeiro")}
          </div>
          <h1 className="text-2xl font-semibold text-[#1A1C1A]" style={{ fontFamily: "Outfit" }}>
            {tr("Calendário financeiro")}
          </h1>
          <p className="mt-1 text-sm text-[#6B7068]">
            {tr("Contas, parcelas, recorrências e recebimentos em uma única agenda.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => changeMonth(-1)} aria-label={tr("Mês anterior")}
            className="rounded-xl border p-2.5 text-[#6B7068] hover:bg-[#F1EFE7]" style={{ borderColor: "var(--border)" }}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={goToday}
            className="rounded-xl border px-4 py-2 text-sm text-[#1A1C1A] hover:bg-[#F1EFE7]" style={{ borderColor: "var(--border)" }}>
            {tr("Hoje")}
          </button>
          <button type="button" onClick={() => changeMonth(1)} aria-label={tr("Próximo mês")}
            className="rounded-xl border p-2.5 text-[#6B7068] hover:bg-[#F1EFE7]" style={{ borderColor: "var(--border)" }}>
            <ChevronRight size={18} />
          </button>
        </div>
      </header>

      <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-[#1A1C1A]">
          <Filter size={17} /> {tr("Filtros do calendário")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={tr("Data inicial")}>
            <input type="date" required value={period.start} max={period.end} onChange={(event) => event.target.value && setPeriod((current) => ({ ...current, start: event.target.value }))} className="field-control" />
          </Field>
          <Field label={tr("Data final")}>
            <input type="date" required value={period.end} min={period.start} onChange={(event) => event.target.value && setPeriod((current) => ({ ...current, end: event.target.value }))} className="field-control" />
          </Field>
          <Field label={tr("Carteira")}>
            <select value={filters.account_id} onChange={(event) => setFilter("account_id", event.target.value)} className="field-control">
              <option value="">{tr("Todas as carteiras")}</option>
              {accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label={tr("Categoria")}>
            <select value={filters.category_id} onChange={(event) => setFilter("category_id", event.target.value)} className="field-control">
              <option value="">{tr("Todas as categorias")}</option>
              {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label={tr("Tipo")}>
            <select value={filters.type} onChange={(event) => setFilter("type", event.target.value)} className="field-control">
              <option value="">{tr("Todos os tipos")}</option>
              <option value="income">{tr("Receita")}</option>
              <option value="expense">{tr("Despesa")}</option>
              <option value="transfer">{tr("Transferência")}</option>
            </select>
          </Field>
          <Field label={tr("Status")}>
            <select value={filters.status} onChange={(event) => setFilter("status", event.target.value)} className="field-control">
              <option value="">{tr("Todos os status")}</option>
              {Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{tr(label)}</option>)}
            </select>
          </Field>
          <Field label={tr("Origem")}>
            <select value={filters.source} onChange={(event) => setFilter("source", event.target.value)} className="field-control">
              <option value="">{tr("Todas as origens")}</option>
              {Object.entries(sourceLabels).map(([key, label]) => <option key={key} value={key}>{tr(label)}</option>)}
            </select>
          </Field>
          <form onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }}>
            <Field label={tr("Pesquisar")}>
              <div className="flex gap-2">
                <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={120}
                  placeholder={tr("Buscar por descrição")} className="field-control min-w-0" />
                <button type="submit" aria-label={tr("Pesquisar")} className="rounded-xl bg-[#061B4A] px-3 text-white"><Search size={17} /></button>
              </div>
            </Field>
          </form>
        </div>
      </section>

      {isLoading ? <p className="p-6 text-sm text-[#6B7068]">{tr("Carregando calendário...")}</p> : isError ? (
        <div className="rounded-2xl border p-6" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <p className="font-medium">{tr("Não foi possível carregar o calendário financeiro.")}</p>
          <p className="mt-1 text-sm text-[#6B7068]">{tr("Revise o período e tente novamente.")}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label={tr("Eventos no período")} value={data?.summary?.event_count || 0} icon={CalendarDays} />
            <Metric label={tr("Entradas")} value={money(data?.summary?.income, data?.currency)} icon={ArrowUpRight} tone="green" />
            <Metric label={tr("Saídas")} value={money(data?.summary?.expenses, data?.currency)} icon={ArrowDownRight} tone="red" />
            <Metric label={tr("Contas atrasadas")} value={data?.summary?.overdue_count || 0} icon={CircleAlert} tone="red" />
          </div>

          <section className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="border-b px-4 py-4 md:px-6" style={{ borderColor: "var(--border)" }}>
              <h2 className="font-medium capitalize text-[#1A1C1A]">
                {periodTitle(period.start, period.end)}
              </h2>
            </div>
            <div className="grid grid-cols-7 border-b text-center text-xs font-medium uppercase text-[#6B7068]" style={{ borderColor: "var(--border)" }}>
              {weekdayLabels.map((label) => <div key={label} className="p-2">{label}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {gridDays.map((day) => {
                const dayEvents = eventsByDay.get(day) || [];
                const inPeriod = day >= period.start && day <= period.end;
                const active = day === selectedDate;
                return (
                  <button key={day} type="button" disabled={!inPeriod} onClick={() => setSelectedDate(day)}
                    aria-label={`${longDate(day)} — ${dayEvents.length} ${tr("eventos")}`}
                    className={`min-h-20 border-b border-r p-1.5 text-left transition-colors md:min-h-28 md:p-2 ${
                      !inPeriod ? "bg-black/[0.025] text-[#A3A69F]" : active ? "bg-[#F1EFE7] ring-2 ring-inset ring-[#061B4A]" : "hover:bg-[#F8F7F2]"
                    }`} style={{ borderColor: "var(--border)" }}>
                    <span className="text-xs font-medium md:text-sm">{parseDay(day).getDate()}</span>
                    <div className="mt-1 space-y-1">
                      {dayEvents.slice(0, 3).map((event) => (
                        <span key={event.id} title={event.title} className={`block truncate rounded px-1 py-0.5 text-[9px] md:text-[11px] ${eventClass(event)}`}>
                          {event.title || tr(sourceLabels[event.source])}
                        </span>
                      ))}
                      {dayEvents.length > 3 && <span className="block text-[9px] text-[#6B7068] md:text-[11px]">+{dayEvents.length - 3}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="border-b px-4 py-4 md:px-6" style={{ borderColor: "var(--border)" }}>
              <h2 className="font-medium capitalize text-[#1A1C1A]">{tr("Agenda de")} {longDate(selectedDate)}</h2>
              <p className="mt-1 text-sm text-[#6B7068]">{selectedEvents.length} {tr("eventos")}</p>
            </div>
            {selectedEvents.length === 0 ? (
              <p className="p-6 text-sm text-[#6B7068]">{tr("Nenhum compromisso financeiro nesta data.")}</p>
            ) : (
              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {selectedEvents.map((event) => <EventRow key={event.id} event={event} currency={data?.currency} />)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block text-xs font-medium text-[#6B7068]"><span className="mb-1.5 block">{label}</span>{children}</label>;
}

function Metric({ label, value, icon: Icon, tone }) {
  const color = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-rose-600" : "text-[#061B4A]";
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-center justify-between text-sm text-[#6B7068]"><span>{label}</span><Icon size={17} className={color} /></div>
      <p className={`mt-2 text-xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function eventClass(event) {
  if (event.overdue) return "bg-rose-100 text-rose-800";
  if (event.type === "income") return "bg-emerald-100 text-emerald-800";
  if (event.type === "expense") return "bg-amber-100 text-amber-900";
  return "bg-blue-100 text-blue-800";
}

function EventRow({ event, currency }) {
  const sign = event.type === "income" ? "+" : event.type === "expense" ? "−" : "";
  return (
    <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-[#1A1C1A]">{event.title || tr(sourceLabels[event.source])}</p>
          {event.overdue && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] text-rose-700">{tr("Atrasado")}</span>}
          {event.estimated && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-700">{tr("Previsto")}</span>}
        </div>
        <p className="mt-1 text-xs text-[#6B7068]">
          {tr(sourceLabels[event.source])} · {tr(statusLabels[event.status])}
          {event.installment_number ? ` · ${event.installment_number}/${event.installment_total}` : ""}
        </p>
      </div>
      <p className={`whitespace-nowrap font-semibold ${event.type === "income" ? "text-emerald-700" : event.type === "expense" ? "text-rose-600" : "text-blue-700"}`}>
        {sign}{money(event.amount, currency)}
      </p>
    </div>
  );
}
