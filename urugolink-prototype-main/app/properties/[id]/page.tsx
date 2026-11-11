import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PropertyDetails from "../../property-details";
import { fetchProperty, fetchSimilar } from "../../property-api";

type Props = { params: Promise<{ id: string }> | { id: string } }; // [id] can be a slug, ref or Mongo id

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const p = await fetchProperty(id);
  if (!p) return { title: "Property not found | UrugoLink" };
  return {
    title: `${p.title} · ${p.district ?? "Rwanda"} | UrugoLink`,
    description: `${p.bedrooms ?? 0} bed ${p.propertyType} for ${p.mode} in ${p.district}, ${p.province}.`,
    openGraph: p.coverUrl ? { images: [p.coverUrl] } : undefined,
  };
}

export default async function PropertyPage({ params }: Props) {
  const { id } = await params;
  const property = await fetchProperty(id);
  if (!property) notFound();
  const similar = await fetchSimilar(property.id);
  return <PropertyDetails property={property} similar={similar} />;
}