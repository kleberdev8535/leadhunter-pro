# LeadHunter Pro

Plataforma SaaS de prospecção comercial (Google Maps → CRM Kanban → WhatsApp), multiempresa.

## Estrutura

```
apps/api   Express 5 + TypeScript + Prisma 7 (PostgreSQL) — porta 8110
apps/web   React 19 + Vite 8 + Tailwind 4 + TanStack Query — porta 5210
e2e/       Playwright (sobe API 8111 + web 5211 no banco de teste)
```

## Rodando localmente (sem Docker)

```bash
npm install
npm run db:local          # PostgreSQL embarcado na 55433 (deixe aberto)
npm run db:migrate        # em outro terminal, 1ª vez
npm run dev               # API + web → http://localhost:5210
```

Com Docker: `docker compose up -d` (Postgres 55433, Redis 6380).

## Testes

```bash
npm test                  # API (integração real no banco leadhunter_test) + web (Vitest/RTL)
npx playwright test       # E2E desktop + mobile
```

## Variáveis de ambiente

Veja `apps/api/.env.example` e `apps/web/.env.example`. Obrigatórias na API: `DATABASE_URL`,
`JWT_ACCESS_SECRET` (≥ 32 caracteres), `ENCRYPTION_KEY` (32 bytes em base64), `CORS_ORIGINS`, `APP_URL`.
Em produção também é preciso `SMTP_*`; sem SMTP, a recuperação de senha falha (em dev o link vai para o log).

## Segurança (Etapa 1)

- Senhas com Argon2id; bloqueio de 15 min após 5 falhas; rate limit por IP nas rotas de auth.
- Access token JWT de 15 min só em memória; refresh token rotativo em cookie HttpOnly, guardado como hash,
  com detecção de reuso (janela de 20 s para abas simultâneas). Logout, troca e reset de senha revogam sessões na hora.
- Header `x-lh-client` obrigatório nas rotas por cookie (CSRF). Helmet, CORS por allowlist, limite de body.
- Todas as consultas filtram por `organizationId` (testado). Credenciais de integrações: AES-256-GCM.
- Auditoria de eventos de autenticação.

## AI Office (escritório de agentes)

Rota `/escritorio`. Escritório pixel art em Phaser 3 (sprites e mapa originais, gerados em canvas) onde
5 agentes determinísticos (sem IA) executam tarefas reais do backend:

| Agente | Tarefas | Integração |
|---|---|---|
| Hunter | `SEARCH_LEADS`, `UPDATE_LEADS` | Google Places API (New) — precisa da chave em Configurações → Google Maps |
| Scout | `QUALIFY_LEADS` | score 0–100 por regras transparentes |
| Atlas | `IMPORT_TO_CRM` | cria leads sem duplicar (único por organização + placeId) |
| Writer | `GENERATE_MESSAGES` | templates fixos, só rascunhos (nada é enviado) |
| Metrics | `GENERATE_REPORT` | indicadores reais do banco |

- **Fila:** `TaskQueue` com implementação em PostgreSQL (`FOR UPDATE SKIP LOCKED`): durável, no máximo
  1 tarefa por agente, concorrência global configurável, retry com backoff exponencial, idempotência por
  chave do cliente, pausa/cancelamento cooperativos com checkpoint, recuperação de tarefas de worker morto.
  Um adaptador BullMQ pode implementar a mesma interface quando houver `REDIS_URL`.
- **Workers:** rodam dentro da API por padrão (`RUN_WORKERS=false` desliga); fechar o navegador não interrompe nada.
- **Tempo real:** Socket.IO em `/api/socket.io`, autenticado com o access token, uma sala por organização.
- **Visual = backend:** o status do agente é derivado das tarefas no banco; só `WORKING` digita no computador
  e liga o monitor. A Central de Comando só aceita tarefas predefinidas com parâmetros validados.

## Módulos

| Etapa | Entregue |
|---|---|
| 1 | Auth (JWT + refresh rotativo), dashboard real, perfil/segurança |
| 2 | Encontrar Leads (Google Places API New), deduplicação, importar ao CRM |
| 3 | CRM Kanban, painel do lead, timeline, notas, tarefas, etiquetas |
| 4 | WhatsApp por QR Code (Baileys), Central de Mensagens com proteção de volume |
| 5 | Mensagens geradas pelo backend (templates por nicho) na Central de Mensagens, Agenda e lembretes |
| 6 | Relatórios + CSV, configurações de CRM/IA, campos personalizados, auditoria, busca global |
| 7 | Guia de deploy e monitoramento em `docs/DEPLOY.md` (publicação pendente da escolha de hospedagem) |
| + | AI Office: missões da equipe (Hunter → Scout → Atlas → Writer → Metrics), cada agente iniciando quando o anterior conclui |
