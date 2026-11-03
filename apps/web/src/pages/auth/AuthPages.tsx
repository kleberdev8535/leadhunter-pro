import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useForm, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import type { z } from "zod";
import { useAuth } from "@/auth/AuthProvider";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { AuthLayout } from "./AuthLayout";
import { forgotSchema, loginSchema, registerSchema, resetSchema } from "./schemas";

/** Mostra erros de validação do backend nos campos certos; o restante vira toast. */
function applyServerError<T extends FieldValues>(form: UseFormReturn<T>, err: unknown) {
  if (err instanceof ApiError && err.details?.length) {
    err.details.forEach((d) => form.setError(d.path as Path<T>, { message: d.message }));
    return;
  }
  toast.error(err instanceof Error ? err.message : "Erro inesperado");
}

function TextField<T extends FieldValues>({
  form,
  name,
  label,
  type = "text",
  autoComplete,
  hint,
}: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  type?: string;
  autoComplete?: string;
  hint?: React.ReactNode;
}) {
  const [show, setShow] = useState(false);
  const error = form.formState.errors[name]?.message as string | undefined;
  const isPassword = type === "password";
  return (
    <Field label={label} htmlFor={name} error={error} hint={hint}>
      <div className="relative">
        <Input
          id={name}
          type={isPassword && show ? "text" : type}
          autoComplete={autoComplete}
          aria-invalid={!!error}
          aria-describedby={error ? `${name}-error` : undefined}
          className={isPassword ? "pr-10" : undefined}
          {...form.register(name)}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-foreground"
            aria-label={show ? "Ocultar senha" : "Mostrar senha"}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
    </Field>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await login(data.email, data.password);
      const from = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(from, { replace: true });
    } catch (err) {
      applyServerError(form, err);
    }
  });

  return (
    <AuthLayout title="Entrar" subtitle="Acesse sua central de prospecção.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField form={form} name="email" label="Email" type="email" autoComplete="email" />
        <TextField
          form={form}
          name="password"
          label="Senha"
          type="password"
          autoComplete="current-password"
          hint={
            <Link to="/esqueci-senha" className="text-xs font-medium text-primary hover:underline">
              Esqueci a senha
            </Link>
          }
        />
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
          Entrar
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Ainda não tem conta?{" "}
        <Link to="/cadastro" className="font-medium text-primary hover:underline">
          Criar conta
        </Link>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", organizationName: "", email: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await register(data);
      toast.success("Conta criada. Bem-vindo ao LeadHunter Pro!");
      navigate("/", { replace: true });
    } catch (err) {
      applyServerError(form, err);
    }
  });

  return (
    <AuthLayout title="Criar conta" subtitle="Comece a organizar sua prospecção em minutos.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField form={form} name="name" label="Seu nome" autoComplete="name" />
        <TextField form={form} name="organizationName" label="Empresa" autoComplete="organization" />
        <TextField form={form} name="email" label="Email" type="email" autoComplete="email" />
        <TextField form={form} name="password" label="Senha" type="password" autoComplete="new-password" />
        <p className="text-xs text-muted">Mínimo de 8 caracteres, com letras e números.</p>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
          Criar conta
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Já tem conta?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await api("/api/auth/forgot-password", { method: "POST", body: data });
      setSent(true);
    } catch (err) {
      applyServerError(form, err);
    }
  });

  return (
    <AuthLayout title="Recuperar senha" subtitle="Enviaremos um link para você criar uma nova senha.">
      {sent ? (
        <div className="rounded-xl border bg-surface p-5 text-sm">
          <MailCheck className="mb-3 size-6 text-success" />
          <p className="font-medium">Verifique seu email</p>
          <p className="mt-1 text-muted">
            Se existir uma conta com este email, você receberá as instruções. O link vale por 30 minutos.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <TextField form={form} name="email" label="Email" type="email" autoComplete="email" />
          <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
            Enviar link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="font-medium text-primary hover:underline">
          Voltar para o login
        </Link>
      </p>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { password: "", confirm: "" } });

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await api("/api/auth/reset-password", { method: "POST", body: { token, password: data.password } });
      toast.success("Senha alterada. Entre com a nova senha.");
      navigate("/login", { replace: true });
    } catch (err) {
      applyServerError(form, err);
    }
  });

  return (
    <AuthLayout title="Nova senha" subtitle="Escolha uma senha forte que você não usa em outros sites.">
      {!token ? (
        <p className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          Link incompleto. Abra o link recebido por email ou solicite um novo.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <TextField form={form} name="password" label="Nova senha" type="password" autoComplete="new-password" />
          <TextField form={form} name="confirm" label="Confirmar senha" type="password" autoComplete="new-password" />
          <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
            Salvar nova senha
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/esqueci-senha" className="font-medium text-primary hover:underline">
          Solicitar novo link
        </Link>
      </p>
    </AuthLayout>
  );
}
