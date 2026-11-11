import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UrugoLink | Find a home in Rwanda",
  description: "Discover homes to rent and buy across Rwanda. Connect directly with property owners.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
