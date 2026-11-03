import { z } from "zod";

const email = z.string().trim().toLowerCase().email("Email inválido").max(254);
export const password = z
  .string()
  .min(8, "A senha precisa de pelo menos 8 caracteres")
  .max(128, "Senha muito longa")
  .regex(/[A-Za-z]/, "A senha precisa ter letras")
  .regex(/[0-9]/, "A senha precisa ter números");

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome").max(120),
  email,
  password,
  organizationName: z.string().trim().min(2, "Informe o nome da empresa").max(120),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Informe a senha").max(128),
});

export const forgotSchema = z.object({ email });

export const resetSchema = z.object({
  token: z.string().min(20).max(200),
  password,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  avatarUrl: z.string().trim().url().max(500).nullable().optional(),
});

export const sessionIdParams = z.object({ id: z.string().uuid() });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
