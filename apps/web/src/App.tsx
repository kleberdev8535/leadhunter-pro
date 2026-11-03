import { lazy, Suspense } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "./auth/AuthProvider";
import { AppShell } from "./components/layout/AppShell";
import { NAV, isAvailable } from "./components/layout/nav";
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from "./pages/auth/AuthPages";
const DashboardPage = lazy(() => import("./pages/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const OfficePage = lazy(() => import("./office/OfficePage").then((m) => ({ default: m.OfficePage })));
const CrmPage = lazy(() => import("./pages/crm/CrmPage").then((m) => ({ default: m.CrmPage })));
const FindLeadsPage = lazy(() => import("./pages/leads/FindLeadsPage").then((m) => ({ default: m.FindLeadsPage })));
const WhatsAppPage = lazy(() => import("./pages/whatsapp/WhatsAppPage").then((m) => ({ default: m.WhatsAppPage })));
const MessagesPage = lazy(() => import("./pages/messages/MessagesPage").then((m) => ({ default: m.MessagesPage })));
const AgendaPage = lazy(() => import("./pages/agenda/AgendaPage").then((m) => ({ default: m.AgendaPage })));
const ReportsPage = lazy(() => import("./pages/reports/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
import { ComingSoonPage } from "./pages/ComingSoonPage";
import { Button } from "./components/ui/button";

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Carregando">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  );
}

function Protected() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullScreenLoader />;
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppShell />;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullScreenLoader />;
  // Ao autenticar, volta para a página que o usuário tentou abrir antes do login.
  if (status === "authenticated") {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from.startsWith("/") && !from.startsWith("//") ? from : "/"} replace />;
  }
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-5xl font-semibold text-primary">404</p>
      <p className="mt-2 text-sm text-muted">Página não encontrada.</p>
      <Button asChild variant="secondary" className="mt-6">
        <Link to="/">Ir para o Dashboard</Link>
      </Button>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/cadastro" element={<PublicOnly><RegisterPage /></PublicOnly>} />
      <Route path="/esqueci-senha" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
      <Route element={<Protected />}>
        <Route index element={<Suspense fallback={<FullScreenLoader />}><DashboardPage /></Suspense>} />
        <Route path="escritorio" element={<Suspense fallback={<FullScreenLoader />}><OfficePage /></Suspense>} />
        <Route path="crm" element={<Suspense fallback={<FullScreenLoader />}><CrmPage /></Suspense>} />
        <Route path="leads/buscar" element={<Suspense fallback={<FullScreenLoader />}><FindLeadsPage /></Suspense>} />
        <Route path="whatsapp" element={<Suspense fallback={<FullScreenLoader />}><WhatsAppPage /></Suspense>} />
        <Route path="mensagens" element={<Suspense fallback={<FullScreenLoader />}><MessagesPage /></Suspense>} />
        <Route path="agenda" element={<Suspense fallback={<FullScreenLoader />}><AgendaPage /></Suspense>} />
        <Route path="relatorios" element={<Suspense fallback={<FullScreenLoader />}><ReportsPage /></Suspense>} />
        <Route path="configuracoes" element={<Suspense fallback={<FullScreenLoader />}><SettingsPage /></Suspense>} />
        {NAV.filter((n) => !isAvailable(n)).map((n) => (
          <Route key={n.to} path={n.to.slice(1)} element={<ComingSoonPage item={n} />} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
