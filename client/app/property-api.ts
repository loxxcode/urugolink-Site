/* Data layer: talks to your Express/Mongo API (Server.js). Works on the server (page.tsx) and in the browser (modals). */
export const API = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

/** Exactly what publicDetail() in Server.js returns */
export type Property = {
  id: string; ref?: string; slug?: string; title: string;
  mode: "rent" | "sale"; propertyType: string; priceRwf: number;
  bedrooms?: number; bathrooms?: number; areaSqm?: number;
  district?: string; province?: string; neighbourhood?: string;
  coverUrl?: string; tag?: string | null; ownerName?: string; ownerPhone?: string;
  publishedAt?: string; isFeatured?: boolean; stats?: { saves: number };
  description: string[]; depositMonths?: number; minLeaseMonths?: number;
  availableFrom?: string; furnishing?: "furnished" | "semi_furnished" | "unfurnished";
  yearBuilt?: number; parkingSpaces?: number; amenities: string[];
  nearby: { label: string; distance: string }[];
  gallery: string[]; image?: string;
  location?: { point?: { coordinates?: [number, number] } }; // GeoJSON: [lng, lat]
  ownerId?: string; status?: string;
};
export type Card = Pick<Property, "id" | "slug" | "title" | "mode" | "propertyType" | "priceRwf" | "bedrooms" | "bathrooms" | "areaSqm" | "district" | "province" | "coverUrl" | "tag">;

export async function fetchProperty(key: string): Promise<Property | null> {
  try {
    const r = await fetch(`${API}/api/properties/${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.data ?? null) as Property | null;
  } catch { return null; }
}

export async function fetchSimilar(id: string): Promise<Card[]> {
  try {
    const r = await fetch(`${API}/api/properties/${id}/similar`, { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    return ((j.data ?? []) as Card[]).slice(0, 3);
  } catch { return []; }
}