import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Bell, CheckCheck, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";

import { translate as tr } from "@/i18n";
function timeAgo(iso) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

const TYPE_LABEL = {
  shared_expense_added: "Despesa compartilhada",
  settlement_paid: "Acerto",
  nudge: "Lembrete",
  group_added: "Grupo",
  linked_receivable_created: "Valor a receber",
  linked_payment_confirmation_requested: "Confirmação de pagamento",
  linked_payment_confirmed: "Pagamento confirmado",
  linked_payment_rejected: "Pagamento não confirmado",
};

export default function Notifications() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [actingId, setActingId] = useState(null);

  const load = () => api.get("/notifications?limit=100").then(r => setItems(r.data || []));
  useEffect(() => { load(); }, []);

  const open = async (n) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`);
    if (n.link) navigate(n.link);
    else load();
  };

  const markRead = async (e, n) => {
    e.stopPropagation();
    await api.post(`/notifications/${n.id}/read`);
    load();
  };

  const remove = async (e, n) => {
    e.stopPropagation();
    await api.delete(`/notifications/${n.id}`);
    setItems(prev => prev.filter(i => i.id !== n.id));
  };

  const markAll = async () => {
    await api.post("/notifications/read-all");
    toast.success(tr("Todas marcadas como lidas"));
    load();
  };

  const respondToPayment = async (e, n, accepted) => {
    e.stopPropagation();
    const transactionId = n.data?.transaction_id;
    if (!transactionId) {
      toast.error(tr("Lançamento vinculado não encontrado"));
      return;
    }
    setActingId(n.id);
    try {
      if (accepted) {
        await api.post(`/transactions/${transactionId}/pay`);
        toast.success(tr("Recebimento confirmado"));
      } else {
        await api.post(`/transactions/${transactionId}/reject-payment`);
        toast.success(tr("Pagamento marcado como não recebido"));
      }
      if (!n.read) await api.post(`/notifications/${n.id}/read`);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setActingId(null);
    }
  };

  const shown = items.filter(n => filter === "all" || !n.read);
  const unreadCount = items.filter(n => !n.read).length;

  return (
    <div className="space-y-6 max-w-3xl" data-testid="notifications-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>{tr("Notificações")}</h1>
          <p className="text-[#6B7068]">{unreadCount > 0 ? `${unreadCount} não lida(s)` : tr("Tudo em dia")}</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAll} data-testid="notif-mark-all"
            className="text-sm text-[#061B4A] hover:bg-[#F1EFE7] rounded-lg px-3 py-2 flex items-center gap-1.5">
            <CheckCheck size={16} /> {tr("Marcar todas")}
          </button>
        )}
      </div>

      <div className="flex gap-2 border-b border-[#E5E4E0]">
        {["all", "unread"].map(f => (
          <button key={f} onClick={() => setFilter(f)} data-testid={`notif-filter-${f}`}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${filter === f ? "border-[#061B4A] text-[#061B4A]" : "border-transparent text-[#6B7068] hover:text-[#061B4A]"}`}>
            {f === "all" ? tr("Todas") : tr("Não lidas")}
          </button>
        ))}
      </div>

      <div className="card-soft p-0 overflow-hidden">
        {shown.length === 0 && (
          <div className="text-center text-[#6B7068] py-16 flex flex-col items-center gap-2">
            <Bell size={28} className="opacity-40" />
            <span>{tr("Nenhuma notificação")}{filter === "unread" ? ` ${tr("não lida")}` : ""}.</span>
          </div>
        )}
        {shown.map(n => (
          <div key={n.id} onClick={() => open(n)} data-testid={`notif-item-${n.id}`}
            className={`flex items-start gap-3 p-4 border-b border-[#E5E4E0] last:border-0 cursor-pointer hover:bg-[#F1EFE7] transition-colors ${!n.read ? "bg-[#F9F6F0]" : ""}`}>
            {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-[#D96C5B] flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[#1A1C1A]">{n.title}</span>
                <span className="text-[10px] uppercase tracking-wide text-[#6B7068] bg-[#F1EFE7] rounded px-1.5 py-0.5">{TYPE_LABEL[n.type] || n.type}</span>
              </div>
              <div className="text-sm text-[#6B7068] mt-0.5">{n.message}</div>
              {n.type === "linked_payment_confirmation_requested" && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    onClick={(e) => respondToPayment(e, n, true)}
                    disabled={actingId === n.id}
                    data-testid={`notif-payment-confirm-${n.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Check size={14} /> {tr("Confirmar recebimento")}
                  </button>
                  <button
                    onClick={(e) => respondToPayment(e, n, false)}
                    disabled={actingId === n.id}
                    data-testid={`notif-payment-reject-${n.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#D9453B] px-3 py-1.5 text-xs font-medium text-[#D9453B] hover:bg-red-50 disabled:opacity-50"
                  >
                    <X size={14} /> {tr("Não recebi")}
                  </button>
                </div>
              )}
              <div className="text-[11px] text-[#6B7068] mt-1">{timeAgo(n.created_at)}</div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {!n.read && (
                <button onClick={(e) => markRead(e, n)} data-testid={`notif-read-${n.id}`}
                  className="p-1.5 rounded-lg text-[#6B7068] hover:bg-white hover:text-[#061B4A]" title={tr("Marcar como lida")}>
                  <Check size={15} />
                </button>
              )}
              <button onClick={(e) => remove(e, n)} data-testid={`notif-delete-${n.id}`}
                className="p-1.5 rounded-lg text-[#6B7068] hover:bg-white hover:text-[#D9453B]" title={tr("Excluir")}>
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
