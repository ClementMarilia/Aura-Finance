import { useEffect, useState } from "react";
import { Landmark, ShieldCheck, RefreshCw, Link2Off, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfirmDialog from "@/components/ConfirmDialog";

const ACCESS_LABELS = {
  none: "Ainda não solicitado", pending: "Aguardando aprovação",
  approved: "Acesso aprovado", denied: "Solicitação recusada", revoked: "Acesso revogado",
};

export default function Banking() {
  const [access, setAccess] = useState(null);
  const [connections, setConnections] = useState([]);
  const [institutions, setInstitutions] = useState([]);
  const [country, setCountry] = useState("IT");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [disconnectId, setDisconnectId] = useState(null);
  const [preview, setPreview] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/banking/access");
      setAccess(data);
      if (data.allowed) {
        const result = await api.get("/banking/connections");
        setConnections(result.data);
      }
    } catch (error) { toast.error(formatApiError(error)); }
  };
  useEffect(() => {
    load();
    const flag = new URLSearchParams(window.location.search).get("banking");
    if (flag === "connected") toast.success("Banco conectado. Você pode consultar a prévia.");
    else if (flag === "error") toast.error("A autorização bancária não foi concluída.");
  }, []);
  useEffect(() => {
    if (!access?.can_connect) return;
    api.get("/banking/institutions", { params: { country } })
      .then(({ data }) => setInstitutions(data))
      .catch((error) => toast.error(formatApiError(error)));
  }, [access?.can_connect, country]);

  const request = async () => {
    setBusy(true);
    try { await api.post("/banking/request"); await load(); toast.success("Solicitação enviada à administradora."); }
    catch (error) { toast.error(formatApiError(error)); }
    finally { setBusy(false); }
  };
  const connect = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const { data } = await api.post("/banking/connect", { institution: selected, country });
      window.location.assign(data.authorization_url);
    } catch (error) { toast.error(formatApiError(error)); setBusy(false); }
  };
  const sync = async (id) => {
    setBusy(true);
    try {
      const { data } = await api.post("/banking/connections/" + encodeURIComponent(id) + "/sync");
      setPreview(data);
      await load();
      toast.success("Prévia bancária consultada. Nenhum lançamento foi criado.");
    } catch (error) { toast.error(formatApiError(error)); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!disconnectId) return;
    setBusy(true);
    try {
      await api.delete("/banking/connections/" + encodeURIComponent(disconnectId));
      setDisconnectId(null);
      await load();
      toast.success("Conexão removida.");
    } catch (error) { toast.error(formatApiError(error)); }
    finally { setBusy(false); }
  };
  const available = institutions.filter((b) => b.name.toLowerCase().includes(search.toLowerCase())).slice(0, 40);

  return (
    <div className="max-w-5xl space-y-6" data-testid="banking-page">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Minhas conexões bancárias</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Sincronização em modo leitura. Os dados não são lançados automaticamente na sua carteira.
        </p>
      </div>
      {!access ? <div className="card-soft p-5" role="status">Carregando acesso...</div> : (
        <div className="card-soft p-5 space-y-3">
          <div className="flex items-center gap-2 font-semibold"><ShieldCheck size={20} /> Permissão bancária</div>
          <p className="text-sm">{ACCESS_LABELS[access.access] || access.access}</p>
          {!access.allowed && access.access !== "pending" && (
            <Button onClick={request} disabled={busy}>Solicitar acesso</Button>
          )}
          {access.allowed && !access.can_connect && (
            <p className="text-sm text-amber-700">
              Seu acesso foi liberado, mas o provedor ainda não foi ativado pela administradora.
            </p>
          )}
          {access.access === "pending" && <p className="text-sm">A administradora precisa aprovar seu pedido.</p>}
        </div>
      )}

      {access?.can_connect && (
        <div className="card-soft p-5 space-y-4">
          <h2 className="font-semibold flex items-center gap-2"><Landmark size={20}/> Conectar novo banco</h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            O banco solicitará seu consentimento no ambiente de autorização da Enable Banking.
          </p>
          <label className="block text-sm space-y-1">
            <span>País</span>
            <select aria-label="País do banco" value={country} onChange={(event) => { setCountry(event.target.value); setSelected(""); }}
              className="rounded-xl border bg-[var(--surface)] p-2" style={{ borderColor: "var(--border)" }}>
              <option value="IT">Itália</option><option value="PT">Portugal</option>
              <option value="ES">Espanha</option><option value="DE">Alemanha</option>
            </select>
          </label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar instituição..." aria-label="Buscar banco" />
          <label className="block text-sm space-y-1">
            <span>Instituição</span>
            <select aria-label="Selecionar banco" value={selected} onChange={(e) => setSelected(e.target.value)}
              className="w-full max-w-lg rounded-xl border bg-[var(--surface)] p-3" style={{ borderColor: "var(--border)" }}>
              <option value="">Selecione...</option>
              {available.map((bank) => <option key={bank.name + bank.country} value={bank.name}>{bank.name}</option>)}
            </select>
          </label>
          <Button disabled={!selected || busy} onClick={connect}>
            <ExternalLink size={16} className="mr-2" /> Autorizar no banco
          </Button>
        </div>
      )}

      {access?.allowed && (
        <div className="card-soft p-5 space-y-4">
          <h2 className="font-semibold">Conexões existentes</h2>
          {connections.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Nenhum banco conectado.</p>}
          {connections.map((connection) => (
            <div key={connection.id} className="rounded-xl border p-4 space-y-2" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{connection.institution} · {connection.country}</p>
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {connection.status === "connected" ? "Conectado" : "Inativo"} · {connection.accounts?.length || 0} conta(s)
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {access.can_connect && connection.status === "connected" && (
                    <Button variant="outline" disabled={busy} onClick={() => sync(connection.id)}>
                      <RefreshCw size={16} className="mr-2" /> Consultar prévia
                    </Button>
                  )}
                  <Button variant="outline" disabled={busy} onClick={() => setDisconnectId(connection.id)}>
                    <Link2Off size={16} className="mr-2" /> Desconectar
                  </Button>
                </div>
              </div>
              {connection.last_sync_at && <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Última consulta: {new Date(connection.last_sync_at).toLocaleString()}
              </p>}
            </div>
          ))}
          {preview && (
            <div className="rounded-xl bg-[var(--bg)] p-4 text-sm" role="status">
              <p className="font-semibold mb-2">Prévia em modo leitura — não afeta saldos</p>
              {preview.accounts.map((account) => (
                <div key={account.uid} className="py-2">
                  <p>{account.transaction_count_first_page} movimentações na primeira página
                    {account.has_more_transactions ? " (existem mais páginas)" : ""}</p>
                  {account.balances.map((balance, index) =>
                    <p key={index}>{balance.type}: {balance.amount} {balance.currency}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog open={Boolean(disconnectId)} onOpenChange={(open) => { if (!open) setDisconnectId(null); }}
        title="Desconectar banco?" description="A sessão será revogada no provedor. Seus lançamentos existentes não serão apagados."
        confirmLabel="Desconectar" onConfirm={disconnect} />
    </div>
  );
}
