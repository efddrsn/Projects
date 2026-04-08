import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as scryfall from "./api/scryfall.js";
import * as mtgApi from "./api/mtg-api.js";

function formatCardSummary(card: any): string {
  const parts: string[] = [];
  parts.push(`**${card.name}** ${card.mana_cost || ""}`);
  parts.push(`${card.type_line || ""}`);
  if (card.oracle_text) parts.push(card.oracle_text);
  if (card.power && card.toughness)
    parts.push(`${card.power}/${card.toughness}`);
  if (card.loyalty) parts.push(`Loyalty: ${card.loyalty}`);
  if (card.set_name) parts.push(`Set: ${card.set_name} (${card.set})`);
  if (card.rarity) parts.push(`Rarity: ${card.rarity}`);
  if (card.prices) {
    const prices = Object.entries(card.prices)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}: $${v}`)
      .join(", ");
    if (prices) parts.push(`Prices: ${prices}`);
  }
  if (card.legalities) {
    const legal = Object.entries(card.legalities)
      .filter(([, v]) => v === "legal")
      .map(([k]) => k)
      .join(", ");
    if (legal) parts.push(`Legal in: ${legal}`);
  }
  if (card.scryfall_uri) parts.push(`URL: ${card.scryfall_uri}`);
  return parts.join("\n");
}

function formatSearchResults(data: any): string {
  const lines: string[] = [];
  lines.push(
    `Found ${data.total_cards} card(s). Showing page results (${data.data?.length || 0} cards):`
  );
  lines.push("");
  for (const card of data.data || []) {
    lines.push(formatCardSummary(card));
    lines.push("---");
  }
  if (data.has_more) {
    lines.push(`More results available. Use page parameter to get next page.`);
  }
  return lines.join("\n");
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mtg-mcp-server",
    version: "1.0.0",
  });

  // =====================
  // SCRYFALL: CARDS
  // =====================

  server.tool(
    "scryfall_search_cards",
    `Search for Magic: The Gathering cards using Scryfall's powerful search syntax.

Examples of search queries:
- "lightning bolt" (card name)
- "c:red t:instant cmc=1" (red instants with CMC 1)
- "o:draw o:card f:standard" (cards with draw in text, standard legal)
- "t:creature pow>=5 tou>=5 c:green" (big green creatures)
- "set:mh3" (cards from Modern Horizons 3)
- "is:commander ci:wubrg" (5-color commanders)

Full syntax reference: https://scryfall.com/docs/syntax`,
    {
      q: z.string().describe("Search query using Scryfall syntax"),
      unique: z
        .enum(["cards", "prints", "art"])
        .optional()
        .describe(
          "How to handle duplicates: cards (default), prints (all printings), art (unique art)"
        ),
      order: z
        .enum([
          "name",
          "set",
          "released",
          "rarity",
          "color",
          "usd",
          "tix",
          "eur",
          "cmc",
          "power",
          "toughness",
          "edhrec",
          "penny",
          "artist",
          "review",
        ])
        .optional()
        .describe("Sort order for results"),
      dir: z
        .enum(["auto", "asc", "desc"])
        .optional()
        .describe("Sort direction"),
      page: z.number().int().positive().optional().describe("Page number"),
    },
    async (params) => {
      try {
        const data = await scryfall.searchCards(params);
        return { content: [{ type: "text", text: formatSearchResults(data) }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "scryfall_get_card_by_name",
    "Get a single card by exact or fuzzy name match. Use exact for precise matches, fuzzy for approximate.",
    {
      exact: z
        .string()
        .optional()
        .describe("Exact card name (e.g., 'Lightning Bolt')"),
      fuzzy: z
        .string()
        .optional()
        .describe("Fuzzy card name (e.g., 'lihgtnin bolt')"),
      set: z.string().optional().describe("Limit to a specific set code"),
    },
    async (params) => {
      try {
        const card = await scryfall.getCardByName(params);
        return { content: [{ type: "text", text: formatCardSummary(card) }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "scryfall_autocomplete",
    "Autocomplete a card name. Returns up to 20 suggestions. Fast and useful for building search UIs or confirming card names.",
    {
      q: z
        .string()
        .describe("Partial card name to autocomplete (min 2 characters)"),
    },
    async ({ q }) => {
      try {
        const data = (await scryfall.autocompleteCardName(q)) as any;
        return {
          content: [
            {
              type: "text",
              text: `Suggestions for "${q}":\n${(data.data || []).join("\n")}`,
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "scryfall_random_card",
    "Get a random Magic card. Optionally filter with a search query.",
    {
      q: z
        .string()
        .optional()
        .describe(
          "Optional search query to constrain randomness (e.g., 'c:red t:dragon')"
        ),
    },
    async ({ q }) => {
      try {
        const card = await scryfall.getRandomCard(q);
        return { content: [{ type: "text", text: formatCardSummary(card) }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "scryfall_get_card",
    "Get a specific card by Scryfall ID, set/collector number, or other platform IDs.",
    {
      id: z.string().optional().describe("Scryfall UUID"),
      set: z.string().optional().describe("Set code (use with number)"),
      number: z
        .string()
        .optional()
        .describe("Collector number (use with set)"),
      lang: z
        .string()
        .optional()
        .describe("Language code (use with set+number)"),
      multiverse_id: z.number().optional().describe("Multiverse ID"),
      mtgo_id: z.number().optional().describe("MTGO ID"),
      arena_id: z.number().optional().describe("MTG Arena ID"),
      tcgplayer_id: z.number().optional().describe("TCGPlayer ID"),
      cardmarket_id: z.number().optional().describe("Cardmarket ID"),
    },
    async (params) => {
      try {
        let card;
        if (params.id) {
          card = await scryfall.getCardById(params.id);
        } else if (params.set && params.number) {
          card = await scryfall.getCardBySetAndNumber(
            params.set,
            params.number,
            params.lang
          );
        } else if (params.multiverse_id) {
          card = await scryfall.getCardByMultiverseId(params.multiverse_id);
        } else if (params.mtgo_id) {
          card = await scryfall.getCardByMtgoId(params.mtgo_id);
        } else if (params.arena_id) {
          card = await scryfall.getCardByArenaId(params.arena_id);
        } else if (params.tcgplayer_id) {
          card = await scryfall.getCardByTcgplayerId(params.tcgplayer_id);
        } else if (params.cardmarket_id) {
          card = await scryfall.getCardByCardmarketId(params.cardmarket_id);
        } else {
          return {
            content: [
              {
                type: "text",
                text: "Error: Provide at least one identifier (id, set+number, multiverse_id, etc.)",
              },
            ],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: formatCardSummary(card) }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "scryfall_card_collection",
    `Fetch a collection of specific cards in a single request (up to 75 per request).

Each identifier can be one of:
- { id: "scryfall-uuid" }
- { name: "Card Name" }
- { name: "Card Name", set: "set_code" }
- { set: "set_code", collector_number: "123" }
- { multiverse_id: 12345 }`,
    {
      identifiers: z
        .array(z.record(z.string()))
        .describe("Array of card identifier objects (max 75)"),
    },
    async ({ identifiers }) => {
      try {
        const data = (await scryfall.getCardCollection(identifiers)) as any;
        const found = (data.data || []).map(formatCardSummary).join("\n---\n");
        const notFound = data.not_found?.length
          ? `\nNot found: ${JSON.stringify(data.not_found)}`
          : "";
        return {
          content: [
            {
              type: "text",
              text: `Found ${data.data?.length || 0} cards:\n\n${found}${notFound}`,
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // =====================
  // SCRYFALL: SETS
  // =====================

  server.tool(
    "scryfall_list_sets",
    "List all Magic: The Gathering sets. Returns set codes, names, release dates, and types.",
    {},
    async () => {
      try {
        const data = (await scryfall.listSets()) as any;
        const sets = (data.data || [])
          .map(
            (s: any) =>
              `${s.code.padEnd(6)} | ${s.name.padEnd(40)} | ${s.released_at || "?"} | ${s.set_type}`
          )
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: `${data.data?.length || 0} sets:\n\nCode   | Name${" ".repeat(37)}| Released   | Type\n${"-".repeat(80)}\n${sets}`,
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "scryfall_get_set",
    "Get details about a specific set by its code or Scryfall ID.",
    {
      code_or_id: z
        .string()
        .describe("Set code (e.g., 'mh3') or Scryfall UUID"),
    },
    async ({ code_or_id }) => {
      try {
        const set = (await scryfall.getSet(code_or_id)) as any;
        const info = [
          `**${set.name}** (${set.code})`,
          `Type: ${set.set_type}`,
          `Released: ${set.released_at || "Unknown"}`,
          `Cards: ${set.card_count}`,
          set.block ? `Block: ${set.block}` : null,
          set.parent_set_code
            ? `Parent set: ${set.parent_set_code}`
            : null,
          `Digital: ${set.digital}`,
          `Foil only: ${set.foil_only}`,
          `Nonfoil only: ${set.nonfoil_only}`,
          `Scryfall: ${set.scryfall_uri}`,
          set.icon_svg_uri ? `Icon: ${set.icon_svg_uri}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        return { content: [{ type: "text", text: info }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // =====================
  // SCRYFALL: RULINGS
  // =====================

  server.tool(
    "scryfall_get_rulings",
    "Get official rulings for a card. Identify the card by Scryfall ID, set/number, or other IDs.",
    {
      id: z.string().optional().describe("Scryfall UUID"),
      set: z.string().optional().describe("Set code (use with number)"),
      number: z
        .string()
        .optional()
        .describe("Collector number (use with set)"),
      multiverse_id: z.number().optional().describe("Multiverse ID"),
      mtgo_id: z.number().optional().describe("MTGO ID"),
      arena_id: z.number().optional().describe("MTG Arena ID"),
    },
    async (params) => {
      try {
        let data;
        if (params.id) {
          data = await scryfall.getRulingsById(params.id);
        } else if (params.set && params.number) {
          data = await scryfall.getRulingsBySetAndNumber(
            params.set,
            params.number
          );
        } else if (params.multiverse_id) {
          data = await scryfall.getRulingsByMultiverseId(params.multiverse_id);
        } else if (params.mtgo_id) {
          data = await scryfall.getRulingsByMtgoId(params.mtgo_id);
        } else if (params.arena_id) {
          data = await scryfall.getRulingsByArenaId(params.arena_id);
        } else {
          return {
            content: [
              {
                type: "text",
                text: "Error: Provide at least one identifier.",
              },
            ],
            isError: true,
          };
        }
        const rulings = ((data as any).data || [])
          .map(
            (r: any) =>
              `[${r.published_at}] (${r.source}): ${r.comment}`
          )
          .join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: rulings || "No rulings found for this card.",
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // =====================
  // SCRYFALL: SYMBOLOGY
  // =====================

  server.tool(
    "scryfall_list_symbols",
    "List all card mana symbols recognized by Scryfall, including their text representations and colors.",
    {},
    async () => {
      try {
        const data = (await scryfall.listSymbols()) as any;
        const symbols = (data.data || [])
          .map(
            (s: any) =>
              `${s.symbol} - ${s.english} (${s.colors?.join(",") || "colorless"})${s.cmc ? ` CMC: ${s.cmc}` : ""}`
          )
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: `${data.data?.length || 0} symbols:\n\n${symbols}`,
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "scryfall_parse_mana_cost",
    "Parse a mana cost string and get details about its colors and converted mana cost.",
    {
      cost: z
        .string()
        .describe("Mana cost string (e.g., '{2}{W}{U}', '{X}{R}{R}')"),
    },
    async ({ cost }) => {
      try {
        const data = (await scryfall.parseManaCost(cost)) as any;
        const info = [
          `Cost: ${data.cost}`,
          `CMC: ${data.cmc}`,
          `Colors: ${data.colors?.join(", ") || "colorless"}`,
          `Colorless: ${data.colorless}`,
          `Monocolored: ${data.monocolored}`,
          `Multicolored: ${data.multicolored}`,
        ].join("\n");
        return { content: [{ type: "text", text: info }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // =====================
  // SCRYFALL: CATALOGS
  // =====================

  server.tool(
    "scryfall_get_catalog",
    `Get a reference catalog from Scryfall. Available catalogs:
card-names, artist-names, word-bank, creature-types, planeswalker-types,
land-types, artifact-types, enchantment-types, spell-types, battle-types,
supertypes, card-types, keyword-abilities, keyword-actions, ability-words,
powers, toughnesses, loyalties, watermarks, flavor-words`,
    {
      catalog: z
        .enum([
          "card-names",
          "artist-names",
          "word-bank",
          "creature-types",
          "planeswalker-types",
          "land-types",
          "artifact-types",
          "enchantment-types",
          "spell-types",
          "battle-types",
          "supertypes",
          "card-types",
          "keyword-abilities",
          "keyword-actions",
          "ability-words",
          "powers",
          "toughnesses",
          "loyalties",
          "watermarks",
          "flavor-words",
        ])
        .describe("Catalog type to retrieve"),
    },
    async ({ catalog }) => {
      try {
        const data = (await scryfall.getCatalog(catalog)) as any;
        const items = data.data || [];
        // For very large catalogs like card-names, truncate
        const MAX_ITEMS = 500;
        const truncated = items.length > MAX_ITEMS;
        const display = truncated ? items.slice(0, MAX_ITEMS) : items;
        return {
          content: [
            {
              type: "text",
              text: `Catalog "${catalog}" (${items.length} entries)${truncated ? ` [showing first ${MAX_ITEMS}]` : ""}:\n\n${display.join("\n")}`,
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // =====================
  // SCRYFALL: BULK DATA
  // =====================

  server.tool(
    "scryfall_bulk_data",
    `Get information about Scryfall's bulk data exports. These are large JSON files updated daily.
Available types: oracle-cards, unique-artwork, default-cards, all-cards, rulings.
Returns download URIs and metadata. Useful for building offline databases.`,
    {
      type: z
        .string()
        .optional()
        .describe(
          "Specific bulk data type (e.g., 'oracle-cards'). Omit to list all."
        ),
    },
    async ({ type }) => {
      try {
        if (type) {
          const data = (await scryfall.getBulkData(type)) as any;
          return {
            content: [
              {
                type: "text",
                text: [
                  `**${data.name}** (${data.type})`,
                  `Description: ${data.description}`,
                  `Download: ${data.download_uri}`,
                  `Size: ${(data.size / 1024 / 1024).toFixed(1)} MB`,
                  `Updated: ${data.updated_at}`,
                  `Content type: ${data.content_type}`,
                ].join("\n"),
              },
            ],
          };
        } else {
          const data = (await scryfall.listBulkData()) as any;
          const items = (data.data || [])
            .map(
              (b: any) =>
                `- **${b.name}** (${b.type}): ${b.description}\n  Size: ${(b.size / 1024 / 1024).toFixed(1)} MB | Updated: ${b.updated_at}`
            )
            .join("\n\n");
          return {
            content: [
              {
                type: "text",
                text: `Bulk data exports:\n\n${items}`,
              },
            ],
          };
        }
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // =====================
  // SCRYFALL: MIGRATIONS
  // =====================

  server.tool(
    "scryfall_migrations",
    "Get card migration data from Scryfall. Useful for tracking when cards are merged, split, or otherwise changed between updates.",
    {
      id: z
        .string()
        .optional()
        .describe("Specific migration ID. Omit to list recent migrations."),
    },
    async ({ id }) => {
      try {
        if (id) {
          const data = (await scryfall.getMigration(id)) as any;
          return {
            content: [
              {
                type: "text",
                text: `Migration ${data.id}:\nType: ${data.migration_strategy}\nOld: ${data.old_scryfall_id}\nNew: ${data.new_scryfall_id || "N/A"}\nNote: ${data.note || "None"}\nDate: ${data.performed_at}`,
              },
            ],
          };
        } else {
          const data = (await scryfall.listMigrations()) as any;
          const items = (data.data || [])
            .slice(0, 50)
            .map(
              (m: any) =>
                `${m.performed_at} | ${m.migration_strategy.padEnd(10)} | ${m.note || "No note"}`
            )
            .join("\n");
          return {
            content: [
              {
                type: "text",
                text: `Recent migrations (showing up to 50):\n\n${items}`,
              },
            ],
          };
        }
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // =====================
  // MTG API: BOOSTER
  // =====================

  server.tool(
    "mtg_generate_booster",
    "Generate a random booster pack for a specific set. Uses the magicthegathering.io API to simulate opening a booster.",
    {
      set_code: z
        .string()
        .describe("Set code (e.g., 'MH3', 'DMU', 'ONE')"),
    },
    async ({ set_code }) => {
      try {
        const data = (await mtgApi.generateBooster(set_code)) as any;
        const cards = (data.cards || [])
          .map(
            (c: any) =>
              `[${c.rarity}] ${c.name} - ${c.type} ${c.manaCost || ""}`
          )
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: `Booster pack from ${set_code}:\n\n${cards}`,
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // =====================
  // UTILITY: PRICE CHECK
  // =====================

  server.tool(
    "scryfall_price_check",
    "Look up current prices for a card by name. Returns USD, EUR, and MTGO tix prices when available.",
    {
      name: z.string().describe("Card name (exact or fuzzy)"),
      set: z
        .string()
        .optional()
        .describe("Optional set code to get specific printing"),
    },
    async ({ name, set }) => {
      try {
        const card = (await scryfall.getCardByName({
          fuzzy: name,
          set,
        })) as any;
        const prices = card.prices || {};
        const lines = [
          `**${card.name}** (${card.set_name}, ${card.set})`,
          "",
          "Prices:",
          prices.usd ? `  USD: $${prices.usd}` : null,
          prices.usd_foil ? `  USD (foil): $${prices.usd_foil}` : null,
          prices.usd_etched ? `  USD (etched): $${prices.usd_etched}` : null,
          prices.eur ? `  EUR: \u20ac${prices.eur}` : null,
          prices.eur_foil ? `  EUR (foil): \u20ac${prices.eur_foil}` : null,
          prices.tix ? `  MTGO Tix: ${prices.tix}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        const hasAnyPrice = Object.values(prices).some((v) => v != null);
        return {
          content: [
            {
              type: "text",
              text: hasAnyPrice ? lines : `${lines}\n\nNo price data available for this printing.`,
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // =====================
  // UTILITY: FORMAT LEGALITY
  // =====================

  server.tool(
    "scryfall_check_legality",
    "Check which formats a card is legal in.",
    {
      name: z.string().describe("Card name"),
    },
    async ({ name }) => {
      try {
        const card = (await scryfall.getCardByName({ fuzzy: name })) as any;
        const legalities = card.legalities || {};
        const lines = [
          `**${card.name}** format legality:`,
          "",
          ...Object.entries(legalities).map(
            ([format, status]) => `  ${format.padEnd(15)} ${status}`
          ),
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
