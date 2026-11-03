import { Link } from "react-router";
import { Construction } from "lucide-react";
import type { NavItem } from "@/components/layout/nav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { EmptyState } from "@/components/states";

const DESCRIPTIONS: Record<string, string> = {
  "/leads/buscar": "Busca por nicho e região na Google Places API (New), com filtro de site informado, deduplicação por place_id e controle de custo.",
  "/crm": "Kanban com arrastar e soltar, detalhes do lead, timeline, notas, tags e tarefas.",
  "/whatsapp": "Conexão real via WhatsApp Business Platform (Cloud API) e, se disponível, provedor autorizado com QR Code.",
  "/mensagens": "Conversas por lead, envio individual após revisão, limites, opt-out e lista de bloqueio.",
  "/agenda": "Tarefas de hoje, atrasadas, próximos contatos e leads parados.",
  "/relatorios": "Relatórios de funil, conversão e produtividade.",
};

/** Página honesta para módulos que ainda não foram entregues: nenhum botão finge funcionar. */
export function ComingSoonPage({ item }: { item: NavItem }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{item.label}</h1>
        <p className="mt-1 text-sm text-muted">Módulo da Etapa {item.stage} do roadmap.</p>
      </div>
      <Card>
        <EmptyState
          icon={Construction}
          title={`Chega na Etapa ${item.stage}`}
          description={DESCRIPTIONS[item.to] ?? "Em desenvolvimento."}
          action={
            <Button asChild variant="secondary">
              <Link to="/">Voltar ao Dashboard</Link>
            </Button>
          }
        />
      </Card>
    </div>
  );
}
