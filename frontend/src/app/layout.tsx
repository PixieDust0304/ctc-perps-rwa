import type { Metadata } from "next";
import { Providers } from "./providers";
import { PixelTransition } from "../components/PixelTransition";
import "./globals.css";

export const metadata: Metadata = {
  title: "pErp-man | Commodities Perpetual Futures",
  description: "Trade commodity perpetual futures on pErp-man",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Providers>
          <PixelTransition>{children}</PixelTransition>
        </Providers>
      </body>
    </html>
  );
}
