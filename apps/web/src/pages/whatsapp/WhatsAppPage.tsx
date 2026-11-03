import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, LogOut, QrCode, RefreshCw, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useState } from "react";

export interface WaStatus {
  provider: string;
  status: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "RECONNECT_REQUIRED" | "ERROR";
  phoneNumber: string | null;
  displayName: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  qr: string | null;
  logs: { id: string; level: string; message: string; createdAt: string }[];
}
interface Usage { sentToday: number; dailyLimit: number; intervalSec: number; maxUnanswered: number; queued: number }
interface Suppressed { id: string; phoneE164: string | null; reason: string; source: string; createdAt: string }

const STATUS: Record<WaStatus["status"], { label: string; tone: "neutral" | "warning" | "success" | "danger" | "primary" }> = {
  DISCONNECTED: { label: "Desconectado", tone: "neutral" },
  CONNECTING: { label: "Conectando", tone: "primary" },
  CONNECTED: { label: "Conectado", tone: "success" },
  RECONNECT_REQUIRED: { label: "Reconexão necessária", tone: "warning" },
  ERROR: { label: "Erro", tone: "danger" },
};

export function WhatsAppPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["whatsapp", "status"], queryFn: () => api<WaStatus>("/api/whatsapp/status") });
  const usage = useQuery({ queryKey: ["whatsapp", "usage"], queryFn: () => api<Usage>("/api/whatsapp/usage") });
  const blocked = useQuery({ queryKey: ["whatsapp", "suppression"], queryFn: () => api<Suppressed[]>("/api/whatsapp/suppression") });
  const [confirmLogout, setConfirmLogout] = useState(false);

  // QR e status chegam em tempo real: o QR do WhatsApp troca a cada ~20s.
  useRealtime({
    "whatsapp:status": (s: WaStatus) => qc.setQueryData<WaStatus>(["whatsapp", "status"], (prev) => ({ ...s, qr: s.qr ?? (s.status === "CONNECTING" ? prev?.qr ?? null : null) })),
    "whatsapp:qr": ({ qr }: { qr: string }) => qc.setQueryData<WaStatus>(["whatsapp", "status"], (prev) => (prev ? { ...prev, qr, status: "CONNECTING" } : prev)),
  });

  const action = useMutation({
    mutationFn: (a: "connect" | "reconnect" | "disconnect") => api<WaStatus>(`/api/whatsapp/${a}`, { method: "POST" }),
    onSuccess: (s) => {
      qc.setQueryData(["whatsapp", "status"], s);
      setConfirmLogout(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const unblock = useMutation({
    mutationFn: (id: string) => api(`/api/whatsapp/suppression/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["whatsapp", "suppression"] }),
    onError: (e) => toast.error(e.message),
  });

  const s = status.data;
  const meta = s ? STATUS[s.status] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
          <p className="mt-1 text-sm text-muted">Conexão por QR Code, como o WhatsApp Web.</p>
        </div>
        <Button asChild variant="secondary"><Link to="/mensagens">Abrir Central de Mensagens</Link></Button>
      </div>

      <Card className="flex gap-3 border-warning/40 bg-warning/5 p-4 text-sm">
        <AlertTriangle className="size-5 shrink-0 text-warning" />
        <p>
          Esta conexão não usa a API oficial da Meta. Para não colocar o número em risco de bloqueio: use um <strong>número dedicado</strong>,
          fale com poucas empresas por dia, de forma individual e relevante, e respeite quem pedir para sair. Os limites abaixo existem para isso.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Conexão</CardTitle>
              <CardDescription>{s?.lastSyncAt ? `Última sincronização ${formatDateTime(s.lastSyncAt)}` : "Nunca conectado"}</CardDescription>
            </div>
            {meta && <Badge tone={meta.tone}>{meta.label}</Badge>}
          </CardHeader>
          <CardContent>
            {status.isPending ? (
              <Skeleton className="h-72" />
            ) : s?.status === "CONNECTED" ? (
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <div className="flex size-16 items-center justify-center rounded-full bg-success/10"><CheckCircle2 className="size-8 text-success" /></div>
                <div>
                  <p className="text-lg font-semibold">{s.phoneNumber ?? "Número conectado"}</p>
                  {s.displayName && <p className="text-sm text-muted">{s.displayName}</p>}
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" loading={action.isPending && action.variables === "reconnect"} onClick={() => action.mutate("reconnect")}><RefreshCw /> Reconectar</Button>
                  <Button variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setConfirmLogout(true)}><LogOut /> Desconectar</Button>
                </div>
              </div>
            ) : s?.status === "CONNECTING" ? (
              <div className="grid items-center gap-6 py-4 md:grid-cols-[auto_1fr]">
                <div className="mx-auto flex size-64 items-center justify-center rounded-2xl border bg-white p-3">
                  {s.qr ? <img src={s.qr} alt="QR Code para conectar o WhatsApp" className="size-full [image-rendering:pixelated]" /> : <Loader2 className="size-8 animate-spin text-primary" />}
                </div>
                <ol className="space-y-3 text-sm">
                  {["Abra o WhatsApp no celular do número que vai usar.", "Toque em ⋮ (Android) ou Configurações (iPhone) → Aparelhos conectados.", "Toque em Conectar um aparelho e aponte a câmera para o QR Code."].map((t, i) => (
                    <li key={t} className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{i + 1}</span>{t}</li>
                  ))}
                  <li className="pl-9 text-xs text-muted">{s.qr ? "O código se renova sozinho a cada ~20 segundos." : "Gerando o código…"}</li>
                </ol>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 py-10 text-center">
                <div className="flex size-16 items-center justify-center rounded-full bg-surface-muted"><Smartphone className="size-8 text-muted" /></div>
                <div>
                  <p className="font-semibold">{s?.status === "RECONNECT_REQUIRED" ? "A conexão caiu e não voltou" : s?.status === "ERROR" ? "Falha ao conectar" : "Nenhum WhatsApp conectado"}</p>
                  {s?.lastError && <p className="mt-1 max-w-md text-xs text-danger">{s.lastError}</p>}
                </div>
                <div className="flex gap-2">
                  <Button loading={action.isPending && action.variables === "connect"} onClick={() => action.mutate("connect")}><QrCode /> Conectar WhatsApp</Button>
                  {s?.status === "RECONNECT_REQUIRED" && <Button variant="secondary" onClick={() => action.mutate("reconnect")}><RefreshCw /> Tentar reconectar</Button>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-success" /> Proteção de volume</CardTitle>
                <CardDescription>Ajuste em Configurações → Prospecção.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {usage.data ? (
                <>
                  <div>
                    <div className="mb-1 flex justify-between"><span className="text-muted">Enviadas hoje</span><span className="font-medium tabular-nums">{usage.data.sentToday} / {usage.data.dailyLimit}</span></div>
                    <div className="h-1.5 rounded-full bg-surface-muted"><div className={cn("h-full rounded-full", usage.data.sentToday / usage.data.dailyLimit > 0.8 ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(100, (usage.data.sentToday / usage.data.dailyLimit) * 100)}%` }} /></div>
                  </div>
                  <p className="flex justify-between"><span className="text-muted">Intervalo mínimo</span><span className="font-medium">{usage.data.intervalSec}s</span></p>
                  <p className="flex justify-between"><span className="text-muted">Máx. sem resposta</span><span className="font-medium">{usage.data.maxUnanswered} mensagens</span></p>
                  <p className="flex justify-between"><span className="text-muted">Na fila agora</span><span className="font-medium">{usage.data.queued}</span></p>
                </>
              ) : <Skeleton className="h-28" />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Logs da conexão</CardTitle></CardHeader>
            <CardContent>
              <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
                {s?.logs.length ? s.logs.map((l) => (
                  <li key={l.id} className="flex gap-2">
                    <span className="shrink-0 tabular-nums text-muted">{new Date(l.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                    <span className={cn(l.level === "error" && "text-danger", l.level === "warn" && "text-warning")}>{l.message}</span>
                  </li>
                )) : <li className="text-muted">Sem eventos ainda.</li>}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Lista de bloqueio</CardTitle>
            <CardDescription>Contatos que pediram para não receber mensagens. O sistema nunca envia para eles.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {!blocked.data?.length ? <p className="text-sm text-muted">Ninguém na lista.</p> : (
            <ul className="divide-y text-sm">
              {blocked.data.map((b) => (
                <li key={b.id} className="flex items-center gap-3 py-2">
                  <span className="font-medium tabular-nums">{b.phoneE164}</span>
                  <span className="flex-1 truncate text-muted">{b.reason}</span>
                  <Badge>{b.source === "opt_out" ? "Pediu para sair" : "Manual"}</Badge>
                  <button type="button" className="text-muted hover:text-danger" aria-label="Remover da lista" onClick={() => unblock.mutate(b.id)}><Trash2 className="size-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog open={confirmLogout} onOpenChange={setConfirmLogout} title="Desconectar o WhatsApp?" destructive confirmLabel="Desconectar"
        description="A sessão é encerrada no celular também. Para voltar, será preciso ler um novo QR Code. Mensagens na fila não serão enviadas."
        loading={action.isPending && action.variables === "disconnect"} onConfirm={() => action.mutate("disconnect")} />
    </div>
  );
}
