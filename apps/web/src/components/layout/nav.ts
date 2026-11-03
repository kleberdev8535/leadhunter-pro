import {
  BarChart3,
  Building2,
  CalendarCheck,
  KanbanSquare,
  LayoutDashboard,
  MessagesSquare,
  Search,
  Settings,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Etapa do roadmap em que o módulo é entregue. */
  stage: number;
  /** Módulo já entregue e funcional. Os demais mostram uma página "em breve" honesta. */
  ready: boolean;
}

export const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, stage: 1, ready: true },
  { to: "/escritorio", label: "AI Office", icon: Building2, stage: 2, ready: true },
  { to: "/leads/buscar", label: "Encontrar Leads", icon: Search, stage: 2, ready: true },
  { to: "/crm", label: "CRM Kanban", icon: KanbanSquare, stage: 3, ready: true },
  { to: "/whatsapp", label: "WhatsApp", icon: Smartphone, stage: 4, ready: true },
  { to: "/mensagens", label: "Central de Mensagens", icon: MessagesSquare, stage: 4, ready: true },
  { to: "/agenda", label: "Agenda", icon: CalendarCheck, stage: 5, ready: true },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3, stage: 6, ready: true },
  { to: "/configuracoes", label: "Configurações", icon: Settings, stage: 1, ready: true },
];

export const isAvailable = (item: NavItem) => item.ready;
