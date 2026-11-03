import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { AppError } from "./errors.js";

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

/** Em testes, os emails ficam aqui em vez de serem enviados. */
export const testOutbox: Mail[] = [];

export const mailerConfigured = () => transport !== null;

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Sem SMTP configurado, em dev/test o email vai para o log; em produção a falta de SMTP é um erro. */
export async function sendMail(mail: Mail): Promise<void> {
  if (env.isTest) {
    testOutbox.push(mail);
    return;
  }
  if (!transport) {
    if (env.isProd) throw new AppError(503, "EMAIL_UNAVAILABLE", "Recuperação de senha indisponível: o envio de email ainda não foi configurado.");
    logger.warn({ to: mail.to, subject: mail.subject, text: mail.text }, "SMTP não configurado — email apenas registrado no log");
    return;
  }
  await transport.sendMail({ from: env.SMTP_FROM, ...mail });
}
