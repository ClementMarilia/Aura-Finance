import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { Bell, Check, CheckCheck } from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

function timeAgo(iso) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export default function NotificationsBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);

  const loadCount = () => {
    api.get("/notifications/unread-count")
      .then(r => setCount(r.data.count || 0))
      .catch(() => {});
  };
  const loadItems = () => {
    api.get("/notifications").then(r => setItems(r.data || []));
  };

  useEffect(() => {
    loadCount();
    const id = setInterval(loadCount, 30000);
    return () => clearInterval(id);
  }, []);

  const onOpenChange = (v) => {
    setOpen(v);
    if (v) loadItems();
  };

  const openItem = async (n) => {
    if (!n.read) {
      await api.post(`/notifications/${n.id}/read`);
    }
    setOpen(false);
    if (n.link) navigate(n.link);
    loadCount();
  };

  const markAll = async () => {
    await api.post("/notifications/read-all");
    loadCount();
    loadItems();
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          data-testid="notifications-bell"
          className="relative p-2 rounded-lg text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#1E3F33] transition-colors"
          aria-label="Notificações"
        >
          <Bell size={18} />
          {count > 0 && (
            <span
              data-testid="notifications-count"
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-[#D96C5B] text-white text-[10px] font-semibold flex items-center justify-center px-1"
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" sideOffset={8}>
        <div className="flex items-center justify-between p-3 border-b border-[#E5E4E0]">
          <div className="font-semibold" style={{ fontFamily: "Outfit" }}>Notificações</div>
          {items.some(i => !i.read) && (
            <button
              onClick={markAll}
              data-testid="notifications-mark-all"
              className="text-xs text-[#1E3F33] hover:underline flex items-center gap-1"
            >
              <CheckCheck size={12} /> Marcar todas
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 && (
            <div className="text-center text-sm text-[#6B7068] py-10 px-4">
              Sem notificações.
            </div>
          )}
          {items.map(n => (
            <button
              key={n.id}
              onClick={() => openItem(n)}
              data-testid={`notification-${n.id}`}
              className={`w-full text-left p-3 border-b border-[#E5E4E0] hover:bg-[#F1EFE7] transition-colors ${
                !n.read ? "bg-[#F9F6F0]" : ""
              }`}
            >
              <div className="flex items-start gap-2">
                {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-[#D96C5B] flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#1A1C1A]">{n.title}</div>
                  <div className="text-xs text-[#6B7068] mt-0.5 line-clamp-3">{n.message}</div>
                  <div className="text-[10px] text-[#6B7068] mt-1">{timeAgo(n.created_at)}</div>
                </div>
                {n.read && <Check size={12} className="text-[#6B7068] mt-1" />}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
