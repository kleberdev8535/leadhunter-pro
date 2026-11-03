import { z } from "zod";

// Espelha as regras do backend para dar feedback imediato; o backend continua sendo a validação final.
export const passwordRule = z
  .string()
  .min(8, "Mínimo de 8 caracteres")
  .max(128, "Senha muito longa")
  .regex(/[A-Za-z]/, "Use pelo menos uma letra")
  .regex(/[0-9]/, "Use pelo menos um número");

export const loginSchema = z.object({
  email: z.string().trim().email("Email inválido"),
  password: z.string().min(1, "Informe a senha"),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome"),
  organizationName: z.string().trim().min(2, "Informe o nome da empresa"),
  email: z.string().trim().email("Email inválido"),
  password: passwordRule,
});

export const forgotSchema = z.object({ email: z.string().trim().email("Email inválido") });

export const resetSchema = z
  .object({ password: passwordRule, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "As senhas não coincidem" });
