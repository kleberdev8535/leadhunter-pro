import { expect, test } from "@playwright/test";

const SHOTS = process.env.SHOTS_DIR;

test("Etapas 5–6: agenda, relatórios, IA, configurações e busca global", async ({ page, isMobile }, info) => {
  test.skip(isMobile, "validado no desktop");
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill("Lucas Etapas");
  await page.getByLabel("Empresa").fill("Agência Etapas");
  await page.getByLabel("Email").fill(`etapas-${Date.now()}@teste.com`);
  await page.getByLabel("Senha", { exact: true }).fill("SenhaForte123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Olá, Lucas" })).toBeVisible({ timeout: 20_000 });

  // Lead com follow-up atrasado → aparece na agenda.
  await page.goto("/crm");
  await page.getByRole("button", { name: "Novo lead" }).first().click();
  await page.getByLabel("Empresa *").fill("Oficina Delta");
  await page.getByRole("button", { name: "Criar lead" }).click();
  await page.getByTestId("lead-Oficina Delta").click();
  await page.getByRole("button", { name: /Amanhã/ }).click();
  await expect(page.getByRole("dialog").getByText("Entrar em contato", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/agenda");
  await expect(page.getByRole("heading", { name: "Minha Agenda" })).toBeVisible();
  await expect(page.getByText("Entrar em contato").first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/agenda-${info.project.name}.png`, fullPage: true });

  await page.goto("/relatorios");
  await expect(page.getByText("Funil de conversão")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar leads (CSV)" }).click();
  expect((await download).suggestedFilename()).toMatch(/^leads-.*\.csv$/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/reports-${info.project.name}.png`, fullPage: true });

  // Perfil comercial → "Gerar mensagem" na Central usa o motor do backend.
  await page.goto("/configuracoes");
  await page.getByRole("button", { name: "Prospecção" }).click();
  await page.getByLabel("Seu nome").fill("Lucas");
  await page.getByLabel("Serviço oferecido").fill("criação de sites");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Preferências de prospecção salvas")).toBeVisible();

  await page.goto("/configuracoes");
  await page.getByRole("button", { name: "CRM" }).click();
  await expect(page.getByText("Etapas do Kanban")).toBeVisible();
  await page.getByLabel("Nome do campo").fill("Instagram");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByText("Instagram", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Segurança" }).click();
  await expect(page.getByText("Logs de auditoria")).toBeVisible();

  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Pesquisar" }).fill("delta");
  await expect(page.getByRole("option", { name: /Oficina Delta/ })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("option", { name: /Oficina Delta/ }).click();
  await expect(page.getByRole("dialog").getByText("Oficina Delta").first()).toBeVisible();

  // Central de Mensagens: gera mensagem pelo backend mesmo com o WhatsApp desconectado (envio fica bloqueado).
  await page.keyboard.press("Escape");
  await page.goto("/crm");
  await page.getByTestId("lead-Oficina Delta").click();
  await page.getByRole("dialog").getByRole("button", { name: "Editar lead" }).click();
  await page.locator("#e-phone").fill("(11) 95555-4444");
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.getByRole("link", { name: "Enviar mensagem" }).click();
  await expect(page.getByRole("heading", { name: "Central de Mensagens" })).toBeVisible();
  await page.getByRole("button", { name: "Gerar mensagem" }).click();
  await expect(page.getByLabel("Mensagem", { exact: true })).toHaveValue(/Oficina Delta/);
  await expect(page.getByLabel("Mensagem", { exact: true })).toHaveValue(/Lucas/);
  await expect(page.getByRole("button", { name: "Enviar", exact: true })).toBeDisabled();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/compose-${info.project.name}.png` });
});
