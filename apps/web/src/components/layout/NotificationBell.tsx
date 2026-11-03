import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DropdownMenu } from "radix-ui";
import { Bell } from "lucide-react";
import { api } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { cn, formatRelative } from "@/lib/utils";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "../ui/button";

interface Notif { id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }

/** Lembretes internos (tarefas vencendo). Chegam em tempo real; a consulta de 2 min é só reserva. */
export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me } = useAuth();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: Notif[]; unread: number }>("/api/workspace/notifications"), refetchInterval: 120_000 });
  useRealtime({
    "notification:new": ({ userId }: { userId: string }) => {
      if (userId === me?.user.id) void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const read = useMutation({
    mutationFn: (id?: string) => api("/api/workspace/notifications/read", { method: "POST", body: id ? { id } : {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const unread = q.data?.unread ?? 0;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notificações${unread ? ` (${unread} não lidas)` : ""}`}>
          <Bell />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-80 rounded-xl border bg-surface p-1.5 shadow-xl">
          <div className="flex items-center justify-between px-2.5 py-2">
            <p className="text-sm font-semibold">Notificações</p>
            {unread > 0 && <button type="button" className="text-xs text-primary hover:underline" onClick={() => read.mutate(undefined)}>Marcar todas como lidas</button>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!q.data?.items.length && <p className="px-2.5 py-6 text-center text-sm text-muted">Nenhuma notificação.</p>}
            {q.data?.items.map((n) => (
              <DropdownMenu.Item key={n.id} onSelect={() => { if (!n.readAt) read.mutate(n.id); if (n.link) navigate(n.link); }}
                className={cn("cursor-pointer rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface-muted", !n.readAt && "bg-primary-soft/60")}>
                <p className="font-medium">{n.title}</p>
                {n.body && <p className="text-xs text-muted">{n.body}</p>}
                <p className="mt-0.5 text-[11px] text-muted">{formatRelative(n.createdAt)}</p>
              </DropdownMenu.Item>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
