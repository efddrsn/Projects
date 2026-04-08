/**
 * Scryfall API client with rate limiting.
 * Respects Scryfall's guidelines: <10 requests/second, 50-100ms between requests.
 */

const BASE_URL = "https://api.scryfall.com";
const REQUEST_DELAY_MS = 100;

let lastRequestTime = 0;

async function rateLimitedFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < REQUEST_DELAY_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, REQUEST_DELAY_MS - elapsed)
    );
  }
  lastRequestTime = Date.now();

  const response = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": "MTG-MCP-Server/1.0",
      Accept: "application/json",
      ...init?.headers,
    },
  });

  if (response.status === 429) {
    // Rate limited - wait and retry once
    await new Promise((resolve) => setTimeout(resolve, 1000));
    lastRequestTime = Date.now();
    return fetch(url, {
      ...init,
      headers: {
        "User-Agent": "MTG-MCP-Server/1.0",
        Accept: "application/json",
        ...init?.headers,
      },
    });
  }

  return response;
}

function buildUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

async function get(
  path: string,
  params?: Record<string, string>
): Promise<unknown> {
  const url = buildUrl(path, params);
  const response = await rateLimitedFetch(url);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Scryfall API error (${response.status}): ${(error as any)?.details || response.statusText}`
    );
  }
  return response.json();
}

async function post(path: string, body: unknown): Promise<unknown> {
  const url = buildUrl(path);
  const response = await rateLimitedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Scryfall API error (${response.status}): ${(error as any)?.details || response.statusText}`
    );
  }
  return response.json();
}

// --- Cards ---

export async function searchCards(params: {
  q: string;
  unique?: string;
  order?: string;
  dir?: string;
  page?: number;
}) {
  return get("/cards/search", {
    q: params.q,
    ...(params.unique && { unique: params.unique }),
    ...(params.order && { order: params.order }),
    ...(params.dir && { dir: params.dir }),
    ...(params.page && { page: String(params.page) }),
  });
}

export async function getCardByName(params: {
  exact?: string;
  fuzzy?: string;
  set?: string;
}) {
  return get("/cards/named", {
    ...(params.exact && { exact: params.exact }),
    ...(params.fuzzy && { fuzzy: params.fuzzy }),
    ...(params.set && { set: params.set }),
  });
}

export async function autocompleteCardName(q: string) {
  return get("/cards/autocomplete", { q });
}

export async function getRandomCard(q?: string) {
  return get("/cards/random", q ? { q } : undefined);
}

export async function getCardCollection(
  identifiers: Array<Record<string, string>>
) {
  return post("/cards/collection", { identifiers });
}

export async function getCardById(id: string) {
  return get(`/cards/${encodeURIComponent(id)}`);
}

export async function getCardBySetAndNumber(
  code: string,
  number: string,
  lang?: string
) {
  const path = lang
    ? `/cards/${encodeURIComponent(code)}/${encodeURIComponent(number)}/${encodeURIComponent(lang)}`
    : `/cards/${encodeURIComponent(code)}/${encodeURIComponent(number)}`;
  return get(path);
}

export async function getCardByMultiverseId(id: number) {
  return get(`/cards/multiverse/${id}`);
}

export async function getCardByMtgoId(id: number) {
  return get(`/cards/mtgo/${id}`);
}

export async function getCardByArenaId(id: number) {
  return get(`/cards/arena/${id}`);
}

export async function getCardByTcgplayerId(id: number) {
  return get(`/cards/tcgplayer/${id}`);
}

export async function getCardByCardmarketId(id: number) {
  return get(`/cards/cardmarket/${id}`);
}

// --- Sets ---

export async function listSets() {
  return get("/sets");
}

export async function getSet(codeOrId: string) {
  return get(`/sets/${encodeURIComponent(codeOrId)}`);
}

export async function getSetByTcgplayerId(id: number) {
  return get(`/sets/tcgplayer/${id}`);
}

// --- Rulings ---

export async function getRulingsById(id: string) {
  return get(`/cards/${encodeURIComponent(id)}/rulings`);
}

export async function getRulingsBySetAndNumber(code: string, number: string) {
  return get(
    `/cards/${encodeURIComponent(code)}/${encodeURIComponent(number)}/rulings`
  );
}

export async function getRulingsByMultiverseId(id: number) {
  return get(`/cards/multiverse/${id}/rulings`);
}

export async function getRulingsByMtgoId(id: number) {
  return get(`/cards/mtgo/${id}/rulings`);
}

export async function getRulingsByArenaId(id: number) {
  return get(`/cards/arena/${id}/rulings`);
}

// --- Symbology ---

export async function listSymbols() {
  return get("/symbology");
}

export async function parseManaCost(cost: string) {
  return get("/symbology/parse-mana", { cost });
}

// --- Catalogs ---

export type CatalogType =
  | "card-names"
  | "artist-names"
  | "word-bank"
  | "creature-types"
  | "planeswalker-types"
  | "land-types"
  | "artifact-types"
  | "enchantment-types"
  | "spell-types"
  | "battle-types"
  | "supertypes"
  | "card-types"
  | "keyword-abilities"
  | "keyword-actions"
  | "ability-words"
  | "powers"
  | "toughnesses"
  | "loyalties"
  | "watermarks"
  | "flavor-words";

export async function getCatalog(type: CatalogType) {
  return get(`/catalog/${type}`);
}

// --- Bulk Data ---

export async function listBulkData() {
  return get("/bulk-data");
}

export async function getBulkData(typeOrId: string) {
  return get(`/bulk-data/${encodeURIComponent(typeOrId)}`);
}

// --- Migrations ---

export async function listMigrations() {
  return get("/migrations");
}

export async function getMigration(id: string) {
  return get(`/migrations/${encodeURIComponent(id)}`);
}
