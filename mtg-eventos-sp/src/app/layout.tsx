import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MTG Eventos SP - Tracker de Eventos de Magic em São Paulo",
  description:
    "Acompanhe os próximos eventos de Magic: The Gathering em São Paulo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
