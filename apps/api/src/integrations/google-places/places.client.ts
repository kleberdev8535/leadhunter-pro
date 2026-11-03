import { RetryableError, PermanentError } from "../../tasks/task.errors.js";

/**
 * Cliente da Google Places API (New). Só pede os campos necessários (field mask), porque
 * o preço é definido pelos campos solicitados. Website e telefone estão no SKU Enterprise.
 */
const BASE = "https://places.googleapis.com/v1";
const TIMEOUT_MS = 15_000;

/** Custo estimado por requisição de Text Search com campos Enterprise (USD, em micros). Conferir a tabela atual do Google. */
export const TEXT_SEARCH_COST_MICROS = 35_000;
export const DETAILS_COST_MICROS = 20_000;
/** A Text Search devolve no máximo 20 por página e 60 por consulta. */
export const PAGE_SIZE = 20;
export const MAX_RESULTS_PER_QUERY = 60;

const SEARCH_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.businessStatus",
  "places.primaryTypeDisplayName",
  "nextPageToken",
].join(",");

const DETAIL_FIELDS = SEARCH_FIELDS.replace(/places\./g, "").replace(",nextPageToken", "");

export interface Place {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  // O Google às vezes omite `types` (ex.: endereço livre como único componente).
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
  primaryTypeDisplayName?: { text: string };
}

export type FetchFn = typeof fetch;

async function call<T>(fetchFn: FetchFn, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new RetryableError(`Falha de rede ao falar com o Google: ${(err as Error).message}`);
  }
  if (res.ok) return (await res.json()) as T;
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null;
  const detail = body?.error?.message ?? res.statusText;
  if (res.status === 429 || res.status >= 500) throw new RetryableError(`Google respondeu ${res.status}: ${detail}`);
  if (res.status === 401 || res.status === 403) {
    throw new PermanentError(`Chave do Google recusada (${res.status}). Verifique se a Places API (New) está ativa e a chave é válida. ${detail}`);
  }
  throw new PermanentError(`Google respondeu ${res.status}: ${detail}`);
}

export async function searchText(
  apiKey: string,
  textQuery: string,
  pageToken: string | undefined,
  fetchFn: FetchFn = fetch,
): Promise<{ places: Place[]; nextPageToken?: string }> {
  const data = await call<{ places?: Place[]; nextPageToken?: string }>(fetchFn, `${BASE}/places:searchText`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": SEARCH_FIELDS },
    body: JSON.stringify({ textQuery, languageCode: "pt-BR", regionCode: "BR", pageSize: PAGE_SIZE, pageToken }),
  });
  return { places: data.places ?? [], nextPageToken: data.nextPageToken };
}

export async function getPlace(apiKey: string, placeId: string, fetchFn: FetchFn = fetch): Promise<Place> {
  return call<Place>(fetchFn, `${BASE}/places/${encodeURIComponent(placeId)}?languageCode=pt-BR`, {
    method: "GET",
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": DETAIL_FIELDS },
  });
}

/** Teste de credencial com o menor custo possível: 1 resultado, só o id. */
export async function testKey(apiKey: string, fetchFn: FetchFn = fetch): Promise<void> {
  await call(fetchFn, `${BASE}/places:searchText`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.id" },
    body: JSON.stringify({ textQuery: "padaria São Paulo", pageSize: 1 }),
  });
}

export function component(place: Place, type: string) {
  return place.addressComponents?.find((c) => c.types?.includes(type))?.longText;
}

/** Normaliza telefone brasileiro para E.164 (+55DDDNUMERO) quando possível. */
export function toE164(place: Place): string | undefined {
  const raw = place.internationalPhoneNumber ?? place.nationalPhoneNumber;
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return undefined;
}
