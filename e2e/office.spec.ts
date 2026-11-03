import { expect, test } from "@playwright/test";

const SHOTS = process.env.SHOTS_DIR;

test("escritório: agentes reais, central de comando e execução em tempo real", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill("Lucas Office");
  await page.getByLabel("Empresa").fill("Agência Office");
  await page.getByLabel("Email").fill(`office-${Date.now()}-${info.project.name}@teste.com`);
  await page.getByLabel("Senha", { exact: true }).fill("SenhaForte123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Olá, Lucas" })).toBeVisible({ timeout: 20_000 });

  await page.goto("/escritorio");
  await expect(page.getByText("LEADHUNTER AI OFFICE")).toBeVisible();
  await expect(page.getByText("Montando o escritório…")).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText("Tempo real conectado")).toBeVisible({ timeout: 15_000 });

  // Os 5 agentes reais aparecem disponíveis (ninguém "trabalhando" sem tarefa).
  await page.getByRole("tab", { name: "Agentes" }).click();
  for (const name of ["Hunter", "Scout", "Atlas", "Writer", "Metrics"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await page.waitForTimeout(800);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/office-${info.project.name}-idle.png`, fullPage: true });

  // Central de comando → relatório pelo Metrics.
  await page.getByRole("button", { name: "Nova missão" }).first().click();
  await expect(page.getByText("CENTRAL DE COMANDO", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: /Tarefa avulsa/ }).click();
  await page.getByRole("button", { name: "Relatório dos últimos 30 dias" }).click();
  await page.getByPlaceholder("Descreva a tarefa que deseja executar...").fill("Relatório semanal para a reunião");
  await page.getByRole("button", { name: "Enviar tarefa" }).click();
  await expect(page.getByText("Tarefa enviada", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ver no escritório" }).click();

  // O resultado chega via Socket.IO, sem recarregar a página.
  await page.getByRole("tab", { name: "Relatórios" }).click();
  await expect(page.getByText("Funil")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: "Histórico" }).click();
  await expect(page.getByText("Relatório de prospecção (30 dias)")).toBeVisible();

  // Missão da equipe sem chave do Google: o Hunter falha com mensagem clara e a missão para ali.
  await page.getByRole("button", { name: "Nova missão" }).first().click();
  await expect(page.getByRole("radio", { name: /Missão da equipe/ })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Cidade").fill("Osasco");
  await page.getByText("Writer prepara as mensagens").click();
  await page.getByRole("button", { name: "Iniciar missão" }).click();
  await expect(page.getByText("Missão iniciada", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Acompanhar no escritório" }).click();
  await page.getByRole("tab", { name: "Missões" }).click();
  await expect(page.getByText("Falhou").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: "Tarefas" }).click();
  await page.getByRole("button", { name: "Falhas" }).click();
  await expect(page.getByText(/Google Maps não configurado/).first()).toBeVisible({ timeout: 20_000 });

  await page.waitForTimeout(2500); // deixa os agentes chegarem nos lugares
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/office-${info.project.name}-after.png`, fullPage: true });
  const canvas = page.getByTestId("office-canvas");
  if (SHOTS) await canvas.screenshot({ path: `${SHOTS}/office-${info.project.name}-map.png` });
  await page.getByRole("tab", { name: "Agentes" }).click();
  await page.getByRole("button", { name: /^Scout/ }).click();
  await expect(page.getByText("Atribuir tarefa")).toBeVisible();
  await page.waitForTimeout(900);
  if (SHOTS) await canvas.screenshot({ path: `${SHOTS}/office-${info.project.name}-zoom.png` });
});
