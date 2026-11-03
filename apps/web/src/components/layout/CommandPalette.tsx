import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useNavigate } from "react-router";
import { Dialog as D } from "radix-ui";
import { Building, CalendarClock, CornerDownLeft, Search } from "lucide-react";
import { NAV, isAvailable } from "./nav";
import { Badge, Kbd } from "../ui/primitives";
import { cn } from "@/lib/utils";

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Pesquisa global. Na Etapa 1 navega entre módulos; a busca em leads, tarefas e conversas
 * entra junto com os respectivos módulos (Etapas 3–5).
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const search = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api<{ leads: { id: string; companyName: string; city: string | null; stage: { name: string } }[]; tasks: { id: string; title: string; leadId: string | null }[] }>(`/api/workspace/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2,
  });
  // Páginas + leads + tarefas numa lista só, navegável pelo teclado.
  const results = useMemo(() => {
    const pages = NAV.filter((n) => normalize(n.label).includes(normalize(query))).map((n) => ({ key: n.to, to: n.to, label: n.label, icon: n.icon, hint: isAvailable(n) ? null : `Etapa ${n.stage}` }));
    const leads = (search.data?.leads ?? []).map((l) => ({ key: `lead-${l.id}`, to: `/crm?lead=${l.id}`, label: l.companyName, icon: Building, hint: [l.city, l.stage.name].filter(Boolean).join(" · ") }));
    const tasks = (search.data?.tasks ?? []).map((t) => ({ key: `task-${t.id}`, to: t.leadId ? `/crm?lead=${t.leadId}` : "/agenda", label: t.title, icon: CalendarClock, hint: "Tarefa" }));
    return [...pages, ...leads, ...tasks];
  }, [query, search.data]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const go = (i: number) => {
    const item = results[i];
    if (!item) return;
    onOpenChange(false);
    navigate(item.to);
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px]" />
        <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border bg-surface shadow-2xl">
          <D.Title className="sr-only">Pesquisa global</D.Title>
          <D.Description className="sr-only">Digite para encontrar uma página</D.Description>
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="size-4 text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  go(active);
                }
              }}
              placeholder="Buscar páginas, leads e tarefas…"
              aria-label="Pesquisar"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
            <Kbd>Esc</Kbd>
          </div>
          <ul role="listbox" className="max-h-80 overflow-y-auto p-2">
            {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nada encontrado.</li>}
            {results.map((item, i) => (
              <li key={item.key} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(i)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                    i === active ? "bg-primary-soft text-primary" : "text-foreground",
                  )}
                >
                  <item.icon className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  {item.hint && <Badge>{item.hint}</Badge>}
                  {i === active && <CornerDownLeft className="size-3.5 opacity-60" />}
                </button>
              </li>
            ))}
          </ul>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
