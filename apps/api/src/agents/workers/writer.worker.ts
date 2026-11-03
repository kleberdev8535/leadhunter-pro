import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { PermanentError } from "../../tasks/task.errors.js";
import type { TaskContext } from "../../tasks/task-context.js";
import { generateMessagesParams, type GenerateMessagesParams } from "../../tasks/task.schemas.js";

export type MessageKind = GenerateMessagesParams["kind"];

export interface TemplateVars {
  empresa: string;
  cidade: string | null;
  remetente: string;
  servico: string;
  temSite: boolean;
  nicho?: string | null;
  contato?: string | null;
  /** O lead veio do Google Maps? Só então a mensagem pode dizer "vi no Google". Padrão: true. */
  doGoogle?: boolean;
}

/**
 * Argumento por nicho: fala do que um site/presença digital costuma permitir naquele tipo de negócio.
 * É uma possibilidade genérica, nunca uma afirmação sobre a empresa ("vocês perdem clientes" etc.).
 */
const NICHE_ANGLES: { match: RegExp; angle: string }[] = [
  { match: /barbearia|sal[aã]o|beleza|est[eé]tica/i, angle: "um site com agendamento online e os serviços com preço ajuda novos clientes a marcar horário sem precisar ligar" },
  { match: /odonto|cl[ií]nica|m[eé]dic|sa[uú]de|fisio/i, angle: "um site com os tratamentos e agendamento de consultas passa mais confiança para quem pesquisa no Google" },
  { match: /academia|personal|crossfit|pilates/i, angle: "uma página com planos, horários e aula experimental facilita a decisão de quem está procurando onde treinar" },
  { match: /restaurante|pizzaria|lanchonete|hamburgueria|delivery/i, angle: "um site com cardápio e link direto para pedidos ajuda quem encontra vocês no Google a pedir na hora" },
  { match: /oficina|mec[aâ]nic|auto/i, angle: "uma página com os serviços e um botão de orçamento pelo WhatsApp ajuda quem está com o carro parado a decidir rápido" },
  { match: /imobili|corretor/i, angle: "um site com os imóveis organizados e filtros de busca ajuda a captar contatos de quem está procurando" },
  { match: /advoga|jur[ií]dic/i, angle: "um site com as áreas de atuação e um canal de contato direto transmite credibilidade a quem busca orientação" },
  { match: /contab/i, angle: "um site com os serviços e um canal para novos clientes ajuda a captar empresas que estão procurando contador" },
  { match: /pet/i, angle: "um site com os serviços, agendamento de banho e tosa e localização facilita para os tutores da região" },
  { match: /roupa|loja|moda|boutique/i, angle: "um catálogo online com as novidades ajuda a vender também para quem não pode ir até a loja" },
  { match: /escola|curso|ensino/i, angle: "um site com as turmas, valores e um formulário de matrícula ajuda as famílias a conhecerem a escola" },
];

export function nicheAngle(nicho: string | null | undefined): string {
  return (nicho && NICHE_ANGLES.find((n) => n.match.test(nicho))?.angle) || "uma presença digital bem organizada ajuda novos clientes a encontrarem e confiarem no negócio";
}

const greet = (v: TemplateVars) => (v.contato ? `Olá, ${v.contato.split(" ")[0]}, tudo bem?` : "Olá, tudo bem?");

/**
 * Templates fixos, gerados no backend (sem IA). Regra: só afirmar o que o sistema sabe de verdade.
 * Nunca dizer que "analisou o site" nem inventar números; no máximo, que o perfil no Google não informa site.
 */
const TEMPLATES: Record<MessageKind, (v: TemplateVars) => string> = {
  INITIAL: (v) =>
    `${greet(v)} Meu nome é ${v.remetente} e trabalho com ${v.servico}. ${v.doGoogle === false ? `Estou entrando em contato com a ${v.empresa}` : `Vi a ${v.empresa} no Google`}${v.cidade ? ` aqui em ${v.cidade}` : ""} e acredito que ${nicheAngle(v.nicho)}. Posso compartilhar uma sugestão rápida?`,
  NO_WEBSITE: (v) =>
    // Só fala de "perfil do Google sem site" quando o lead veio de lá e o Google não informou site.
    v.temSite || v.doGoogle === false
      ? TEMPLATES.INITIAL(v)
      : `${greet(v)} Sou ${v.remetente} e trabalho com ${v.servico}. Vi o perfil da ${v.empresa} no Google e não encontrei um site informado nele. Pensando no seu tipo de negócio, ${nicheAngle(v.nicho)}. Posso te mostrar como ficaria?`,
  FOLLOW_UP: (v) =>
    `Olá! Aqui é ${v.remetente} de novo. Passando para saber se conseguiu ver minha mensagem sobre ${v.servico} para a ${v.empresa}. Se não for o momento, sem problemas — é só me avisar.`,
  MEETING: (v) =>
    `Olá! Para eu entender melhor a ${v.empresa} e mostrar uma proposta sob medida, que tal uma conversa rápida de 15 minutos? Me diga o melhor dia e horário para você.`,
  PROPOSAL: (v) =>
    `Olá! Conforme conversamos, preparei a proposta de ${v.servico} para a ${v.empresa}. Posso enviar por aqui e tirar suas dúvidas?`,
  CLOSING: (v) =>
    `Olá! Como não tivemos retorno, vou encerrar meu contato por aqui para não incomodar. Se no futuro a ${v.empresa} precisar de ${v.servico}, fico à disposição. Obrigado!`,
};

export function renderTemplate(kind: MessageKind, vars: TemplateVars): string {
  return TEMPLATES[kind](vars);
}

/** Perfil comercial da organização (Configurações → Prospecção): quem assina e o que oferece. */
export async function commercialProfile(organizationId: string) {
  const cfg = await prisma.aIConfiguration.findUnique({ where: { organizationId }, select: { senderName: true, serviceOffered: true } });
  return { senderName: cfg?.senderName ?? null, serviceOffered: cfg?.serviceOffered ?? null };
}

/** Uma mensagem para um lead específico (botão "Gerar mensagem" da Central de Mensagens). */
export async function composeForLead(organizationId: string, leadId: string, kind: MessageKind, overrides: { senderName?: string; serviceOffered?: string } = {}) {
  const [lead, profile] = await Promise.all([
    prisma.lead.findFirst({ where: { id: leadId, organizationId, deletedAt: null } }),
    commercialProfile(organizationId),
  ]);
  if (!lead) throw new PermanentError("Lead não encontrado");
  const remetente = overrides.senderName || profile.senderName;
  const servico = overrides.serviceOffered || profile.serviceOffered;
  if (!remetente || !servico) throw new PermanentError("Defina seu nome e o serviço oferecido em Configurações → Prospecção.");
  return renderTemplate(kind, {
    empresa: lead.companyName,
    cidade: lead.city,
    remetente,
    servico,
    temSite: !!lead.website,
    nicho: lead.niche ?? lead.category,
    contato: lead.contactName,
    doGoogle: !!lead.placeId,
  });
}

/** WriterWorker → GENERATE_MESSAGES: rascunhos personalizados. Não envia nada. */
export async function writeMessages(ctx: TaskContext): Promise<Prisma.InputJsonValue> {
  const p = generateMessagesParams.parse(ctx.task.parameters);
  const org = ctx.organizationId;
  const profile = await commercialProfile(org);
  const remetente = p.senderName || profile.senderName;
  const servico = p.serviceOffered || profile.serviceOffered;
  if (!remetente || !servico) throw new PermanentError("Defina seu nome e o serviço oferecido em Configurações → Prospecção para o Writer assinar as mensagens.");

  let searchJobId: string | undefined;
  if (p.searchTaskId) {
    const search = await prisma.agentTask.findFirst({ where: { id: p.searchTaskId, organizationId: org } });
    searchJobId = (search?.result as { searchJobId?: string } | null)?.searchJobId;
  }
  const leads = await prisma.lead.findMany({
    where: {
      organizationId: org,
      deletedAt: null,
      score: { gte: p.minScore },
      ...(p.stageKey ? { stage: { key: p.stageKey } } : {}),
      ...(searchJobId ? { searchResults: { some: { searchJobId } } } : {}),
    },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    take: p.limit,
  });

  // Respeita a lista de bloqueio / opt-out.
  const phones = leads.map((l) => l.phoneE164).filter((x): x is string => !!x);
  const blocked = new Set(
    (await prisma.suppressionList.findMany({ where: { organizationId: org, phoneE164: { in: phones } }, select: { phoneE164: true } })).map((s) => s.phoneE164),
  );

  const drafts: { leadId: string; companyName: string; body: string }[] = [];
  let suppressed = 0;
  for (const [i, lead] of leads.entries()) {
    if (lead.phoneE164 && blocked.has(lead.phoneE164)) {
      suppressed++;
      continue;
    }
    const body = renderTemplate(p.kind, {
      empresa: lead.companyName,
      cidade: lead.city,
      remetente,
      servico,
      temSite: !!lead.website,
      nicho: lead.niche ?? lead.category,
      contato: lead.contactName,
      doGoogle: !!lead.placeId,
    });
    await prisma.leadActivity.create({
      data: {
        organizationId: org,
        leadId: lead.id,
        type: "MESSAGE_PREPARED",
        description: "Mensagem preparada pelo Writer (aguarda revisão)",
        metadata: { kind: p.kind, body, taskId: ctx.task.id },
      },
    });
    drafts.push({ leadId: lead.id, companyName: lead.companyName, body });
    await ctx.progress(((i + 1) / leads.length) * 100);
  }
  await ctx.log(`${drafts.length} rascunhos criados${suppressed ? `, ${suppressed} leads na lista de bloqueio ignorados` : ""}. Nenhuma mensagem foi enviada.`);
  return { drafts, suppressed, sent: 0 };
}
