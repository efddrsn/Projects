import { ScrapeSource } from "./types";

export const DEFAULT_SOURCES: ScrapeSource[] = [
  {
    id: "cardtutor",
    name: "Card Tutor",
    url: "https://www.cardtutor.com.br/?view=ecom/itens&cat=201151",
    enabled: true,
    description: "Loja de cards em São Paulo com eventos regulares de MTG",
  },
  {
    id: "ligamagic",
    name: "LigaMagic - Eventos SP",
    url: "https://www.ligamagic.com.br/?view=dci/events&city=S%C3%A3o+Paulo&state=SP",
    enabled: true,
    description: "Principal plataforma de Magic no Brasil - calendário de eventos",
  },
  {
    id: "bazar-baghdad",
    name: "Bazar de Bagdá",
    url: "https://www.bazardebagda.com.br/eventos",
    enabled: true,
    description: "Loja tradicional de cards em São Paulo",
  },
  {
    id: "mtg-cards",
    name: "MTG Cards",
    url: "https://www.mtgcards.com.br/eventos",
    enabled: true,
    description: "Loja de cards com eventos de Magic em SP",
  },
];
