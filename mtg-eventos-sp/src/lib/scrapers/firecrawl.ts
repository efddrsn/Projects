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

interface FirecrawlResponse {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: Record<string, unknown>;
    content?: string;
  };
  error?: string;
}

function extractEventsFromMarkdown(
  markdown: string,
  source: ScrapeSource
): MtgEvent[] {
  const events: MtgEvent[] = [];
  const now = new Date().toISOString();
  const lines = markdown.split("\n");

  const dateRegex = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/g;
  const mtgKeywords =
    /magic|mtg|torneio|evento|standard|modern|pioneer|legacy|commander|edh|draft|sealed|pauper|prerelease|pré-release/i;
  const formatRegex =
    /\b(Standard|Modern|Pioneer|Legacy|Vintage|Commander|EDH|Pauper|Draft|Sealed|Prerelease|Pre-release|Pré-release)\b/i;
  const priceRegex = /R\$\s*[\d.,]+/;
  const timeRegex = /(\d{1,2}[h:]\d{2})/;

  let currentHeading = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("#")) {
      currentHeading = line.replace(/^#+\s*/, "");
      continue;
    }

    const dates = line.match(dateRegex);
    if (!dates) continue;

    const contextWindow = lines
      .slice(Math.max(0, i - 2), Math.min(lines.length, i + 3))
      .join(" ");

    if (!mtgKeywords.test(contextWindow) && !mtgKeywords.test(currentHeading)) {
      continue;
    }

    for (const dateStr of dates) {
      const name =
        line
          .replace(dateRegex, "")
          .replace(/^\s*[-*|]\s*/, "")
          .trim()
          .slice(0, 120) || currentHeading;

      if (!name || name.length < 3) continue;

      const formatMatch = contextWindow.match(formatRegex);
      const priceMatch = contextWindow.match(priceRegex);
      const timeMatch = contextWindow.match(timeRegex);

      events.push({
        id: generateId(source.id, name, dateStr),
        name,
        date: dateStr,
        time: timeMatch ? timeMatch[1] : undefined,
        store: source.name,
        format: formatMatch ? formatMatch[1] : undefined,
        price: priceMatch ? priceMatch[0] : undefined,
        description: contextWindow.replace(/\s+/g, " ").trim().slice(0, 300),
        sourceUrl: source.url,
        sourceName: source.name,
        scrapedAt: now,
      });
    }
  }

  if (events.length === 0) {
    const sections = markdown.split(/(?=^#{1,4}\s)/m);
    for (const section of sections) {
      const sectionDates = section.match(dateRegex);
      if (!sectionDates && !mtgKeywords.test(section)) continue;

      const heading = section.match(/^#{1,4}\s+(.+)/m);
      const name = heading ? heading[1].trim() : section.trim().slice(0, 80);
      const date = sectionDates ? sectionDates[0] : "Data a confirmar";
      const formatMatch = section.match(formatRegex);
      const priceMatch = section.match(priceRegex);
      const timeMatch = section.match(timeRegex);

      if (name.length >= 3 && mtgKeywords.test(section)) {
        events.push({
          id: generateId(source.id, name, date),
          name,
          date,
          time: timeMatch ? timeMatch[1] : undefined,
          store: source.name,
          format: formatMatch ? formatMatch[1] : undefined,
          price: priceMatch ? priceMatch[0] : undefined,
          description: section.replace(/\s+/g, " ").trim().slice(0, 300),
          sourceUrl: source.url,
          sourceName: source.name,
          scrapedAt: now,
        });
      }
    }
  }

  const seen = new Set<string>();
  return events.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

export async function scrapeWithFirecrawl(
  source: ScrapeSource,
  apiKey: string
): Promise<ScrapeResult> {
  const now = new Date().toISOString();

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: source.url,
        formats: ["markdown"],
        waitFor: 5000,
        timeout: 30000,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Firecrawl API error ${res.status}: ${text}`);
    }

    const data: FirecrawlResponse = await res.json();
    if (!data.success) {
      throw new Error(data.error || "Firecrawl returned unsuccessful response");
    }

    const markdown = data.data?.markdown || data.data?.content || "";
    const events = extractEventsFromMarkdown(markdown, source);

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
