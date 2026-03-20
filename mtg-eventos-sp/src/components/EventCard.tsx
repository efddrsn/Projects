"use client";

import { MtgEvent } from "@/lib/types";

interface EventCardProps {
  event: MtgEvent;
}

const FORMAT_COLORS: Record<string, string> = {
  standard: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  modern: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  pioneer: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  legacy: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  vintage: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  commander: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  edh: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  pauper: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  draft: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  sealed: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  prerelease: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  "pre-release": "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
};

export default function EventCard({ event }: EventCardProps) {
  const formatColor =
    FORMAT_COLORS[event.format?.toLowerCase() || ""] ||
    "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug">
            {event.name}
          </h3>
          {event.format && (
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${formatColor}`}
            >
              {event.format}
            </span>
          )}
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>{event.date}</span>
            {event.time && (
              <>
                <span className="text-gray-300 dark:text-gray-600">•</span>
                <span>{event.time}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <span>{event.store}</span>
          </div>

          {event.location && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{event.location}</span>
            </div>
          )}

          {event.price && (
            <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{event.price}</span>
            </div>
          )}
        </div>

        {event.description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-4">
            {event.description}
          </p>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-700">
          <a
            href={event.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Fonte: {event.sourceName}
          </a>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {new Date(event.scrapedAt).toLocaleString("pt-BR")}
          </span>
        </div>
      </div>
    </div>
  );
}
