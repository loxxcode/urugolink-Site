export type Listing = {
  id: number;
  title: string;
  district: string;
  province: string;
  price: number;
  mode: "Rent" | "Sale";
  type: string;
  beds: number;
  baths: number;
  area: number;
  image: string;
  tag: string;
  owner: string;
  // --- extended details ---
  description: string[];
  amenities: string[];
  gallery: string[];
  year: number;
  parking: number;
  furnished: "Furnished" | "Semi-furnished" | "Unfurnished";
  available: string; // ISO date
  depositMonths: number; // rent only
  coords: [number, number]; // lat, lon (approximate area)
  nearby: { label: string; distance: string }[];
  ownerPhone: string;
  ownerReply: string;
};

const IMG = (id: string, w = 1400) => `https://images.unsplash.com/photo-${id}?w=${w}&q=85`;
const A = "1600585154340-be6161a56a0c";
const B = "1600607687939-ce8a6c25118c";
const C = "1600566753086-00f18fb6b3ea";
const D = "1600607687920-4e2a09cf159d";
const E = "1600607687644-c7171b42498f";
const gal = (...ids: string[]) => ids.map((i) => IMG(i));

export const listings: Listing[] = [
  {
    id: 1, title: "Modern family home in a quiet neighbourhood", district: "Kicukiro", province: "Kigali",
    price: 850000, mode: "Rent", type: "House", beds: 4, baths: 3, area: 210, image: IMG(A, 1000), tag: "Verified", owner: "Umurava Properties",
    description: [
      "A well-kept four-bedroom family home on a calm residential street in Kicukiro. The ground floor opens from a bright living room into a dining area and a fitted kitchen, with a covered veranda that looks over the garden.",
      "Upstairs, every bedroom has built-in storage and the main suite has its own bathroom. The compound is walled with a gate, space for two cars and a small yard that is ready for children or pets.",
    ],
    amenities: ["Parking", "24/7 Security", "Wi-Fi ready", "Garden", "Water tank", "Backup power", "Fitted kitchen", "Pet friendly"],
    gallery: gal(A, D, E, C, B), year: 2019, parking: 2, furnished: "Unfurnished", available: "2026-11-20", depositMonths: 2,
    coords: [-1.9706, 30.1044],
    nearby: [{ label: "Primary & secondary schools", distance: "5 min drive" }, { label: "Supermarket and pharmacy", distance: "7 min drive" }, { label: "Main road with moto & bus", distance: "3 min walk" }, { label: "Kigali city centre", distance: "25 min drive" }],
    ownerPhone: "+250 700 000 001", ownerReply: "Usually replies within 2 hours",
  },
  {
    id: 2, title: "Bright apartment with a city view", district: "Nyarutarama", province: "Kigali",
    price: 185000000, mode: "Sale", type: "Apartment", beds: 3, baths: 2, area: 145, image: IMG(B, 1000), tag: "Featured", owner: "Kigali Homes Ltd",
    description: [
      "A light-filled three-bedroom apartment on a high floor in Nyarutarama with open views over the city hills. Large windows run along the living area, and the balcony fits a table for four.",
      "The building has a lift, secure parking and a shared gym. The kitchen is fitted and the bedrooms are ready to move into, which makes this a good fit for a family or as a long-term investment.",
    ],
    amenities: ["Parking", "24/7 Security", "Lift", "Gym", "Balcony", "Wi-Fi ready", "Backup power", "Fitted kitchen"],
    gallery: gal(B, A, C, E, D), year: 2021, parking: 1, furnished: "Semi-furnished", available: "2026-11-15", depositMonths: 0,
    coords: [-1.9400, 30.1000],
    nearby: [{ label: "Golf club and restaurants", distance: "4 min drive" }, { label: "International schools", distance: "8 min drive" }, { label: "Convention centre", distance: "12 min drive" }, { label: "Kigali International Airport", distance: "20 min drive" }],
    ownerPhone: "+250 700 000 002", ownerReply: "Usually replies within 1 hour",
  },
  {
    id: 3, title: "Contemporary villa with garden", district: "Rebero", province: "Kigali",
    price: 1200000, mode: "Rent", type: "Villa", beds: 5, baths: 4, area: 320, image: IMG(A, 1000), tag: "New", owner: "Amahoro Realty",
    description: [
      "A five-bedroom contemporary villa on a generous plot in Rebero, with a landscaped garden, a covered terrace and a double-height living room.",
      "The villa includes a separate staff quarter, a large kitchen with pantry and a study that works well as a home office. Hillside views and quiet evenings come with the location.",
    ],
    amenities: ["Parking", "24/7 Security", "Garden", "Swimming pool", "Water tank", "Backup power", "Air conditioning", "Pet friendly", "Wi-Fi ready"],
    gallery: gal(A, E, B, D, C), year: 2023, parking: 3, furnished: "Semi-furnished", available: "2026-12-01", depositMonths: 2,
    coords: [-1.9900, 30.0900],
    nearby: [{ label: "Hilltop cafés and viewpoints", distance: "5 min drive" }, { label: "Shopping centre", distance: "10 min drive" }, { label: "Hospital", distance: "12 min drive" }, { label: "Kigali city centre", distance: "15 min drive" }],
    ownerPhone: "+250 700 000 003", ownerReply: "Usually replies within a day",
  },
  {
    id: 4, title: "Comfortable apartment near amenities", district: "Kimihurura", province: "Kigali",
    price: 95000000, mode: "Sale", type: "Apartment", beds: 2, baths: 2, area: 105, image: IMG(C, 1000), tag: "Verified", owner: "CityNest Rwanda",
    description: [
      "A practical two-bedroom apartment in Kimihurura, within walking distance of cafés, offices and daily shopping. The layout is simple and efficient, with a good-sized living room and two bathrooms.",
      "It suits first-time buyers, young professionals or anyone who wants a low-maintenance home close to the centre.",
    ],
    amenities: ["Parking", "24/7 Security", "Lift", "Wi-Fi ready", "Water tank", "Backup power", "Fitted kitchen"],
    gallery: gal(C, B, D, A, E), year: 2020, parking: 1, furnished: "Unfurnished", available: "2026-11-12", depositMonths: 0,
    coords: [-1.9550, 30.0900],
    nearby: [{ label: "Cafés and restaurants", distance: "3 min walk" }, { label: "Supermarket", distance: "5 min walk" }, { label: "Convention centre", distance: "6 min drive" }, { label: "Kigali city centre", distance: "10 min drive" }],
    ownerPhone: "+250 700 000 004", ownerReply: "Usually replies within 3 hours",
  },
  {
    id: 5, title: "Spacious home for a growing family", district: "Musanze", province: "Northern Province",
    price: 550000, mode: "Rent", type: "House", beds: 3, baths: 2, area: 180, image: IMG(D, 1000), tag: "Good value", owner: "Isaro Estates",
    description: [
      "A roomy three-bedroom house in Musanze with a large fenced yard, a vegetable patch and a covered parking space. The cool climate and mountain views make it a calm place to live.",
      "The home has a bright kitchen, a separate dining room and tiled floors throughout. It is close to schools and the town market.",
    ],
    amenities: ["Parking", "Garden", "Water tank", "Backup power", "Fitted kitchen", "Pet friendly", "24/7 Security"],
    gallery: gal(D, C, A, B, E), year: 2017, parking: 2, furnished: "Unfurnished", available: "2026-11-25", depositMonths: 2,
    coords: [-1.4990, 29.6340],
    nearby: [{ label: "Schools", distance: "5 min walk" }, { label: "Town market", distance: "8 min drive" }, { label: "Volcanoes National Park gate", distance: "25 min drive" }, { label: "Bus station", distance: "10 min drive" }],
    ownerPhone: "+250 700 000 005", ownerReply: "Usually replies within 4 hours",
  },
  {
    id: 6, title: "Modern townhouse close to the centre", district: "Rubavu", province: "Western Province",
    price: 145000000, mode: "Sale", type: "Townhouse", beds: 4, baths: 3, area: 230, image: IMG(E, 1000), tag: "Featured", owner: "Lakeview Property",
    description: [
      "A modern four-bedroom townhouse a short drive from Lake Kivu and the centre of Rubavu. Three floors give separate living, sleeping and working zones, and the roof terrace catches the lake breeze.",
      "The property is in a gated row of similar homes, with shared security and private parking for each unit.",
    ],
    amenities: ["Parking", "24/7 Security", "Balcony", "Wi-Fi ready", "Water tank", "Backup power", "Fitted kitchen", "Air conditioning"],
    gallery: gal(E, D, B, A, C), year: 2022, parking: 2, furnished: "Semi-furnished", available: "2026-12-10", depositMonths: 0,
    coords: [-1.6780, 29.2600],
    nearby: [{ label: "Lake Kivu beaches", distance: "6 min drive" }, { label: "Town centre and market", distance: "5 min drive" }, { label: "Hospital", distance: "8 min drive" }, { label: "Border crossing", distance: "12 min drive" }],
    ownerPhone: "+250 700 000 006", ownerReply: "Usually replies within 2 hours",
  },
];

export const getListing = (id: number) => listings.find((l) => l.id === id);

export const formatPrice = (price: number, mode: "Rent" | "Sale") =>
  `RWF ${price.toLocaleString("en-US")}${mode === "Rent" ? " / month" : ""}`;

export const shortPrice = (price: number, mode: "Rent" | "Sale") => {
  const v = price >= 1_000_000 ? `${+(price / 1_000_000).toFixed(1)}M` : `${Math.round(price / 1000)}K`;
  return `RWF ${v}${mode === "Rent" ? "/mo" : ""}`;
};
