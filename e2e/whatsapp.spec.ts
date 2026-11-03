import { expect, test } from "@playwright/test";

const SHOTS = process.env.SHOTS_DIR;

test("WhatsApp: QR Code real, central de mensagens e atalho no lead", async ({ page, isMobile }, info) => {
  test.skip(isMobile, "fluxo validado no desktop");
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill("Lucas Whats");
  await page.getByLabel("Empresa").fill("Agência Whats");
  await page.getByLabel("Email").fill(`wa-${Date.now()}@teste.com`);
  await page.getByLabel("Senha", { exact: true }).fill("SenhaForte123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Olá, Lucas" })).toBeVisible({ timeout: 20_000 });

  await page.goto("/whatsapp");
  await expect(page.getByText("Nenhum WhatsApp conectado")).toBeVisible();
  await expect(page.getByText("Proteção de volume")).toBeVisible();
  await page.getByRole("button", { name: "Conectar WhatsApp" }).click();
  // QR real gerado pelo Baileys e entregue via Socket.IO.
  await expect(page.getByAltText("QR Code para conectar o WhatsApp")).toBeVisible({ timeout: 30_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/whatsapp-${info.project.name}.png` });

  await page.goto("/crm");
  await page.getByRole("button", { name: "Novo lead" }).first().click();
  await page.getByLabel("Empresa *").fill("Pizzaria Teste");
  await page.locator("#n-phone").fill("(11) 96666-5555");
  await page.getByRole("button", { name: "Criar lead" }).click();
  await page.getByTestId("lead-Pizzaria Teste").click();
  await page.getByRole("link", { name: "Enviar mensagem" }).click();
  await expect(page.getByRole("heading", { name: "Central de Mensagens" })).toBeVisible();
  await expect(page.getByText("Pizzaria Teste").first()).toBeVisible();
  await expect(page.getByText("Conecte o WhatsApp para enviar.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar", exact: true })).toBeDisabled();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/messages-${info.project.name}.png` });
});
