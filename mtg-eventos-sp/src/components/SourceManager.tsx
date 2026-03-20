"use client";

import { useState } from "react";
import { ScrapeSource } from "@/lib/types";

interface SourceManagerProps {
  sources: ScrapeSource[];
  onSourcesChange: (sources: ScrapeSource[]) => void;
}

export default function SourceManager({
  sources,
  onSourcesChange,
}: SourceManagerProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newName, setNewName] = useState("");

  const toggleSource = (id: string) => {
    onSourcesChange(
      sources.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const removeSource = (id: string) => {
    onSourcesChange(sources.filter((s) => s.id !== id));
  };

  const addSource = () => {
    if (!newUrl.trim()) return;
    const id = newUrl
      .replace(/https?:\/\//, "")
      .replace(/[^a-z0-9]/gi, "-")
      .slice(0, 30);
    const name = newName.trim() || new URL(newUrl).hostname;

    onSourcesChange([
      ...sources,
      {
        id,
        name,
        url: newUrl.trim(),
        enabled: true,
        description: "Fonte customizada",
      },
    ]);
    setNewUrl("");
    setNewName("");
    setShowAddForm(false);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Fontes
        </h2>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-sm px-3 py-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors font-medium"
        >
          {showAddForm ? "Cancelar" : "+ Adicionar"}
        </button>
      </div>

      {showAddForm && (
        <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="space-y-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome da fonte (opcional)"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            />
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            />
            <button
              onClick={addSource}
              disabled={!newUrl.trim()}
              className="w-full px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Adicionar Fonte
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {sources.map((source) => (
          <div
            key={source.id}
            className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
              source.enabled
                ? "bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/30"
                : "bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 opacity-60"
            }`}
          >
            <button
              onClick={() => toggleSource(source.id)}
              className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border-2 transition-colors ${
                source.enabled
                  ? "bg-green-500 border-green-500 text-white"
                  : "border-gray-300 dark:border-gray-600"
              }`}
            >
              {source.enabled && (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {source.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {source.url}
              </p>
            </div>
            <button
              onClick={() => removeSource(source.id)}
              className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
              title="Remover fonte"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
