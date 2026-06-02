import { Outfit, Lora } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

export const metadata = {
  title: "MangaScribe AI - Chuyển đổi Manga thành Tiểu thuyết",
  description: "Chuyển đổi truyện tranh Manga thành tiểu thuyết chữ sinh động bằng AI",
  other: {
    google: "notranslate"
  }
};

import Providers from "@/components/Providers";

export default function RootLayout({ children }) {
  return (
    <html
      lang="vi"
      translate="no"
      className={`${outfit.variable} ${lora.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning translate="no">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
