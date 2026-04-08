/**
 * Magic: The Gathering API client (api.magicthegathering.io)
 * Provides booster generation and alternative card search.
 */

const BASE_URL = "https://api.magicthegathering.io/v1";

async function get(
  path: string,
  params?: Record<string, string>
): Promise<unknown> {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "MTG-MCP-Server/1.0",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `MTG API error (${response.status}): ${response.statusText}`
    );
  }
  return response.json();
}

export async function generateBooster(setCode: string) {
  return get(`${BASE_URL}/sets/${encodeURIComponent(setCode)}/booster`);
}

export async function searchCards(params: {
  name?: string;
  colors?: string;
  type?: string;
  text?: string;
  set?: string;
  rarity?: string;
  page?: number;
  pageSize?: number;
}) {
  const queryParams: Record<string, string> = {};
  if (params.name) queryParams.name = params.name;
  if (params.colors) queryParams.colors = params.colors;
  if (params.type) queryParams.type = params.type;
  if (params.text) queryParams.text = params.text;
  if (params.set) queryParams.set = params.set;
  if (params.rarity) queryParams.rarity = params.rarity;
  if (params.page) queryParams.page = String(params.page);
  if (params.pageSize) queryParams.pageSize = String(params.pageSize);
  return get(`${BASE_URL}/cards`, queryParams);
}

export async function getFormats() {
  return get(`${BASE_URL}/formats`);
}

export async function getTypes() {
  return get(`${BASE_URL}/types`);
}

export async function getSubtypes() {
  return get(`${BASE_URL}/subtypes`);
}

export async function getSupertypes() {
  return get(`${BASE_URL}/supertypes`);
}
