import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { DropdownMenu } from "radix-ui";
import { Crosshair, LogOut, Menu, Moon, Search, Settings, Sun, X } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/lib/theme";
import { cn, initials } from "@/lib/utils";
import { Button } from "../ui/button";
import { Kbd } from "../ui/primitives";
import { ErrorBoundary } from "../states";
import { CommandPalette } from "./CommandPalette";
import { NotificationBell } from "./NotificationBell";
import { NAV, isAvailable } from "./nav";

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] shadow-lg shadow-indigo-500/30">
        <Crosshair className="size-4 text-white" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-white">LeadHunter</p>
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-indigo-300">Pro</p>
      </div>
    </div>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="mt-8 flex flex-1 flex-col gap-0.5" aria-label="Principal">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
              isActive ? "bg-sidebar-active text-white" : "text-sidebar-foreground hover:bg-white/5 hover:text-white",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="nav-indicator"
                  className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-indigo-400"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <item.icon className={cn("size-4", isActive ? "text-indigo-300" : "opacity-70 group-hover:opacity-100")} />
              <span className="flex-1">{item.label}</span>
              {!isAvailable(item) && (
                <span className="rounded-full bg-white/5 px-1.5 py-px text-[10px] text-slate-500">E{item.stage}</span>
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const { me, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Atalhos: Ctrl/⌘+K abre a pesquisa; "g d" / "g s" navegam.
  useEffect(() => {
    let lastG = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "g") lastG = Date.now();
      else if (Date.now() - lastG < 800) {
        if (e.key === "d") navigate("/");
        if (e.key === "s") navigate("/configuracoes");
        lastG = 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-sidebar px-3 py-5 lg:flex">
        <Brand />
        <SidebarNav />
        <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.03] p-3">
          <p className="text-[11px] font-medium text-slate-300">{me?.organization.name}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Etapas 1–6 + AI Office</p>
        </div>
      </aside>

      {/* Sidebar mobile */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar px-3 py-5 lg:hidden"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 40 }}
            >
              <div className="flex items-center justify-between">
                <Brand />
                <Button variant="ghost" size="icon" className="text-slate-400" onClick={() => setMobileOpen(false)} aria-label="Fechar menu">
                  <X />
                </Button>
              </div>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu />
          </Button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-10 w-full max-w-md items-center gap-2.5 rounded-lg border bg-surface px-3 text-sm text-muted shadow-xs transition-colors hover:border-primary/40"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Pesquisar…</span>
            <Kbd className="hidden sm:inline">Ctrl K</Kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}>
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            <NotificationBell />
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="ml-1 flex items-center gap-2 rounded-full p-0.5 pr-2 transition-colors hover:bg-surface-muted"
                  aria-label="Menu do usuário"
                >
                  {me?.user.avatarUrl ? (
                    <img src={me.user.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
                  ) : (
                    <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] text-xs font-semibold text-white">
                      {initials(me?.user.name ?? "")}
                    </span>
                  )}
                  <span className="hidden text-sm font-medium md:inline">{me?.user.name.split(" ")[0]}</span>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  className="z-50 min-w-56 rounded-xl border bg-surface p-1.5 shadow-xl"
                >
                  <div className="px-2.5 py-2">
                    <p className="text-sm font-medium">{me?.user.name}</p>
                    <p className="truncate text-xs text-muted">{me?.user.email}</p>
                  </div>
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  <DropdownMenu.Item
                    onSelect={() => navigate("/configuracoes")}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface-muted"
                  >
                    <Settings className="size-4 text-muted" /> Configurações
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => void logout()}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-danger outline-none data-[highlighted]:bg-danger/10"
                  >
                    <LogOut className="size-4" /> Sair
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="mx-auto max-w-7xl"
            >
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
