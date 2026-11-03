import { describe, expect, it } from "vitest";
import { credentialHint, decryptSecret, encryptSecret } from "../src/lib/crypto.js";

describe("criptografia de credenciais", () => {
  it("cifra e decifra", () => {
    const enc = encryptSecret("AIzaSy-chave-secreta");
    expect(enc).not.toContain("chave-secreta");
    expect(decryptSecret(enc)).toBe("AIzaSy-chave-secreta");
  });

  it("gera IV diferente a cada vez", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("rejeita conteúdo adulterado", () => {
    const [v, iv, tag, data] = encryptSecret("segredo").split(".");
    const tampered = [v, iv, tag, Buffer.from("outro").toString("base64url")].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
    expect(data).toBeTruthy();
  });

  it("mostra só o final da chave", () => {
    expect(credentialHint("AIzaSyABCDEFGH1234")).toBe("…1234");
    expect(credentialHint("curta")).toBe("…");
  });
});
