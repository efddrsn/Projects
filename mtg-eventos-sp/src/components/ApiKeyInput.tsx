"use client";

import { useState } from "react";

interface ApiKeyInputProps {
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  method: string;
  onMethodChange: (method: string) => void;
}

export default function ApiKeyInput({
  apiKey,
  onApiKeyChange,
  method,
  onMethodChange,
}: ApiKeyInputProps) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
        Configurações de Scraping
      </h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Método de Scraping
          </label>
          <div className="flex gap-3">
            <button
              onClick={() => onMethodChange("direct")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                method === "direct"
                  ? "bg-purple-600 text-white shadow-md"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              Direto (HTTP + Cheerio)
            </button>
            <button
              onClick={() => onMethodChange("firecrawl")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                method === "firecrawl"
                  ? "bg-orange-500 text-white shadow-md"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              Firecrawl API
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {method === "direct"
              ? "Scraping direto via HTTP — funciona sem API key, mas pode falhar em sites com JavaScript pesado."
              : "Usa a API do Firecrawl para renderizar páginas com JavaScript. Requer API key."}
          </p>
        </div>

        {method === "firecrawl" && (
          <div>
            <label
              htmlFor="api-key"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Firecrawl API Key
            </label>
            <div className="relative">
              <input
                id="api-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder="fc-..."
                className="w-full px-4 py-2.5 pr-20 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                {showKey ? "Ocultar" : "Mostrar"}
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              Obtenha sua chave em{" "}
              <a
                href="https://firecrawl.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-600 hover:text-purple-700 underline"
              >
                firecrawl.dev
              </a>
              . A chave fica salva apenas no seu navegador.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
