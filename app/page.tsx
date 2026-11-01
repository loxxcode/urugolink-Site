"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight, BedDouble, Bath, MapPin, Search, SlidersHorizontal,
  Heart, Menu, X, Home, ShieldCheck, MessageCircle, KeyRound,
  ChevronDown, Plus, Building2, CheckCircle2, UserRound, Phone
} from "lucide-react";

type Listing = {
  id: number; title: string; district: string; province: string; price: number;
  mode: "Rent" | "Sale"; type: string; beds: number; baths: number;
  area: number; image: string; tag: string; owner: string;
};

const listings: Listing[] = [
  { id: 1, title: "Modern family home in a quiet neighbourhood", district: "Kicukiro", province: "Kigali", price: 850000, mode: "Rent", type: "House", beds: 4, baths: 3, area: 210, image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1000&q=85", tag: "Verified", owner: "Umurava Properties" },
  { id: 2, title: "Bright apartment with a city view", district: "Nyarutarama", province: "Kigali", price: 185000000, mode: "Sale", type: "Apartment", beds: 3, baths: 2, area: 145, image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1000&q=85", tag: "Featured", owner: "Kigali Homes Ltd" },
  { id: 3, title: "Contemporary villa with garden", district: "Rebero", province: "Kigali", price: 1200000, mode: "Rent", type: "Villa", beds: 5, baths: 4, area: 320, image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1000&q=85", tag: "New", owner: "Amahoro Realty" },
  { id: 4, title: "Comfortable apartment near amenities", district: "Kimihurura", province: "Kigali", price: 95000000, mode: "Sale", type: "Apartment", beds: 2, baths: 2, area: 105, image: "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?w=1000&q=85", tag: "Verified", owner: "CityNest Rwanda" },
  { id: 5, title: "Spacious home for a growing family", district: "Musanze", province: "Northern Province", price: 550000, mode: "Rent", type: "House", beds: 3, baths: 2, area: 180, image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=1000&q=85", tag: "Good value", owner: "Isaro Estates" },
  { id: 6, title: "Modern townhouse close to the centre", district: "Rubavu", province: "Western Province", price: 145000000, mode: "Sale", type: "Townhouse", beds: 4, baths: 3, area: 230, image: "https://images.unsplash.com/photo-1600607687644-c7171b42498f?w=1000&q=85", tag: "Featured", owner: "Lakeview Property" }
];

const formatPrice = (price: number, mode: "Rent" | "Sale") =>
  `RWF ${price.toLocaleString("en-US")}${mode === "Rent" ? " / month" : ""}`;

export default function HomePage() {
  const [mode, setMode] = useState<"Rent" | "Sale">("Rent");
  const [query, setQuery] = useState("");
  const [district, setDistrict] = useState("All locations");
  const [kind, setKind] = useState("Any property");
  const [maxPrice, setMaxPrice] = useState("Any budget");
  const [saved, setSaved] = useState<number[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Listing | null>(null);
  const [notice, setNotice] = useState("");

  const filtered = useMemo(() => listings.filter((p) => {
    const matchesMode = p.mode === mode;
    const text = `${p.title} ${p.district} ${p.province} ${p.type}`.toLowerCase();
    const matchesQuery = text.includes(query.toLowerCase());
    const matchesDistrict = district === "All locations" || p.district === district;
    const matchesKind = kind === "Any property" || p.type === kind;
    const matchesPrice = maxPrice === "Any budget" ||
      (maxPrice === "Under 700K" && p.price < 700000) ||
      (maxPrice === "700K–1.5M" && p.price >= 700000 && p.price <= 1500000) ||
      (maxPrice === "Under 150M" && p.price < 150000000) ||
      (maxPrice === "150M+" && p.price >= 150000000);
    return matchesMode && matchesQuery && matchesDistrict && matchesKind && matchesPrice;
  }), [mode, query, district, kind, maxPrice]);

  const visible = showAll ? filtered : filtered.slice(0, 3);
  const toggleSaved = (id: number) => setSaved((old) => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);

  function submitSearch() {
    document.getElementById("properties")?.scrollIntoView({ behavior: "smooth" });
  }

  function contactOwner() {
    setNotice("Demo interaction: landlord contact will be enabled when messaging and authentication are connected.");
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#"><span className="brand-mark"><Home size={22} /></span><span>urugo<span className="brand-light">link</span><small>RWANDA PROPERTY MARKETPLACE</small></span></a>
        <nav className={mobileOpen ? "nav nav-open" : "nav"}>
          <a href="#properties" onClick={() => setMobileOpen(false)}>Find a home</a>
          <a href="#how" onClick={() => setMobileOpen(false)}>How it works</a>
          <a href="#landlords" onClick={() => setMobileOpen(false)}>For landlords</a>
          <a href="#about" onClick={() => setMobileOpen(false)}>About us</a>
        </nav>
        <div className="header-actions">
          <button className="login-btn" onClick={() => setNotice("Sign-in screen is a planned next development step.")}>Log in</button>
          <button className="primary-btn small" onClick={() => setNotice("Property submission form is a planned next development step.")}><Plus size={16}/> List a property</button>
        </div>
        <button className="menu-btn" aria-label="Toggle navigation" onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X/> : <Menu/>}</button>
      </header>

      <section className="hero">
        <div className="hero-overlay"/>
        <div className="hero-content">
          <div className="eyebrow"><span/> YOUR NEXT CHAPTER STARTS HERE</div>
          <h1>Find a place<br/>to <em>call home.</em></h1>
          <p>Explore homes to rent or buy across Rwanda. Connect directly with trusted property owners and find the right place for your next chapter.</p>
          <div className="search-panel">
            <div className="search-tabs">
              <button className={mode === "Rent" ? "active" : ""} onClick={() => {setMode("Rent"); setMaxPrice("Any budget");}}> <KeyRound size={16}/> Rent</button>
              <button className={mode === "Sale" ? "active" : ""} onClick={() => {setMode("Sale"); setMaxPrice("Any budget");}}> <Home size={16}/> Buy</button>
            </div>
            <div className="search-fields">
              <label className="search-location"><span>LOCATION</span><div><MapPin size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="City, district or neighbourhood"/></div></label>
              <label><span>PROPERTY TYPE</span><select value={kind} onChange={e => setKind(e.target.value)}><option>Any property</option><option>House</option><option>Apartment</option><option>Villa</option><option>Townhouse</option></select></label>
              <label><span>YOUR BUDGET</span><select value={maxPrice} onChange={e => setMaxPrice(e.target.value)}><option>Any budget</option>{mode === "Rent" ? <><option>Under 700K</option><option>700K–1.5M</option></> : <><option>Under 150M</option><option>150M+</option></>}</select></label>
              <button className="search-btn" onClick={submitSearch}><Search size={18}/> Search homes</button>
            </div>
          </div>
          <div className="hero-trust"><span><ShieldCheck size={16}/> Verified listings</span><span><MessageCircle size={16}/> Direct owner contact</span><span><MapPin size={16}/> Across Rwanda</span></div>
        </div>
      </section>

      <section className="stats-strip">
        <div><strong>01</strong><span>Discover properties</span></div><div><strong>02</strong><span>Connect with owners</span></div><div><strong>03</strong><span>Find your place</span></div>
      </section>

      <section className="section properties-section" id="properties">
        <div className="section-heading">
          <div><div className="eyebrow dark">A PLACE FOR EVERY STORY</div><h2>Explore <em>properties</em></h2><p>Handpicked places to help you find your perfect fit.</p></div>
          <button className="outline-btn" onClick={() => {setQuery("");setDistrict("All locations");setKind("Any property");setMaxPrice("Any budget");setShowAll(true);}}>View all properties <ArrowRight size={16}/></button>
        </div>
        <div className="filter-row">
          <div className="filter-label"><SlidersHorizontal size={16}/> Showing {filtered.length} {mode.toLowerCase()} properties</div>
          <select value={district} onChange={e => setDistrict(e.target.value)} aria-label="Filter by district"><option>All locations</option><option>Kicukiro</option><option>Nyarutarama</option><option>Rebero</option><option>Kimihurura</option><option>Musanze</option><option>Rubavu</option></select>
        </div>
        {visible.length ? <div className="property-grid">{visible.map(p => <article className="property-card" key={p.id}>
          <div className="property-image" style={{backgroundImage:`url("${p.image}")`}}>
            <span className="tag">{p.tag}</span><button className={saved.includes(p.id) ? "save saved" : "save"} aria-label="Save property" onClick={() => toggleSaved(p.id)}><Heart size={18} fill={saved.includes(p.id) ? "currentColor" : "none"}/></button>
          </div>
          <div className="property-body"><div className="property-type">{p.type} <span>•</span> {p.mode === "Rent" ? "For rent" : "For sale"}</div><h3>{p.title}</h3><div className="location"><MapPin size={14}/>{p.district}, {p.province}</div><div className="features"><span><BedDouble size={16}/>{p.beds} beds</span><span><Bath size={16}/>{p.baths} baths</span><span><Building2 size={16}/>{p.area} m²</span></div><div className="card-bottom"><strong>{formatPrice(p.price,p.mode)}</strong><button onClick={() => setSelected(p)}>View details <ArrowRight size={14}/></button></div></div>
        </article>)}</div> : <div className="empty-state"><Search size={28}/><h3>No matching properties</h3><p>Try changing your search filters.</p><button className="outline-btn" onClick={() => {setQuery("");setDistrict("All locations");setKind("Any property");setMaxPrice("Any budget");}}>Clear filters</button></div>}
        {filtered.length > 3 && !showAll && <div className="center"><button className="outline-btn" onClick={() => setShowAll(true)}>Explore more properties <ArrowRight size={16}/></button></div>}
      </section>

      <section className="how-section" id="how"><div className="section"><div className="section-heading centered"><div><div className="eyebrow dark">SIMPLE BY DESIGN</div><h2>A better way to<br/><em>find your place.</em></h2><p>From your first search to meeting the owner, UrugoLink keeps it straightforward.</p></div></div><div className="steps"><div className="step"><span className="step-icon"><Search/></span><b>01 / DISCOVER</b><h3>Search with confidence</h3><p>Explore rental and sale listings by location, budget and the features that matter to you.</p></div><div className="step"><span className="step-icon"><MessageCircle/></span><b>02 / CONNECT</b><h3>Talk directly to owners</h3><p>Ask questions, request more details and arrange a property visit with the owner.</p></div><div className="step"><span className="step-icon"><CheckCircle2/></span><b>03 / MOVE FORWARD</b><h3>Make your next move</h3><p>Compare your options and take the next step when you have found the right property.</p></div></div></div></section>

      <section className="landlord-section" id="landlords"><div className="landlord-copy"><div className="eyebrow light">FOR PROPERTY OWNERS</div><h2>Your property<br/>deserves to be <em>found.</em></h2><p>Reach people actively looking for a place to rent or buy. Present your property clearly and manage interest in one place.</p><ul><li><CheckCircle2 size={17}/> Create detailed property listings</li><li><CheckCircle2 size={17}/> Receive customer enquiries</li><li><CheckCircle2 size={17}/> Manage viewing requests</li></ul><button className="light-btn" onClick={() => setNotice("Landlord registration and property publishing are planned for the backend phase.")}>Become a landlord <ArrowRight size={17}/></button></div><div className="landlord-photo"/></section>

      <section className="why-section section" id="about"><div className="why-card"><div><div className="eyebrow dark">THE URUGOLINK DIFFERENCE</div><h2>Local knowledge.<br/><em>Better connections.</em></h2></div><div className="why-points"><div><ShieldCheck/><span><b>Trust comes first</b><small>Build confidence through property and owner verification workflows.</small></span></div><div><MapPin/><span><b>Rooted in Rwanda</b><small>Search by province, district and neighbourhood.</small></span></div><div><Phone/><span><b>Human connections</b><small>Make it easier for customers and owners to communicate.</small></span></div></div></div></section>

      <footer><div className="footer-top"><a className="brand footer-brand" href="#"><span className="brand-mark"><Home size={22}/></span><span>urugo<span className="brand-light">link</span><small>RWANDA PROPERTY MARKETPLACE</small></span></a><p>Find a home. Connect. Make it yours.</p></div><div className="footer-bottom"><span>© {new Date().getFullYear()} UrugoLink. Prototype concept.</span><span>Built for Rwanda <span className="flag">🇷🇼</span></span></div></footer>

      {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")}><X size={16}/></button></div>}
      {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><div className="modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setSelected(null)}><X/></button><img src={selected.image} alt={selected.title}/><div className="modal-content"><div className="property-type">{selected.type} • {selected.mode === "Rent" ? "For rent" : "For sale"}</div><h2>{selected.title}</h2><p className="location"><MapPin size={15}/>{selected.district}, {selected.province}</p><strong className="modal-price">{formatPrice(selected.price, selected.mode)}</strong><div className="features"><span><BedDouble/>{selected.beds} bedrooms</span><span><Bath/>{selected.baths} bathrooms</span><span><Building2/>{selected.area} m²</span></div><div className="owner-box"><span className="owner-avatar"><UserRound/></span><span><b>{selected.owner}</b><small>Property owner / agent · Demo listing</small></span></div><button className="primary-btn full" onClick={contactOwner}><MessageCircle size={17}/> Contact property owner</button><p className="demo-note">Prototype only: verify property ownership and details independently before making payments or signing agreements.</p></div></div></div>}
    </main>
  );
}
