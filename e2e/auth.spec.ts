import { expect, test, type Page } from "@playwright/test";

const unique = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@teste.com`;

async function register(page: Page, email: string) {
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill("Lucas E2E");
  await page.getByLabel("Empresa").fill("Agência E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("SenhaForte123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Olá, Lucas" })).toBeVisible({ timeout: 20_000 });
}

async function openUserMenu(page: Page) {
  await page.getByRole("button", { name: "Menu do usuário" }).click();
}

test("cadastro → dashboard vazio com dados reais → logout → login", async ({ page }) => {
  const email = unique();
  await register(page, email);

  await expect(page.getByText("Total de leads", { exact: true })).toBeVisible();
  await expect(page.getByText("Sua base ainda está vazia")).toBeVisible();
  await expect(page.getByText("Performance de Prospecção")).toBeVisible();

  // Sessão sobrevive a um reload (refresh token em cookie HttpOnly).
  await page.reload();
  await expect(page.getByRole("heading", { name: "Olá, Lucas" })).toBeVisible({ timeout: 20_000 });

  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();

  // Depois do logout, a área logada não abre.
  await page.goto("/configuracoes");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("SenhaErrada1");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Email ou senha incorretos")).toBeVisible();

  await page.getByLabel("Senha", { exact: true }).fill("SenhaForte123");
  await page.getByRole("button", { name: "Entrar" }).click();
  // Volta para a página que tentou abrir antes do login.
  await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible();
});

test("configurações: sessões ativas, histórico e troca de tema", async ({ page }) => {
  await register(page, unique());
  await page.goto("/configuracoes");
  await page.getByRole("button", { name: "Segurança" }).click();
  await expect(page.getByText("Esta sessão")).toBeVisible();
  await expect(page.getByText("Conta criada")).toBeVisible();

  const html = page.locator("html");
  const wasDark = await html.evaluate((el) => el.classList.contains("dark"));
  await page.getByRole("button", { name: wasDark ? "Usar tema claro" : "Usar tema escuro" }).click();
  await expect(html).toHaveClass(wasDark ? /^(?!.*dark)/ : /dark/);
});

test("validação no cadastro e email duplicado", async ({ page }) => {
  const email = unique();
  await register(page, email);
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "Sair" }).click();

  await page.goto("/cadastro");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Informe seu nome")).toBeVisible();

  await page.getByLabel("Seu nome").fill("Outro");
  await page.getByLabel("Empresa").fill("Outra");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("SenhaForte123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Já existe uma conta com este email")).toBeVisible();
});

test("busca global abre com Ctrl+K e navega", async ({ page, isMobile }) => {
  test.skip(isMobile, "atalho de teclado é para desktop");
  await register(page, unique());
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Pesquisar" }).fill("config");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible();
});
