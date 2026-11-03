/** Falha temporária (rede, 429, 5xx): a tarefa volta para a fila com backoff exponencial. */
export class RetryableError extends Error {
  readonly retryable = true;
}

/** Falha que não melhora tentando de novo (credencial ausente, parâmetro impossível). */
export class PermanentError extends Error {
  readonly retryable = false;
}

/** Lançado pelo contexto quando o usuário pediu pausa ou cancelamento. Não é erro. */
export class StopSignal extends Error {
  constructor(public readonly kind: "pause" | "cancel") {
    super(kind);
  }
}

/** 5s, 10s, 20s, 40s… com teto de 5 minutos. */
export const backoffMs = (retryCount: number) => Math.min(5_000 * 2 ** retryCount, 300_000);
