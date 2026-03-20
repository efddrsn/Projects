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
    if (!res.ok) {
      throw new Error(
        res.status === 403
          ? "HTTP 403 — Site bloqueou acesso direto. Use o método Firecrawl."
          : `HTTP ${res.status}`
      );
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseLigaMagic(html: string, source: ScrapeSource): MtgEvent[] {
  const $ = cheerio.load(html);
  const events: MtgEvent[] = [];
  const now = new Date().toISOString();
  const baseUrl = "https://www.ligamagic.com.br";

  const eventKeywords =
    /torneio|evento|liga|fest|campeonato|circuito|rcq|rptq|pptq|ptq|open|grand prix|gp|championship|qualifier|prerelease|pré-release/i;

  $(".row").each((_i, el) => {
    const $row = $(el);
    const $feedInfo = $row.find(".feed-info");
    if ($feedInfo.length === 0) return;

    const title = $feedInfo.find(".title").first().text().trim();
    const subtitle = $feedInfo.find(".subtitle").first().text().trim();
    const fullText = `${title} ${subtitle}`;

    if (!eventKeywords.test(fullText)) return;

    const dateAuthor = $feedInfo.find(".date-author").text().trim();
    const linkEl = $feedInfo.find("a[href]").first();
    const href = linkEl.attr("href") || "";
    const eventUrl = href.startsWith("http")
        ? href
        : `${baseUrl}/${href.replace(/^\.?\/?/, "")}`;

    const imgEl = $row.find(".feed-img img").first();
    const imgSrc = imgEl.attr("data-src") || imgEl.attr("src");
    const imageUrl = imgSrc
      ? imgSrc.startsWith("http")
        ? imgSrc
        : `https:${imgSrc}`
      : undefined;

    const tags = $feedInfo
      .find(".tags a")
      .map((_j, t) => $(t).text().trim())
      .get()
      .join(" ");

    const formatMatch = `${fullText} ${tags}`.match(
      /\b(Standard|Modern|Pioneer|Legacy|Vintage|Commander|EDH|Pauper|Draft|Sealed|Prerelease|Pre-release|Pré-release)\b/i
    );

    const dateMatch = fullText.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    const priceMatch = fullText.match(/R\$\s*[\d.,]+/);

    events.push({
      id: generateId(source.id, title, dateMatch?.[0] || "tbd"),
      name: title,
      date: dateMatch ? dateMatch[0] : "Data a confirmar",
      store: source.name,
      format: formatMatch ? formatMatch[1] : undefined,
      price: priceMatch ? priceMatch[0] : undefined,
      description: subtitle || fullText.slice(0, 300),
      sourceUrl: eventUrl,
      sourceName: source.name,
      imageUrl,
      scrapedAt: now,
    });
  });

  $(".social-text .social-left .social-class > div, .social-text .social-right .social-class > div, .social-text div > div").each(
    (_i, el) => {
      const $div = $(el);
      const $link = $div.find("a.social-title");
      if ($link.length === 0) return;

      const title = $link.text().trim();
      if (!eventKeywords.test(title)) return;

      const href = $link.attr("href") || "";
      const eventUrl = href.startsWith("http")
        ? href
        : `${baseUrl}/${href.replace(/^\.?\/?/, "")}`;

      const alreadyHas = events.some((e) => e.name === title);
      if (alreadyHas) return;

      events.push({
        id: generateId(source.id, title, "forum"),
        name: title,
        date: "Data a confirmar",
        store: source.name,
        description: $div.text().replace(/\s+/g, " ").trim().slice(0, 300),
        sourceUrl: eventUrl,
        sourceName: source.name,
        scrapedAt: now,
      });
    }
  );

  return events;
}

function parseCardTutor(html: string, source: ScrapeSource): MtgEvent[] {
  const $ = cheerio.load(html);
  const events: MtgEvent[] = [];
  const now = new Date().toISOString();

  $(
    ".ecom-item, .product-item, .item-box, .evento-item, li.item, [class*='produto']"
  ).each((_i, el) => {
    const $el = $(el);
    const name =
      $el
        .find(
          "h2, h3, h4, .title, .name, .produto-nome, .item-name, a[title]"
        )
        .first()
        .text()
        .trim() || $el.find("a").first().text().trim();
    if (!name) return;

    const fullText = $el.text();
    const dateMatch = fullText.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    const date = dateMatch ? dateMatch[0] : "Data a confirmar";
    const timeMatch = fullText.match(/(\d{1,2}:\d{2})/);
    const priceMatch = fullText.match(
      /R\$\s*[\d.,]+|(?:entrada|inscrição)[\s:]*R?\$?\s*[\d.,]+/i
    );
    const formatMatch = fullText.match(
      /\b(Standard|Modern|Pioneer|Legacy|Vintage|Commander|EDH|Pauper|Draft|Sealed|Prerelease|Pre-release|Pré-release)\b/i
    );
    const img =
      $el.find("img").first().attr("src") ||
      $el.find("img").first().attr("data-src");

    events.push({
      id: generateId(source.id, name, date),
      name,
      date,
      time: timeMatch ? timeMatch[1] : undefined,
      store: source.name,
      format: formatMatch ? formatMatch[1] : undefined,
      price: priceMatch ? priceMatch[0] : undefined,
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
  });

  return events;
}

function parseGeneric(html: string, source: ScrapeSource): MtgEvent[] {
  const $ = cheerio.load(html);
  const events: MtgEvent[] = [];
  const now = new Date().toISOString();

  const selectors = [
    ".event",
    ".evento",
    "[class*='event']",
    "[class*='evento']",
    ".product-item",
    "article",
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
    const eventKeywords =
      /torneio|evento|prerelease|pré-release|campeonato|liga|circuito/i;

    for (const line of lines) {
      if (dateRegex.test(line) && eventKeywords.test(line)) {
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
      $el
        .find("h1, h2, h3, h4, .title, .name, .evento-nome")
        .first()
        .text()
        .trim() ||
      $el.find("a").first().text().trim() ||
      text.slice(0, 80);

    const dateMatch = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    const date = dateMatch ? dateMatch[0] : "";

    const eventRelated =
      /torneio|evento|prerelease|pré-release|campeonato|liga|circuito|draft|sealed/i.test(
        text
      );

    if (!date && !eventRelated) return;

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
    } else if (source.id === "ligamagic") {
      events = parseLigaMagic(html, source);
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
