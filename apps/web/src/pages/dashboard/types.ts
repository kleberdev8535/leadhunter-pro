export interface DashboardSummary {
  periodDays: number;
  cards: {
    totalLeads: number;
    newLeads: number;
    withoutWebsite: number;
    qualified: number;
    contacted: number;
    replied: number;
    meetings: number;
    converted: number;
    conversionRate: number;
    createdInPeriod: number;
  };
  today: { found: number; approached: number; replied: number; interested: number; converted: number };
}

export interface DashboardCharts {
  leadsPerDay: { date: string; total: number }[];
  conversionsPerDay: { date: string; total: number }[];
  byNiche: { label: string; total: number }[];
  byCity: { label: string; total: number }[];
  funnel: { id: string; key: string; name: string; color: string; kind: string; total: number }[];
}

export interface RecentActivity {
  id: string;
  type: string;
  description: string;
  createdAt: string;
  lead: { id: string; companyName: string };
  actor: { id: string; name: string } | null;
}
