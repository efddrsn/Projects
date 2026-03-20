"use client";

import { useState, useEffect, useCallback } from "react";
import { MtgEvent, ScrapeSource, ScraperMethod } from "@/lib/types";
import { DEFAULT_SOURCES } from "@/lib/sources";
import ApiKeyInput from "@/components/ApiKeyInput";
import SourceManager from "@/components/SourceManager";
import EventFeed from "@/components/EventFeed";

export default function Home() {
  const [events, setEvents] = useState<MtgEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ source: string; error?: string }[]>([]);
  const [method, setMethod] = useState<ScraperMethod>("firecrawl");
  const [apiKey, setApiKey] = useState("");
  const [sources, setSources] = useState<ScrapeSource[]>(DEFAULT_SOURCES);
  const [lastScrape, setLastScrape] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("mtg-sp-api-key");
    if (saved) setApiKey(saved);

    const savedMethod = localStorage.getItem("mtg-sp-method");
    if (savedMethod) setMethod(savedMethod as ScraperMethod);

    const savedSources = localStorage.getItem("mtg-sp-sources");
    if (savedSources) {
      try {
        setSources(JSON.parse(savedSources));
      } catch {
        /* ignore */
      }
    }

    const savedEvents = localStorage.getItem("mtg-sp-events");
    if (savedEvents) {
      try {
        const parsed = JSON.parse(savedEvents);
        setEvents(parsed.events || []);
        setLastScrape(parsed.scrapedAt || null);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("mtg-sp-api-key", apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem("mtg-sp-method", method);
  }, [method]);

  useEffect(() => {
    localStorage.setItem("mtg-sp-sources", JSON.stringify(sources));
  }, [sources]);

  const scrapeEvents = useCallback(async () => {
    setLoading(true);
    setErrors([]);

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources,
          method,
          firecrawlApiKey: method === "firecrawl" ? apiKey : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrors([{ source: "API", error: data.error }]);
        return;
      }

      setEvents(data.events || []);
      setErrors(data.errors || []);
      setLastScrape(data.scrapedAt);

      localStorage.setItem(
        "mtg-sp-events",
        JSON.stringify({
          events: data.events,
          scrapedAt: data.scrapedAt,
        })
      );
    } catch (err) {
      setErrors([
        {
          source: "Rede",
          error: err instanceof Error ? err.message : "Erro de conexão",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [sources, method, apiKey]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center shadow-md">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
                MTG Eventos SP
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
                Tracker de eventos de Magic: The Gathering em São Paulo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {lastScrape && (
              <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block">
                Última busca:{" "}
                {new Date(lastScrape).toLocaleString("pt-BR")}
              </span>
            )}
            <button
              onClick={scrapeEvents}
              disabled={loading || (method === "firecrawl" && !apiKey)}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-sm font-medium hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg active:scale-[0.98]"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Buscando...
                </span>
              ) : (
                "Buscar Eventos"
              )}
            </button>
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex gap-6">
          {/* Sidebar - desktop */}
          <aside className="hidden lg:block w-80 flex-shrink-0 space-y-4">
            <ApiKeyInput
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              method={method}
              onMethodChange={(m) => setMethod(m as ScraperMethod)}
            />
            <SourceManager sources={sources} onSourcesChange={setSources} />
          </aside>

          {/* Mobile sidebar overlay */}
          {showSidebar && (
            <div className="lg:hidden fixed inset-0 z-40">
              <div
                className="absolute inset-0 bg-black/50"
                onClick={() => setShowSidebar(false)}
              />
              <div className="absolute right-0 top-0 bottom-0 w-80 max-w-[90vw] bg-gray-50 dark:bg-gray-950 p-4 overflow-y-auto space-y-4 shadow-xl">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Configurações
                  </h2>
                  <button
                    onClick={() => setShowSidebar(false)}
                    className="p-1 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <ApiKeyInput
                  apiKey={apiKey}
                  onApiKeyChange={setApiKey}
                  method={method}
                  onMethodChange={(m) => setMethod(m as ScraperMethod)}
                />
                <SourceManager sources={sources} onSourcesChange={setSources} />
              </div>
            </div>
          )}

          {/* Main content */}
          <main className="flex-1 min-w-0">
            <EventFeed events={events} loading={loading} errors={errors} />
          </main>
        </div>
      </div>

      <footer className="border-t border-gray-200 dark:border-gray-800 mt-8 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            MTG Eventos SP — Dados coletados automaticamente de fontes públicas.
            Sempre verifique as informações diretamente nas fontes antes de ir a um evento.
          </p>
        </div>
      </footer>
    </div>
  );
}
