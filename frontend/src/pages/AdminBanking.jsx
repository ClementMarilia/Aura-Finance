import { useEffect, useMemo, useState } from "react";
import { Landmark, ShieldCheck, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfirmDialog from "@/components/ConfirmDialog";

const STATUS = {
  approved: "Aprovado", pending: "Solicitado", none: "Sem acesso",
  denied: "Recusado", revoked: "Revogado",
};

export default function AdminBanking() {
  const [config, setConfig] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [changing, setChanging] = useState("");
  const [decision, setDecision] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [cfg, result] = await Promise.all([
        api.get("/admin/banking/config"), api.get("/admin/banking/users"),
      ]);
      setConfig(cfg.data);
      setUsers(result.data);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  const filtered = useMemo(() => users.filter((u) =>
    (u.name + " " + u.email).toLowerCase().includes(search.trim().toLowerCase())
  ), [users, search]);
  const setAccess = async () => {
    if (!decision) return;
    const { id, status } = decision;
    setChanging(id);
    try {
      await api.patch("/admin/banking/users/" + encodeURIComponent(id), { status });
      setUsers((current) => current.map((user) =>
        user.id === id ? { ...user, access: status } : user
      ));
      toast.success("Permissão bancária atualizada.");
      setDecision(null);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setChanging("");
    }
  };

  return (
    <div className="max-w-5xl space-y-6" data-testid="admin-banking">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>
          Integrações bancárias
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Controle quem pode solicitar e utilizar a conexão bancária automática.
        </p>
      </div>

      <div className="card-soft p-5 space-y-3">
        <div className="flex items-center gap-2 font-semibold"><Landmark size={20} /> Provedor: Enable Banking</div>
        {loading ? <p className="text-sm">Carregando configuração...</p> : (
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-lg bg-[var(--bg)] px-3 py-2">
              Funcionalidade: {config?.enabled ? "Habilitada" : "Desativada"}
            </span>
            <span className="rounded-lg bg-[var(--bg)] px-3 py-2">
              Credenciais: {config?.configured ? "Configuradas" : "Pendentes"}
            </span>
            <span className="rounded-lg bg-[var(--bg)] px-3 py-2">
              Modo: {config?.mode || "restrito"}
            </span>
          </div>
        )}
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          As chaves RSA são gerenciadas exclusivamente no backend; esta tela nunca exibe segredos.
          Aprovar um usuário não significa que o provedor autorizará a conexão de contas de terceiros.
        </p>
      </div>

      <div className="card-soft p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-semibold"><ShieldCheck size={20} /> Permissões por usuário</div>
          <Button variant="outline" onClick={load} disabled={loading}><RefreshCw size={16} className="mr-2" />Atualizar</Button>
        </div>
        <label className="flex items-center gap-2">
          <Search size={18} aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar usuário" placeholder="Buscar por nome ou e-mail" />
        </label>
        {loading ? <p role="status" className="text-sm">Carregando usuários...</p> : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {filtered.map((user) => (
              <div key={user.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                data-testid={"bank-access-user-" + user.id}>
                <div className="min-w-0">
                  <p className="font-medium">{user.name}</p>
                  <p className="break-all text-sm" style={{ color: "var(--text-muted)" }}>{user.email}</p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {STATUS[user.access] || user.access} · {user.user_status === "active" ? "Conta ativa" : "Conta não ativa"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {user.protected ? (
                    <span className="text-xs rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2">Acesso protegido</span>
                  ) : (
                    <>
                      {user.access !== "approved" && user.user_status === "active" && (
                        <Button disabled={changing === user.id} onClick={() => setDecision({ id: user.id, name: user.name, status: "approved" })}>
                          Aprovar
                        </Button>
                      )}
                      {user.access === "pending" && (
                        <Button variant="outline" disabled={changing === user.id} onClick={() => setDecision({ id: user.id, name: user.name, status: "denied" })}>
                          Recusar
                        </Button>
                      )}
                      {user.access === "approved" && (
                        <Button variant="outline" disabled={changing === user.id} onClick={() => setDecision({ id: user.id, name: user.name, status: "revoked" })}>
                          Revogar
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            {!filtered.length && <p className="text-sm py-5">Nenhum usuário encontrado.</p>}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(decision)} onOpenChange={(open) => { if (!open) setDecision(null); }}
        title={decision?.status === "approved" ? "Liberar acesso bancário?" : "Alterar acesso bancário?"}
        description={decision ? ("Confirma " + (decision.status === "approved" ? "a aprovação" : decision.status === "revoked" ? "a revogação" : "a recusa") +
          " para " + decision.name + "? A permissão é individual e não compartilha dados financeiros.") : ""}
        confirmLabel="Confirmar" variant={decision?.status === "approved" ? "primary" : "danger"}
        onConfirm={setAccess} testId="banking-decision-dialog"
      />
    </div>
  );
}
