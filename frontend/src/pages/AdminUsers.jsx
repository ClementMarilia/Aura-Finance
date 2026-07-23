import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, ShieldCheck, UserCheck, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import api, { fmtDate, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ConfirmDialog";
import { translate as tr } from "@/i18n";

const FILTERS = [
  { value: "pending", label: tr("Pendentes") },
  { value: "active", label: tr("Ativos") },
  { value: "rejected", label: tr("Rejeitados") },
];

const STATUS = {
  pending: {
    label: tr("Aguardando"),
    className: "bg-amber-50 text-amber-700 border-amber-200",
    icon: Clock3,
  },
  active: {
    label: tr("Ativo"),
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: UserCheck,
  },
  rejected: {
    label: tr("Rejeitado"),
    className: "bg-rose-50 text-rose-700 border-rose-200",
    icon: UserX,
  },
};

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [actingId, setActingId] = useState("");
  const [rejecting, setRejecting] = useState(null);

  const load = async () => {
    setLoading(true);
    setUsersLoaded(false);
    try {
      const { data } = await api.get("/admin/users", { params: { status: "all" } });
      setUsers(data);
      setUsersLoaded(true);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(
    () => FILTERS.reduce(
      (result, item) => ({
        ...result,
        [item.value]: users.filter((user) => user.status === item.value).length,
      }),
      {},
    ),
    [users],
  );

  const visibleUsers = users.filter((user) => user.status === filter);
  const pendingCount = counts.pending || 0;

  useEffect(() => {
    if (!usersLoaded) return;
    window.dispatchEvent(new CustomEvent(
      "crelith:pending-user-count",
      { detail: pendingCount },
    ));
  }, [usersLoaded, pendingCount]);

  const updateUser = (updated) => {
    setUsers((current) => current.map((user) => (
      user.id === updated.id ? updated : user
    )));
  };

  const approve = async (candidate) => {
    setActingId(candidate.id);
    try {
      const { data } = await api.post(`/admin/users/${candidate.id}/approve`);
      updateUser(data);
      toast.success(tr("{name} foi aprovado", { name: candidate.name }));
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setActingId("");
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    setActingId(rejecting.id);
    try {
      const { data } = await api.post(`/admin/users/${rejecting.id}/reject`);
      updateUser(data);
      toast.success(tr("{name} foi rejeitado", { name: rejecting.name }));
      setRejecting(null);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setActingId("");
    }
  };

  return (
    <div className="space-y-6 max-w-5xl" data-testid="admin-users-page">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>
          {tr("Aprovação de usuários")}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {tr("Controle quem pode acessar a Crelith Finance.")}
        </p>
      </div>

      <div className="card-soft flex items-start gap-3 border border-blue-100 bg-blue-50/60">
        <ShieldCheck size={22} className="mt-0.5 flex-shrink-0 text-[#1268F4]" />
        <div>
          <h2 className="font-medium text-[#061B4A]">{tr("Privacidade preservada")}</h2>
          <p className="mt-1 text-sm text-[#42526B]">
            {tr("Esta área mostra somente nome, e-mail, data do cadastro e status. Carteiras, saldos, lançamentos e relatórios permanecem privados.")}
          </p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={tr("Status dos usuários")}>
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={filter === item.value}
            onClick={() => setFilter(item.value)}
            data-testid={`admin-filter-${item.value}`}
            className={`whitespace-nowrap rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
              filter === item.value
                ? "border-[#061B4A] bg-[#061B4A] text-white"
                : "border-[color:var(--border)] bg-[color:var(--surface)] hover:bg-[#F1EFE7]"
            }`}
          >
            {item.label} <span className="ml-1 opacity-70">{counts[item.value] || 0}</span>
          </button>
        ))}
      </div>

      <div className="card-soft p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {tr("Carregando usuários...")}
          </div>
        ) : visibleUsers.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F1EFE7] text-[#061B4A]">
              {filter === "pending" ? <Check size={22} /> : <Users size={22} />}
            </div>
            <p className="mt-3 font-medium">
              {filter === "pending" ? tr("Nenhum cadastro aguardando") : tr("Nenhum usuário neste status")}
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {filter === "pending"
                ? tr("Quando alguém se cadastrar, aparecerá aqui para sua decisão.")
                : tr("Use os filtros acima para consultar os demais usuários.")}
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {visibleUsers.map((candidate) => {
              const status = STATUS[candidate.status] || STATUS.pending;
              const StatusIcon = status.icon;
              const acting = actingId === candidate.id;
              return (
                <div
                  key={candidate.id}
                  className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`admin-user-${candidate.id}`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{candidate.name}</p>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${status.className}`}>
                        <StatusIcon size={12} />
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm" style={{ color: "var(--text-muted)" }}>
                      {candidate.email}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {tr("Cadastro em")} {fmtDate(candidate.created_at)}
                    </p>
                  </div>

                  {candidate.status !== "active" && (
                    <div className="flex flex-shrink-0 gap-2">
                      {candidate.status === "pending" && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={acting}
                          onClick={() => setRejecting(candidate)}
                          data-testid={`reject-user-${candidate.id}`}
                          className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50"
                        >
                          {tr("Rejeitar")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        disabled={acting}
                        onClick={() => approve(candidate)}
                        data-testid={`approve-user-${candidate.id}`}
                        className="rounded-xl bg-[#061B4A] hover:bg-[#1268F4]"
                      >
                        {acting
                          ? tr("Processando...")
                          : candidate.status === "rejected"
                            ? tr("Aprovar agora")
                            : tr("Aprovar")}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(rejecting)}
        onOpenChange={(open) => !open && setRejecting(null)}
        title={tr("Rejeitar cadastro?")}
        description={rejecting
          ? tr("{name} não poderá entrar na Crelith Finance. Você ainda poderá aprovar esta conta depois.", { name: rejecting.name })
          : ""}
        confirmLabel={tr("Rejeitar")}
        onConfirm={reject}
        testId="reject-user-dialog"
      />
    </div>
  );
}
