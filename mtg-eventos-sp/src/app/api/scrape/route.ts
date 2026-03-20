import { NextRequest, NextResponse } from "next/server";
import { ScrapeSource, ScrapeResult, ScraperMethod } from "@/lib/types";
import { DEFAULT_SOURCES } from "@/lib/sources";
import { scrapeDirect } from "@/lib/scrapers/direct";
import { scrapeWithFirecrawl } from "@/lib/scrapers/firecrawl";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      sources,
      method,
      firecrawlApiKey,
    }: {
      sources?: ScrapeSource[];
      method?: ScraperMethod;
      firecrawlApiKey?: string;
    } = body;

    const sourcesToScrape = sources?.filter((s) => s.enabled) ??
      DEFAULT_SOURCES.filter((s) => s.enabled);
    const scraperMethod: ScraperMethod = method || "direct";

    if (scraperMethod === "firecrawl" && !firecrawlApiKey) {
      return NextResponse.json(
        { error: "Firecrawl API key is required when using the Firecrawl method" },
        { status: 400 }
      );
    }

    const results: ScrapeResult[] = await Promise.allSettled(
      sourcesToScrape.map(async (source) => {
        if (scraperMethod === "firecrawl" && firecrawlApiKey) {
          return scrapeWithFirecrawl(source, firecrawlApiKey);
        }
        return scrapeDirect(source);
      })
    ).then((settled) =>
      settled.map((r, i) => {
        if (r.status === "fulfilled") return r.value;
        return {
          source: sourcesToScrape[i].name,
          sourceUrl: sourcesToScrape[i].url,
          events: [],
          error: r.reason?.message || "Unknown error",
          scrapedAt: new Date().toISOString(),
        };
      })
    );

    const allEvents = results.flatMap((r) => r.events);
    const errors = results
      .filter((r) => r.error)
      .map((r) => ({ source: r.source, error: r.error }));

    return NextResponse.json({
      events: allEvents,
      results,
      errors,
      totalEvents: allEvents.length,
      scrapedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
