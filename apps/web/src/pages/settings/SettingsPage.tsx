import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { KeyRound, Laptop, ShieldCheck, Smartphone, User } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { ApiError, api } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Skeleton } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/states";
import { passwordRule } from "../auth/schemas";
import { GoogleMapsSection, ProspectingSection } from "./IntegrationSections";

import { AuditSection, CrmSettingsSection, WhatsAppSettingsSection } from "./WorkspaceSections";

const READY_TABS = new Set(["perfil", "seguranca", "google", "prospeccao", "crm", "whatsapp"]);

const TABS = [
  { id: "perfil", label: "Perfil", stage: 1 },
  { id: "seguranca", label: "Segurança", stage: 1 },
  { id: "google", label: "Google Maps", stage: 2 },
  { id: "prospeccao", label: "Prospecção", stage: 2 },
  { id: "crm", label: "CRM", stage: 3 },
  { id: "whatsapp", label: "WhatsApp", stage: 4 },
] as const;
type TabId = (typeof TABS)[number]["id"];

const profileSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome").max(120),
  avatarUrl: z.union([z.literal(""), z.string().trim().url("URL inválida").max(500)]),
});

const passwordSchema = z
  .object({ currentPassword: z.string().min(1, "Informe a senha atual"), newPassword: passwordRule, confirm: z.string() })
  .refine((d) => d.newPassword === d.confirm, { path: ["confirm"], message: "As senhas não coincidem" });

function ProfileSection() {
  const { me, reloadMe } = useAuth();
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: { name: me?.user.name ?? "", avatarUrl: me?.user.avatarUrl ?? "" },
  });
  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await api("/api/auth/me", { method: "PATCH", body: { name: data.name, avatarUrl: data.avatarUrl || null } });
      await reloadMe();
      toast.success("Perfil atualizado");
    } catch (err) {
      toast.error((err as Error).message);
    }
  });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Perfil</CardTitle>
          <CardDescription>Como você aparece para a sua equipe.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid max-w-xl gap-4" noValidate>
          <Field label="Nome" htmlFor="name" error={form.formState.errors.name?.message}>
            <Input id="name" aria-invalid={!!form.formState.errors.name} {...form.register("name")} />
          </Field>
          <Field label="Email" htmlFor="email" hint={<span className="text-xs text-muted">Não editável</span>}>
            <Input id="email" value={me?.user.email ?? ""} disabled readOnly />
          </Field>
          <Field label="URL da foto" htmlFor="avatarUrl" error={form.formState.errors.avatarUrl?.message}>
            <Input id="avatarUrl" placeholder="https://…" aria-invalid={!!form.formState.errors.avatarUrl} {...form.register("avatarUrl")} />
          </Field>
          <div>
            <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
              Salvar alterações
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordSection() {
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
  });
  const qc = useQueryClient();
  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: { currentPassword: data.currentPassword, newPassword: data.newPassword },
      });
      form.reset();
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      toast.success("Senha alterada. As outras sessões foram encerradas.");
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_PASSWORD") {
        form.setError("currentPassword", { message: err.message });
      } else toast.error((err as Error).message);
    }
  });
  const e = form.formState.errors;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Senha</CardTitle>
          <CardDescription>Ao trocar a senha, as outras sessões são encerradas.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid max-w-xl gap-4" noValidate>
          <Field label="Senha atual" htmlFor="currentPassword" error={e.currentPassword?.message}>
            <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register("currentPassword")} />
          </Field>
          <Field label="Nova senha" htmlFor="newPassword" error={e.newPassword?.message}>
            <Input id="newPassword" type="password" autoComplete="new-password" {...form.register("newPassword")} />
          </Field>
          <Field label="Confirmar nova senha" htmlFor="confirm" error={e.confirm?.message}>
            <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
          </Field>
          <div>
            <Button type="submit" loading={form.formState.isSubmitting}>
              <KeyRound /> Alterar senha
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}
interface AccessRow {
  id: string;
  action: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

const ACCESS_LABEL: Record<string, { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  "auth.login": { label: "Login", tone: "success" },
  "auth.register": { label: "Conta criada", tone: "success" },
  "auth.login_failed": { label: "Senha incorreta", tone: "danger" },
  "auth.login_locked": { label: "Conta bloqueada", tone: "danger" },
  "auth.password_changed": { label: "Senha alterada", tone: "warning" },
  "auth.password_reset": { label: "Senha redefinida", tone: "warning" },
  "auth.password_reset_requested": { label: "Recuperação solicitada", tone: "neutral" },
  "auth.session_revoked": { label: "Sessão encerrada", tone: "neutral" },
};

function describeAgent(ua: string | null) {
  if (!ua) return "Dispositivo desconhecido";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` · ${os}` : ""}`;
}

function SecuritySection() {
  const qc = useQueryClient();
  const [toRevoke, setToRevoke] = useState<SessionRow | null>(null);
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api<SessionRow[]>("/api/auth/sessions") });
  const history = useQuery({ queryKey: ["access-history"], queryFn: () => api<AccessRow[]>("/api/auth/access-history") });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/auth/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Sessão encerrada");
      setToRevoke(null);
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      void qc.invalidateQueries({ queryKey: ["access-history"] });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Sessões ativas</CardTitle>
            <CardDescription>Dispositivos conectados à sua conta.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {sessions.isPending ? (
            <Skeleton className="h-24" />
          ) : sessions.isError ? (
            <ErrorState message={sessions.error.message} onRetry={() => void sessions.refetch()} />
          ) : (
            <ul className="divide-y">
              {sessions.data.map((s) => {
                const mobile = /Android|iPhone|iPad/.test(s.userAgent ?? "");
                const Icon = mobile ? Smartphone : Laptop;
                return (
                  <li key={s.id} className="flex items-center gap-3 py-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-surface-muted text-muted">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="flex items-center gap-2 font-medium">
                        {describeAgent(s.userAgent)} {s.current && <Badge tone="success">Esta sessão</Badge>}
                      </p>
                      <p className="text-xs text-muted">
                        IP {s.ip ?? "—"} · último uso {formatDateTime(s.lastUsedAt)}
                      </p>
                    </div>
                    {!s.current && (
                      <Button variant="secondary" size="sm" onClick={() => setToRevoke(s)}>
                        Encerrar
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Histórico de acessos</CardTitle>
            <CardDescription>Últimos 50 eventos de autenticação da sua conta.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {history.isPending ? (
            <Skeleton className="h-32" />
          ) : history.isError ? (
            <ErrorState message={history.error.message} onRetry={() => void history.refetch()} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-2 font-medium">Evento</th>
                    <th className="pb-2 font-medium">Dispositivo</th>
                    <th className="pb-2 font-medium">IP</th>
                    <th className="pb-2 text-right font-medium">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((h) => {
                    const meta = ACCESS_LABEL[h.action] ?? { label: h.action, tone: "neutral" as const };
                    return (
                      <tr key={h.id} className="border-t">
                        <td className="py-2">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </td>
                        <td className="py-2 text-muted">{describeAgent(h.userAgent)}</td>
                        <td className="py-2 tabular-nums text-muted">{h.ip ?? "—"}</td>
                        <td className="py-2 text-right tabular-nums text-muted">{formatDateTime(h.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!toRevoke}
        onOpenChange={(o) => !o && setToRevoke(null)}
        title="Encerrar sessão?"
        description={`O dispositivo "${describeAgent(toRevoke?.userAgent ?? null)}" precisará fazer login novamente.`}
        confirmLabel="Encerrar sessão"
        destructive
        loading={revoke.isPending}
        onConfirm={() => toRevoke && revoke.mutate(toRevoke.id)}
      />
    </>
  );
}

export function SettingsPage() {
  const { me } = useAuth();
  const [tab, setTab] = useState<TabId>(() => (sessionStorage.getItem("lh-settings-tab") as TabId) ?? "perfil");
  const select = (id: TabId) => {
    setTab(id);
    sessionStorage.setItem("lh-settings-tab", id);
  };
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="mt-1 text-sm text-muted">Conta, segurança e integrações.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Seções" className="flex gap-1 overflow-x-auto lg:flex-col">
          {TABS.map((t) => {
            const available = READY_TABS.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => select(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  tab === t.id ? "bg-surface font-medium text-foreground shadow-xs ring-1 ring-border" : "text-muted hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-2">
                  {t.id === "perfil" && <User className="size-4" />}
                  {t.id === "seguranca" && <ShieldCheck className="size-4" />}
                  {t.label}
                </span>
                {!available && <span className="text-[10px] text-muted">E{t.stage}</span>}
              </button>
            );
          })}
        </nav>
        <div className="space-y-6">
          {tab === "perfil" && <ProfileSection />}
          {tab === "perfil" && <PasswordSection />}
          {tab === "seguranca" && <SecuritySection />}
          {tab === "google" && <GoogleMapsSection />}
          {tab === "prospeccao" && <ProspectingSection />}
          {tab === "crm" && <CrmSettingsSection />}
          {tab === "whatsapp" && <WhatsAppSettingsSection />}
          {tab === "seguranca" && me?.role !== "MEMBER" && <AuditSection />}
          {!READY_TABS.has(current.id) && (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-sm font-medium">{current.label}</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                  Esta seção é entregue na Etapa {current.stage}, junto com o módulo que ela configura. O banco já tem a
                  estrutura para guardar as credenciais criptografadas.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
