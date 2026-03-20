import * as cheerio from "cheerio";
import { MtgEvent, ScrapeResult, ScrapeSource } from "../types";

function generateId(source: string, name: string, date: string): string {
  const raw = `${source}-${name}-${date}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseCardTutor(
  html: string,
  source: ScrapeSource
): MtgEvent[] {
  const $ = cheerio.load(html);
  const events: MtgEvent[] = [];
  const now = new Date().toISOString();

  $(".ecom-item, .product-item, .item-box, .evento-item, li.item, .card, [class*='event'], [class*='produto']").each(
    (_i, el) => {
      const $el = $(el);
      const name =
        $el.find("h2, h3, h4, .title, .name, .produto-nome, .item-name, a[title]").first().text().trim() ||
        $el.find("a").first().text().trim();
      if (!name) return;

      const fullText = $el.text();
      const dateMatch = fullText.match(
        /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/
      );
      const date = dateMatch ? dateMatch[0] : "Data a confirmar";

      const timeMatch = fullText.match(/(\d{1,2}:\d{2})/);
      const time = timeMatch ? timeMatch[1] : undefined;

      const priceMatch = fullText.match(
        /R\$\s*[\d.,]+|(?:entrada|inscrição)[\s:]*R?\$?\s*[\d.,]+/i
      );
      const price = priceMatch ? priceMatch[0] : undefined;

      const formatMatch = fullText.match(
        /\b(Standard|Modern|Pioneer|Legacy|Vintage|Commander|EDH|Pauper|Draft|Sealed|Prerelease|Pre-release|Pré-release)\b/i
      );
      const format = formatMatch ? formatMatch[1] : undefined;

      const img =
        $el.find("img").first().attr("src") ||
        $el.find("img").first().attr("data-src");

      events.push({
        id: generateId(source.id, name, date),
        name,
        date,
        time,
        store: source.name,
        format,
        price,
        description: fullText.replace(/\s+/g, " ").trim().slice(0, 300),
        sourceUrl: source.url,
        sourceName: source.name,
        imageUrl: img
          ? img.startsWith("http")
            ? img
            : new URL(img, source.url).href
          : undefined,
        scrapedAt: now,
      });
    }
  );

  return events;
}

function parseGeneric(
  html: string,
  source: ScrapeSource
): MtgEvent[] {
  const $ = cheerio.load(html);
  const events: MtgEvent[] = [];
  const now = new Date().toISOString();

  const selectors = [
    ".event",
    ".evento",
    "[class*='event']",
    "[class*='evento']",
    ".product-item",
    ".item",
    "article",
    ".card",
    "tr",
  ];

  let foundSelector = "";
  for (const sel of selectors) {
    if ($(sel).length > 0) {
      foundSelector = sel;
      break;
    }
  }

  const $items = foundSelector ? $(foundSelector) : null;

  if (!$items || $items.length === 0) {
    const text = $("body").text();
    const lines = text.split("\n").filter((l) => l.trim().length > 10);

    const dateRegex = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/;
    const mtgKeywords =
      /magic|mtg|torneio|evento|standard|modern|pioneer|legacy|commander|edh|draft|sealed|pauper|prerelease/i;

    for (const line of lines) {
      if (dateRegex.test(line) && mtgKeywords.test(line)) {
        const dateMatch = line.match(dateRegex);
        const date = dateMatch ? dateMatch[0] : "Data a confirmar";
        const name = line.trim().slice(0, 120);

        events.push({
          id: generateId(source.id, name, date),
          name,
          date,
          store: source.name,
          sourceUrl: source.url,
          sourceName: source.name,
          description: line.trim(),
          scrapedAt: now,
        });
      }
    }
    return events;
  }

  $items.each((_i, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (text.length < 5) return;

    const name =
      $el.find("h1, h2, h3, h4, .title, .name, .evento-nome").first().text().trim() ||
      $el.find("a").first().text().trim() ||
      text.slice(0, 80);

    const dateMatch = text.match(
      /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/
    );
    const date = dateMatch ? dateMatch[0] : "";

    const mtgRelated =
      /magic|mtg|torneio|evento|standard|modern|pioneer|legacy|commander|edh|draft|sealed|pauper|prerelease/i.test(
        text
      );

    if (!date && !mtgRelated) return;

    const timeMatch = text.match(/(\d{1,2}:\d{2})/);
    const priceMatch = text.match(/R\$\s*[\d.,]+/);
    const formatMatch = text.match(
      /\b(Standard|Modern|Pioneer|Legacy|Vintage|Commander|EDH|Pauper|Draft|Sealed|Prerelease|Pre-release)\b/i
    );

    events.push({
      id: generateId(source.id, name, date),
      name,
      date: date || "Data a confirmar",
      time: timeMatch ? timeMatch[1] : undefined,
      store: source.name,
      format: formatMatch ? formatMatch[1] : undefined,
      price: priceMatch ? priceMatch[0] : undefined,
      description: text.replace(/\s+/g, " ").trim().slice(0, 300),
      sourceUrl: source.url,
      sourceName: source.name,
      scrapedAt: now,
    });
  });

  return events;
}

export async function scrapeDirect(
  source: ScrapeSource
): Promise<ScrapeResult> {
  const now = new Date().toISOString();
  try {
    const html = await fetchPage(source.url);

    let events: MtgEvent[];
    if (source.id === "cardtutor") {
      events = parseCardTutor(html, source);
    } else {
      events = parseGeneric(html, source);
    }

    const seen = new Set<string>();
    events = events.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    return {
      source: source.name,
      sourceUrl: source.url,
      events,
      scrapedAt: now,
    };
  } catch (err) {
    return {
      source: source.name,
      sourceUrl: source.url,
      events: [],
      error: err instanceof Error ? err.message : String(err),
      scrapedAt: now,
    };
  }
}
