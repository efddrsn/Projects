export interface MtgEvent {
  id: string;
  name: string;
  date: string;
  time?: string;
  location?: string;
  store: string;
  format?: string;
  price?: string;
  description?: string;
  sourceUrl: string;
  sourceName: string;
  imageUrl?: string;
  scrapedAt: string;
}

export interface ScrapeSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  description: string;
}

export interface ScrapeResult {
  source: string;
  sourceUrl: string;
  events: MtgEvent[];
  error?: string;
  scrapedAt: string;
}

export type ScraperMethod = "firecrawl" | "direct";
