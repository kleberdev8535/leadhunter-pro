import { expect, test } from "@playwright/test";

const SHOTS = process.env.SHOTS_DIR;

test("CRM: criar lead, arrastar entre etapas, nota e tarefa", async ({ page, isMobile }, info) => {
  test.skip(isMobile, "arrastar e soltar é testado no desktop");
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill("Lucas CRM");
  await page.getByLabel("Empresa").fill("Agência CRM");
  await page.getByLabel("Email").fill(`crm-${Date.now()}@teste.com`);
  await page.getByLabel("Senha", { exact: true }).fill("SenhaForte123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Olá, Lucas" })).toBeVisible({ timeout: 20_000 });

  await page.goto("/crm");
  await page.getByRole("button", { name: "Novo lead" }).first().click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Empresa *").fill("Barbearia Teste E2E");
  await modal.getByLabel("Telefone").fill("(11) 97777-6666");
  await modal.getByLabel("Cidade").fill("Osasco");
  await page.getByRole("button", { name: "Criar lead" }).click();
  const card = page.getByTestId("lead-Barbearia Teste E2E");
  await expect(page.getByTestId("column-new").getByTestId("lead-Barbearia Teste E2E")).toBeVisible();

  // Arrasta para "Primeiro contato" (coluna visível sem rolar o quadro).
  const target = page.getByTestId("column-first_contact");
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + 30, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 15 });
  await page.mouse.up();
  await expect(target.getByTestId("lead-Barbearia Teste E2E")).toBeVisible();

  // Persistiu: recarrega e continua lá.
  await page.reload();
  await expect(page.getByTestId("column-first_contact").getByTestId("lead-Barbearia Teste E2E")).toBeVisible();

  await page.getByTestId("lead-Barbearia Teste E2E").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Nova nota").fill("Dono atende à tarde");
  await page.getByRole("button", { name: "Adicionar nota" }).click();
  await expect(page.getByRole("dialog").getByText("Dono atende à tarde").first()).toBeVisible();
  await page.getByRole("button", { name: /Follow-up 3 dias/ }).click();
  await expect(page.getByRole("dialog").getByText("Follow-up", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Primeiro contato").first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/crm-${info.project.name}-drawer.png` });
  await page.keyboard.press("Escape");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/crm-${info.project.name}-board.png` });

  await page.goto("/leads/buscar");
  await expect(page.getByRole("heading", { name: "Encontrar Leads" })).toBeVisible();
  await expect(page.getByText(/chave do Google Maps não está configurada/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/find-${info.project.name}.png`, fullPage: true });
});
