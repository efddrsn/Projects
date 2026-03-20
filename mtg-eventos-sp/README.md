# MTG Eventos SP

Tracker de eventos de **Magic: The Gathering** em São Paulo. Faz scraping automático de lojas e plataformas de MTG para agregar eventos em um único feed.

## Como usar

```bash
cd mtg-eventos-sp
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Métodos de scraping

### Direto (HTTP + Cheerio)
Faz requisições HTTP e parseia o HTML com Cheerio. Não requer API key, mas muitos sites bloqueiam acesso direto (erro 403) ou renderizam conteúdo via JavaScript.

### Firecrawl API (recomendado)
Usa o [Firecrawl](https://firecrawl.dev) para renderizar páginas completas (incluindo JavaScript). Requer uma API key — insira diretamente na interface. A chave fica salva apenas no localStorage do navegador.

## Fontes padrão

| Fonte | URL |
|-------|-----|
| Card Tutor | https://www.cardtutor.com.br/?view=ecom/itens&cat=201151 |
| LigaMagic | https://www.ligamagic.com.br/?view=dci/events&city=São+Paulo&state=SP |
| Bazar de Bagdá | https://www.bazardebagda.com.br/eventos |
| MTG Cards | https://www.mtgcards.com.br/eventos |

Você pode adicionar ou remover fontes diretamente pela interface.

## Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Cheerio** (parsing HTML)
- **Firecrawl API** (scraping com JS rendering)
