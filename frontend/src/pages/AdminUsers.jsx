import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, Clock3, Loader2, ShieldCheck, Trash2,
  UserCheck, UserX, Users,
} from "lucide-react";
import { toast } from "sonner";
import api, { fmtDate, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { translate as tr } from "@/i18n";
import { useAuth } from "@/context/AuthContext";

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

const IMPACT_LABELS = {
  income: "Receitas",
  expenses: "Despesas",
  transfers: "Transferências",
  wallets: "Carteiras",
  goals: "Metas financeiras",
  shared_expenses: "Despesas compartilhadas",
  pending_settlements: "Acertos pendentes",
  recurrences: "Recorrências",
  installment_purchases: "Parcelamentos",
  receivables: "Contas a receber",
  groups_created: "Grupos criados",
};

export default function AdminUsers() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [actingId, setActingId] = useState("");
  const [rejecting, setRejecting] = useState(null);
  const [deletingCandidate, setDeletingCandidate] = useState(null);
  const [deletionImpact, setDeletionImpact] = useState(null);
  const [loadingImpact, setLoadingImpact] = useState(false);

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

  const closeDeletion = () => {
    setDeletingCandidate(null);
    setDeletionImpact(null);
    setLoadingImpact(false);
  };

  const reviewDeletion = async (candidate) => {
    setDeletingCandidate(candidate);
    setDeletionImpact(null);
    setLoadingImpact(true);
    try {
      const { data } = await api.get(`/admin/users/${candidate.id}/deletion-impact`);
      setDeletionImpact(data);
    } catch (error) {
      toast.error(formatApiError(error));
      closeDeletion();
    } finally {
      setLoadingImpact(false);
    }
  };

  const deleteUser = async () => {
    if (!deletingCandidate || !deletionImpact?.can_delete) return;
    setActingId(deletingCandidate.id);
    try {
      await api.delete(`/admin/users/${deletingCandidate.id}`);
      setUsers((current) => current.filter(
        (candidate) => candidate.id !== deletingCandidate.id,
      ));
      toast.success(tr("{name} foi excluído", { name: deletingCandidate.name }));
      closeDeletion();
    } catch (error) {
      const detail = error?.response?.data?.detail;
      toast.error(
        typeof detail?.message === "string"
          ? tr(detail.message)
          : formatApiError(error),
      );
      try {
        const { data } = await api.get(
          `/admin/users/${deletingCandidate.id}/deletion-impact`,
        );
        setDeletionImpact(data);
      } catch {
        closeDeletion();
      }
    } finally {
      setActingId("");
    }
  };

  const impactItems = Object.entries(deletionImpact?.impact || {})
    .filter(([, count]) => count > 0);

  return (
    <div className="space-y-6 max-w-5xl" data-testid="admin-users-page">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>
          {tr("Gerenciamento de usuários")}
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
            {tr("Esta área não exibe saldos, valores, lançamentos ou relatórios. Na exclusão, mostra somente a quantidade de itens que precisam ser resolvidos.")}
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

                  <div className="flex flex-shrink-0 flex-wrap gap-2">
                    {candidate.status !== "active" && (
                      <>
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
                      </>
                    )}
                    {candidate.id !== user?.id && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={acting}
                        onClick={() => reviewDeletion(candidate)}
                        data-testid={`delete-user-${candidate.id}`}
                        className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 size={15} className="mr-1.5" />
                        {tr("Excluir")}
                      </Button>
                    )}
                  </div>
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

      <Dialog
        open={Boolean(deletingCandidate)}
        onOpenChange={(open) => !open && closeDeletion()}
      >
        <DialogContent
          className="max-h-[90vh] max-w-lg overflow-y-auto"
          data-testid="delete-user-dialog"
        >
          <DialogHeader>
            <DialogTitle>{tr("Excluir usuário?")}</DialogTitle>
          </DialogHeader>

          {deletingCandidate && (
            <div className="rounded-xl border border-[color:var(--border)] p-3">
              <p className="font-medium">{deletingCandidate.name}</p>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {deletingCandidate.email}
              </p>
            </div>
          )}

          {loadingImpact ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 size={18} className="animate-spin" />
              {tr("Verificando impacto da exclusão...")}
            </div>
          ) : deletionImpact && (
            <div className="space-y-4">
              {impactItems.length > 0 ? (
                <div>
                  <h3 className="text-sm font-medium">{tr("Itens encontrados")}</h3>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {impactItems.map(([key, count]) => (
                      <div
                        key={key}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
                      >
                        <p className="text-xs text-amber-800">
                          {tr(IMPACT_LABELS[key] || key)}
                        </p>
                        <p className="text-lg font-semibold text-amber-900">{count}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  {tr("Nenhuma pendência financeira encontrada.")}
                </div>
              )}

              {!deletionImpact.can_delete && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
                  <p>
                    {deletionImpact.blockers.includes("self_delete")
                      ? tr("Você não pode excluir sua própria conta por esta funcionalidade.")
                      : deletionImpact.blockers.includes("last_active_admin")
                        ? tr("O último administrador ativo não pode ser excluído.")
                        : tr("Resolva ou remova os itens acima antes de excluir este usuário.")}
                  </p>
                </div>
              )}

              {deletionImpact.can_delete && (
                <div className="space-y-2 text-sm" style={{ color: "var(--text-muted)" }}>
                  <p>{tr("O acesso será encerrado imediatamente em todos os dispositivos.")}</p>
                  <p className="font-medium text-rose-700">
                    {tr("Esta ação é permanente e não pode ser desfeita.")}
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={closeDeletion}
              className="rounded-xl"
            >
              {tr("Cancelar")}
            </Button>
            <Button
              type="button"
              disabled={
                loadingImpact
                || !deletionImpact?.can_delete
                || actingId === deletingCandidate?.id
              }
              onClick={deleteUser}
              data-testid="delete-user-confirm"
              className="rounded-xl bg-[#D9453B] text-white hover:bg-[#B83A30]"
            >
              {actingId === deletingCandidate?.id
                ? tr("Excluindo...")
                : tr("Excluir usuário")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
