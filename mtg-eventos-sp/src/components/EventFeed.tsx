"use client";

import { MtgEvent } from "@/lib/types";
import EventCard from "./EventCard";
import { useState, useMemo } from "react";

interface EventFeedProps {
  events: MtgEvent[];
  loading: boolean;
  errors: { source: string; error?: string }[];
}

export default function EventFeed({ events, loading, errors }: EventFeedProps) {
  const [filterFormat, setFilterFormat] = useState<string>("all");
  const [filterStore, setFilterStore] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "store" | "format">("date");

  const formats = useMemo(() => {
    const set = new Set(events.map((e) => e.format).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [events]);

  const stores = useMemo(() => {
    const set = new Set(events.map((e) => e.store));
    return Array.from(set).sort();
  }, [events]);

  const filtered = useMemo(() => {
    let result = events;
    if (filterFormat !== "all") {
      result = result.filter(
        (e) => e.format?.toLowerCase() === filterFormat.toLowerCase()
      );
    }
    if (filterStore !== "all") {
      result = result.filter((e) => e.store === filterStore);
    }

    result = [...result].sort((a, b) => {
      if (sortBy === "store") return a.store.localeCompare(b.store);
      if (sortBy === "format")
        return (a.format || "zzz").localeCompare(b.format || "zzz");
      const parseDate = (d: string) => {
        const m = d.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
        if (!m) return 0;
        const year = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
        return new Date(year, parseInt(m[2]) - 1, parseInt(m[1])).getTime();
      };
      return parseDate(a.date) - parseDate(b.date);
    });

    return result;
  }, [events, filterFormat, filterStore, sortBy]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="relative w-16 h-16 mb-4">
          <div className="absolute inset-0 border-4 border-purple-200 dark:border-purple-900 rounded-full" />
          <div className="absolute inset-0 border-4 border-transparent border-t-purple-600 rounded-full animate-spin" />
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          Buscando eventos de Magic em São Paulo...
        </p>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          Isso pode levar alguns segundos
        </p>
      </div>
    );
  }

  return (
    <div>
      {errors.length > 0 && (
        <div className="mb-6 space-y-2">
          {errors.map((err, i) => (
            <div
              key={i}
              className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30 text-sm"
            >
              <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <span className="font-medium text-red-800 dark:text-red-300">
                  {err.source}:
                </span>{" "}
                <span className="text-red-600 dark:text-red-400">
                  {err.error}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {events.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Formato
            </label>
            <select
              value={filterFormat}
              onChange={(e) => setFilterFormat(e.target.value)}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 outline-none"
            >
              <option value="all">Todos</option>
              {formats.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Loja
            </label>
            <select
              value={filterStore}
              onChange={(e) => setFilterStore(e.target.value)}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 outline-none"
            >
              <option value="all">Todas</option>
              {stores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Ordenar
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 outline-none"
            >
              <option value="date">Data</option>
              <option value="store">Loja</option>
              <option value="format">Formato</option>
            </select>
          </div>

          <span className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
            {filtered.length} de {events.length} eventos
          </span>
        </div>
      )}

      {events.length === 0 && !loading ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-1">
            Nenhum evento encontrado
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Clique em &quot;Buscar Eventos&quot; para começar a buscar
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
