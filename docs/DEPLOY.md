# Deploy e operação — LeadHunter Pro

## Arquitetura de produção

| Parte | Onde | Por quê |
|---|---|---|
| Frontend (`apps/web`) | Vercel | Site estático (Vite). `apps/web/vercel.json` faz o fallback de rotas para `index.html`. |
| API + agentes + WhatsApp (`apps/api`) | Railway **ou** Render (plano pago) | Processo sempre ligado: workers dos agentes, fila do WhatsApp, Socket.IO e sessão do Baileys. Não roda em funções serverless. |
| PostgreSQL | Railway, Neon ou Supabase | Único banco: dados, filas de tarefas/mensagens e sessão do WhatsApp (criptografada). |

> Plano gratuito do Render "dorme" após 15 min sem tráfego: os agentes param e o WhatsApp desconecta até a próxima visita. Para uso real, use um plano sempre ligado.

## API (Dockerfile na raiz)

1. Crie o serviço apontando para a raiz do repositório; ele usa o `Dockerfile`.
2. O container roda `prisma migrate deploy` antes de subir (migrações idempotentes).
3. Health check: `GET /api/health` → `200 {"status":"ok", "queues": {...}}`; `503` se o banco cair.
4. **Rode uma única instância.** A sessão do WhatsApp e o despachante de mensagens vivem no processo; duas instâncias abririam duas conexões com o mesmo número. (A fila de tarefas dos agentes já é segura com vários workers.)

### Variáveis de ambiente da API

| Variável | Obrigatória | Exemplo / como gerar |
|---|---|---|
| `NODE_ENV` | sim | `production` |
| `DATABASE_URL` | sim | string do Postgres (com `?sslmode=require` no Neon/Supabase) |
| `JWT_ACCESS_SECRET` | sim | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ENCRYPTION_KEY` | sim | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — **guarde com cuidado: perdê-la invalida chaves de integração e a sessão do WhatsApp** |
| `CORS_ORIGINS` | sim | `https://seu-app.vercel.app` (vírgula para vários) |
| `APP_URL` | sim | `https://seu-app.vercel.app` (links de email) |
| `PORT` | não | definido pela plataforma |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | para recuperar senha | sem SMTP, "esqueci a senha" responde 503 com mensagem clara |
| `RUN_WORKERS` | não | `false` desliga os agentes neste processo |

Chaves de Google Maps, IA e a sessão do WhatsApp **não** vão em variáveis: cada organização cadastra pela tela de Configurações e elas ficam criptografadas no banco.

## Frontend (Vercel)

```bash
cd apps/web
VITE_API_URL=https://sua-api.up.railway.app npm run build
vercel deploy dist --prod
```

Copie `vercel.json` para `dist/` antes do deploy (ou configure o projeto com root `apps/web`, build `npm run build`, output `dist`, e a env `VITE_API_URL`).

Cookies: em produção o refresh token usa `SameSite=None; Secure` porque frontend e API ficam em domínios diferentes.

## Monitoramento

- **Uptime:** aponte um monitor (UptimeRobot/Better Stack) para `/api/health` a cada 1–5 min e alerte em não-200.
- **Filas:** `queues.tasksQueued` e `queues.messagesQueued` crescendo sem parar indicam worker parado ou WhatsApp desconectado.
- **Logs:** a API escreve JSON estruturado (pino) no stdout, com segredos mascarados — use o visualizador de logs da plataforma.
- **Auditoria:** Configurações → Segurança mostra os logs de auditoria (acessos, exclusões, exportações, integrações).
- **Custos:** Configurações → Google Maps mostra requisições e custo estimado no mês; os limites em Prospecção barram gastos acima do configurado.

## Backup

Ative backups automáticos do Postgres no provedor. O banco contém tudo, inclusive a sessão do WhatsApp (sem ela, basta ler um novo QR Code).
