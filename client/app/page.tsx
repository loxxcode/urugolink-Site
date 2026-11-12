"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight, BedDouble, Bath, MapPin, Search, SlidersHorizontal,
  Heart, Menu, X, Home, ShieldCheck, MessageCircle, KeyRound,
  ChevronDown, Plus, Building2, CheckCircle2, Phone, RefreshCw, LogOut
} from "lucide-react";
import { formatPrice } from "./properties-data";
import TenantDashboard from "./tenant-dashboard";

/* ───────── API ───────── */
const API = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

type ApiCard = {
  id: string; slug?: string; title: string; mode: "rent" | "sale"; propertyType: string;
  priceRwf: number; bedrooms?: number; bathrooms?: number; areaSqm?: number;
  district?: string; province?: string; coverUrl?: string; tag?: string | null;
};
type Card = {
  id: string; href: string; title: string; mode: "Rent" | "Sale"; type: string; price: number;
  beds: number; baths: number; area: number; district: string; province: string;
  image: string; tag: string | null;
};
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const toCard = (a: ApiCard): Card => ({
  id: a.id,
  href: `/properties/${a.slug || a.id}`,
  title: a.title,
  mode: a.mode === "sale" ? "Sale" : "Rent",
  type: cap(a.propertyType),
  price: a.priceRwf,
  beds: a.bedrooms ?? 0,
  baths: a.bathrooms ?? 0,
  area: a.areaSqm ?? 0,
  district: a.district ?? "",
  province: a.province ?? "",
  image: a.coverUrl ?? "",
  tag: a.tag ?? null,
});

/* ───────── auth (session saved by the /login page) ───────── */
const AUTH_KEY = "urugolink.auth";
type Role = "tenant" | "landlord" | "agent" | "admin";
type AuthUser = { id: string; email: string; phone: string; fullName: string; role: Role };
type Stored = { user: AuthUser; tokens: { access: string; refresh: string } };
type Auth = { status: "checking" } | { status: "guest" } | { status: "user"; user: AuthUser };
const ROLE_LABEL: Record<Role, string> = { tenant: "Home seeker", landlord: "Property owner", agent: "Agent", admin: "Admin" };

function readAuth(): { data: Stored; where: Storage } | null {
  for (const where of [localStorage, sessionStorage]) {
    try {
      const raw = where.getItem(AUTH_KEY);
      if (!raw) continue;
      const data = JSON.parse(raw) as Stored;
      if (data?.tokens?.access && data?.user) return { data, where };
    } catch { /* unreadable entry: treat as logged out */ }
  }
  return null;
}
function clearAuth() {
  try { localStorage.removeItem(AUTH_KEY); sessionStorage.removeItem(AUTH_KEY); } catch { /* ignore */ }
}

/* one refresh at a time: refresh tokens rotate, so parallel refreshes would invalidate each other */
let refreshing: Promise<Stored | null> | null = null;
function refreshSession(): Promise<Stored | null> {
  if (refreshing) return refreshing;
  const cur = readAuth();
  if (!cur) return Promise.resolve(null);
  refreshing = (async () => {
    try {
      const r = await fetch(`${API}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: cur.data.tokens.refresh }),
      });
      if (r.ok) {
        const j = await r.json();
        const next: Stored = { user: j.user, tokens: j.tokens };
        try { cur.where.setItem(AUTH_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      }
      console.log("[auth] refresh failed", r.status);
      if (r.status === 401 || r.status === 422) clearAuth(); // session is really over
    } catch (e) {
      console.log("[auth] refresh network error", e);
    }
    return null;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/** fetch with the saved access token; refreshes it once if the server says it expired */
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const cur = readAuth();
  if (!cur) throw new Error("not_logged_in");
  const send = (token: string) =>
    fetch(`${API}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  let res = await send(cur.data.tokens.access);
  if (res.status === 401) {
    const next = await refreshSession();
    if (next) res = await send(next.tokens.access);
  }
  return res;
}

/** Returns the signed-in user, or null for a guest. Keeps the cached user if the API is unreachable. */
async function verifySession(): Promise<AuthUser | null> {
  const cur = readAuth();
  if (!cur) return null;
  try {
    const r = await authFetch("/api/auth/me");
    if (r.ok) return ((await r.json()) as { user: AuthUser }).user;
    if (r.status !== 401) console.log("[auth] /me failed", r.status);
  } catch (e) {
    console.log("[auth] could not verify session", e);
  }
  return readAuth()?.data.user ?? null; // cleared by refreshSession if the session really ended
}

export default function HomePage() {
  const [mode, setMode] = useState<"Rent" | "Sale">("Rent");
  const [query, setQuery] = useState("");
  const [district, setDistrict] = useState("All locations");
  const [kind, setKind] = useState("Any property");
  const [maxPrice, setMaxPrice] = useState("Any budget");
  const [saved, setSaved] = useState<string[]>([]);
  const [savedItems, setSavedItems] = useState<Card[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<ReactNode>("");
  const router = useRouter();
  const [auth, setAuth] = useState<Auth>({ status: "checking" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutState, setLogoutState] = useState<"idle" | "busy" | "done">("idle");
  const logoutRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = auth.status === "user" ? auth.user : null;
  const isProvider = !!user && user.role !== "tenant";
  const isTenant = user?.role === "tenant";
  const firstName = user ? user.fullName.trim().split(/\s+/)[0] : "";
  const initials = user ? user.fullName.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") : "";

  /* who is signed in? checked on load and whenever another tab logs in/out */
  useEffect(() => {
    let off = false;
    const run = () => verifySession().then((u) => {
      if (off) return;
      // admins go straight to their dashboard (add ?site=1 to the URL to view the public site as an admin)
      if (u?.role === "admin" && !new URLSearchParams(window.location.search).has("site")) {
        router.replace("/admin-dashboard");
        return;
      }
      setAuth(u ? { status: "user", user: u } : { status: "guest" });
    });
    run();
    const onStorage = (e: StorageEvent) => { if (e.key === AUTH_KEY || e.key === null) run(); };
    window.addEventListener("storage", onStorage);
    return () => { off = true; window.removeEventListener("storage", onStorage); };
  }, []);

  /* the user's saved homes live in the database */
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) { setSaved([]); setSavedItems([]); return; }
    let off = false;
    authFetch("/api/saved-properties")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((j: { data?: ApiCard[] }) => {
        if (off) return;
        const cards = (j.data ?? []).map(toCard);
        setSaved(cards.map((p) => p.id));
        setSavedItems(cards);
      })
      .catch((e) => console.log("[saved] could not load saved homes", e));
    return () => { off = true; };
  }, [userId]);

  /* close the account menu on outside click / Escape */
  useEffect(() => {
    if (!menuOpen) return;
    const down = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [menuOpen]);

  /* while the logout dialog is up: lock page scroll and move focus into it */
  useEffect(() => {
    if (logoutState === "idle") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    logoutRef.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, [logoutState]);
  const [items, setItems] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  /* load published properties from the database whenever Rent/Buy changes */
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    setItems([]);
    fetch(`${API}/api/properties?mode=${mode.toLowerCase()}&limit=50&sort=-publishedAt`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) {
          console.log("[properties] request failed", { status: r.status, url: r.url, response: await r.text().catch(() => "") });
          throw new Error(`Server responded ${r.status}`);
        }
        return r.json();
      })
      .then((j: { data?: ApiCard[] }) => { setItems((j.data ?? []).map(toCard)); setLoading(false); })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        console.log("[properties] could not load listings", e);
        setError(e.message.startsWith("Server") ? e.message : `Can't reach the server at ${API}. Make sure the API is running.`);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [mode, reloadKey]);

  const districts = useMemo(() => Array.from(new Set(items.map((p) => p.district).filter(Boolean))).sort(), [items]);
  const types = useMemo(() => Array.from(new Set(items.map((p) => p.type).filter(Boolean))).sort(), [items]);

  const filtered = useMemo(() => items.filter((p) => {
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
  }), [mode, items, query, district, kind, maxPrice]);

  const visible = showAll ? filtered : filtered.slice(0, 3);

  async function toggleSaved(id: string) {
    if (!user) {
      setNotice(<>Log in to save homes you like. <Link href="/login?next=/" style={{ color: "inherit", fontWeight: 700, textDecoration: "underline" }}>Log in</Link></>);
      return;
    }
    const wasSaved = saved.includes(id);
    const property = items.find((item) => item.id === id) ?? savedItems.find((item) => item.id === id);
    setSaved((old) => (wasSaved ? old.filter((x) => x !== id) : [...old, id])); // optimistic
    setSavedItems((old) => wasSaved ? old.filter((item) => item.id !== id) : property ? [...old, property] : old);
    try {
      const r = await authFetch(`/api/saved-properties/${id}`, { method: wasSaved ? "DELETE" : "POST" });
      if (!r.ok) throw new Error(`status ${r.status}`);
    } catch (e) {
      console.log("[saved] could not update saved homes", e);
      setSaved((old) => (wasSaved ? [...old, id] : old.filter((x) => x !== id))); // roll back
      setSavedItems((old) => wasSaved && property ? [...old, property] : old.filter((item) => item.id !== id));
      setNotice("Couldn't update your saved homes. Try again.");
    }
  }

  function listProperty() {
    if (!user) { router.push("/login?tab=register&next=/"); return; }
    if (isProvider) setNotice("Property submission is the next thing we're building. Your owner account is ready for it.");
    else setNotice("Listing homes is for property owners and agents. Switching your account type is coming soon.");
  }

  async function logout() {
    if (logoutState !== "idle") return;
    setMenuOpen(false);
    setMobileOpen(false);
    setLogoutState("busy");

    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const cur = readAuth();
    clearAuth(); // end the session in this browser right away, even if the request below is slow

    const request = cur
      ? fetch(`${API}/api/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: cur.data.tokens.refresh }),
        }).catch((e) => console.log("[auth] logout request failed", e))
      : Promise.resolve();

    await Promise.all([request, wait(1300)]); // keep the loading state visible long enough to read
    setAuth({ status: "guest" });
    setSaved([]);
    setLogoutState("done");
    await wait(1100);
    setLogoutState("idle");
  }

  function submitSearch() {
    document.getElementById("properties")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <>
    {isTenant && user ? <TenantDashboard
      user={user}
      properties={items}
      savedIds={saved}
      savedProperties={savedItems}
      loadingProperties={loading}
      fetchData={authFetch}
      onSave={toggleSaved}
      onSignOut={logout}
    /> : <main>
      <style>{`
@keyframes pl-spin{to{transform:rotate(360deg)}}
@keyframes pl-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
@keyframes pl-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}
@keyframes pl-pop{from{opacity:0;transform:translateY(8px) scale(.94)}to{opacity:1;transform:none}}
@keyframes pl-slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@keyframes pl-fade{from{opacity:0}to{opacity:1}}
.pl-spin{animation:pl-spin .8s linear infinite}
.pl-pulse{animation:pl-pulse 1.2s ease-in-out infinite}
.pl-shimmer,.pl-skel{background:linear-gradient(90deg,#e6ece7 30%,#f5f8f5 50%,#e6ece7 70%);background-size:300% 100%;animation:pl-shimmer 1.4s ease-in-out infinite}
.pl-skel{display:inline-block;width:96px;height:42px;border-radius:999px}
.pl-ghost{pointer-events:none}
.pl-ghost .property-image{background-image:none!important}
.pl-line{height:12px;border-radius:6px;margin:12px 0}
.pl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.pl-user-wrap{position:relative}
.pl-user{display:inline-flex;align-items:center;gap:8px;padding:5px 10px 5px 5px;border-radius:999px;border:1px solid rgba(12,59,46,.2);background:#fff;color:#14201b;font:inherit;font-weight:600;cursor:pointer;transition:box-shadow .2s}
.pl-user:hover{box-shadow:0 4px 14px rgba(12,59,46,.16)}
.pl-avatar{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#0c3b2e;color:#f2b632;font-size:.78rem;font-weight:700}
.pl-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:60;min-width:250px;padding:6px;border-radius:16px;background:#fff;border:1px solid #dfe5df;box-shadow:0 18px 44px -12px rgba(12,59,46,.35);animation:pl-pop .18s ease-out}
.pl-menu-head{display:grid;gap:2px;padding:10px 12px 12px;margin-bottom:4px;border-bottom:1px solid #edf1ec;color:#14201b}
.pl-menu-head small{color:#5a6a63;word-break:break-all}
.pl-role{justify-self:start;margin-top:6px;padding:2px 10px;border-radius:999px;background:#eef6f1;color:#14604a;font-size:.74rem;font-weight:600}
.pl-menu a,.pl-menu button{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:0;border-radius:10px;background:none;color:#14201b;font:inherit;text-align:left;text-decoration:none;cursor:pointer}
.pl-menu a:hover,.pl-menu button:hover{background:#edf1ec}
.pl-menu .pl-out{color:#b3321f}
.pl-modal-bg{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:20px;background:rgba(7,30,23,.55);backdrop-filter:blur(6px);animation:pl-fade .2s ease-out}
.pl-modal{width:min(92vw,360px);padding:34px 28px 30px;border-radius:24px;background:#fff;color:#14201b;text-align:center;box-shadow:0 30px 70px -20px rgba(0,0,0,.5);animation:pl-pop .3s cubic-bezier(.2,1.2,.4,1);outline:none}
.pl-modal h2{margin:18px 0 6px;font-size:1.35rem}
.pl-modal p{margin:0;color:#5a6a63;line-height:1.5}
.pl-lo-icon{position:relative;display:grid;place-items:center;width:72px;height:72px;margin:0 auto;border-radius:50%;background:#0c3b2e;color:#f2b632;transition:background .3s}
.pl-modal[data-state="busy"] .pl-lo-icon::after{content:"";position:absolute;inset:-9px;border-radius:50%;border:3px solid rgba(12,59,46,.14);border-top-color:#f2b632;animation:pl-spin .9s linear infinite}
.pl-modal[data-state="done"] .pl-lo-icon{background:#1b7f56;color:#fff;animation:pl-pop .4s cubic-bezier(.2,1.4,.4,1)}
.pl-bar{position:relative;height:5px;margin-top:22px;border-radius:999px;background:#edf1ec;overflow:hidden}
.pl-bar i{position:absolute;inset:0 auto 0 0;width:40%;border-radius:999px;background:#f2b632;animation:pl-slide 1.1s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.pl-spin,.pl-pulse,.pl-shimmer,.pl-skel,.pl-bar i,.pl-modal[data-state="busy"] .pl-lo-icon::after{animation:none}}
`}</style>
      <header className="site-header">
        <a className="brand" href="#"><span className="brand-mark"><Home size={22} /></span><span>urugo<span className="brand-light">link</span><small>RWANDA PROPERTY MARKETPLACE</small></span></a>
        <nav id="primary-navigation" aria-label="Primary navigation" className={mobileOpen ? "nav nav-open" : "nav"}>
          <a href="#properties" onClick={() => setMobileOpen(false)}>{isTenant ? "Browse homes" : "Find a home"}</a>
          <a href="#how" onClick={() => setMobileOpen(false)}>How it works</a>
          {!isTenant && <a href="#landlords" onClick={() => setMobileOpen(false)}>For landlords</a>}
          <a href="#about" onClick={() => setMobileOpen(false)}>About us</a>
          {mobileOpen && auth.status === "guest" && <>
            <Link href="/login" onClick={() => setMobileOpen(false)}>Log in</Link>
            <Link href="/login?tab=register" onClick={() => setMobileOpen(false)}>Create account</Link>
          </>}
          {mobileOpen && user && <a href="#" onClick={(e) => { e.preventDefault(); logout(); }}>Log out</a>}
        </nav>
        <div className="header-actions">
          {auth.status === "checking" ? <span className="pl-skel" aria-hidden="true" /> : user ? (
            <div className="pl-user-wrap" ref={menuRef}>
              <button className="pl-user" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Account menu for ${user.fullName}`} onClick={() => setMenuOpen((o) => !o)}>
                <span className="pl-avatar" aria-hidden="true">{initials}</span>
                <span className="pl-uname">{firstName}</span>
                <ChevronDown size={16}/>
              </button>
              {menuOpen && (
                <div className="pl-menu" role="menu">
                  <div className="pl-menu-head"><b>{user.fullName}</b><small>{user.email}</small><span className="pl-role">{ROLE_LABEL[user.role]}</span></div>
                  {user.role === "admin" && <Link role="menuitem" href="/admin-dashboard" onClick={() => setMenuOpen(false)}><Building2 size={16}/> Admin dashboard</Link>}
                  <a role="menuitem" href="#properties" onClick={() => setMenuOpen(false)}><Search size={16}/> Browse homes</a>
                  {!isTenant && <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); listProperty(); }}><Plus size={16}/> {isProvider ? "List a property" : "Become a landlord"}</button>}
                  <button role="menuitem" type="button" className="pl-out" onClick={logout}><LogOut size={16}/> Log out</button>
                </div>
              )}
            </div>
          ) : (
            <Link className="login-btn" href="/login" style={{display:"inline-flex",alignItems:"center",textDecoration:"none"}}>Log in</Link>
          )}
          {isTenant
            ? <button className="primary-btn small" onClick={submitSearch}><Search size={16}/> Find a home</button>
            : <button className="primary-btn small" onClick={listProperty}><Plus size={16}/> List a property</button>}
        </div>
        <button className="menu-btn" aria-label="Toggle navigation" aria-expanded={mobileOpen} aria-controls="primary-navigation" onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X/> : <Menu/>}</button>
      </header>

      <section className="hero">
        <div className="hero-overlay"/>
        <div className="hero-content">
          <div className="eyebrow"><span/> YOUR NEXT CHAPTER STARTS HERE</div>
          <h1>Find a place<br/>to <em>call home.</em></h1>
          <p>Explore homes to rent or buy across Rwanda. Connect directly with trusted property owners and find the right place for your next chapter.</p>
          <div className="search-panel">
            <div className="search-tabs">
              <button className={mode === "Rent" ? "active" : ""} onClick={() => {setMode("Rent"); setMaxPrice("Any budget"); setKind("Any property"); setDistrict("All locations");}}> <KeyRound size={16}/> Rent</button>
              <button className={mode === "Sale" ? "active" : ""} onClick={() => {setMode("Sale"); setMaxPrice("Any budget"); setKind("Any property"); setDistrict("All locations");}}> <Home size={16}/> Buy</button>
            </div>
            <div className="search-fields">
              <label className="search-location"><span>LOCATION</span><div><MapPin size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="City, district or neighbourhood"/></div></label>
              <label><span>PROPERTY TYPE</span><select value={kind} onChange={e => setKind(e.target.value)}><option>Any property</option>{types.map((t) => <option key={t}>{t}</option>)}</select></label>
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
          <div className="filter-label"><SlidersHorizontal size={16}/> {loading ? "Loading" : `Showing ${filtered.length}`} {mode.toLowerCase()} properties</div>
          <select value={district} onChange={e => setDistrict(e.target.value)} aria-label="Filter by district"><option>All locations</option>{districts.map((d) => <option key={d}>{d}</option>)}</select>
        </div>
        {loading ? <div className="property-grid" role="status" aria-busy="true"><span className="pl-sr">Loading properties…</span>{[0, 1, 2].map((n) => <article className="property-card pl-ghost" key={n} aria-hidden="true"><div className="property-image pl-shimmer"/><div className="property-body"><div className="pl-line pl-shimmer" style={{width:"40%"}}/><div className="pl-line pl-shimmer" style={{width:"85%",height:18}}/><div className="pl-line pl-shimmer" style={{width:"60%"}}/><div className="pl-line pl-shimmer" style={{width:"45%",height:20,marginTop:22}}/></div></article>)}</div> : error ? <div className="empty-state" role="alert"><Search size={28}/><h3>Couldn't load properties</h3><p>{error}</p><button className="outline-btn" onClick={() => setReloadKey((k) => k + 1)}><RefreshCw size={16}/> Try again</button></div> : visible.length ? <div className="property-grid">{visible.map(p => <article className="property-card" key={p.id}>
          <div className="property-image" style={p.image ? {backgroundImage:`url("${p.image}")`} : undefined}>
            {p.tag && <span className="tag">{p.tag}</span>}<button className={saved.includes(p.id) ? "save saved" : "save"} aria-label="Save property" onClick={() => toggleSaved(p.id)}><Heart size={18} fill={saved.includes(p.id) ? "currentColor" : "none"}/></button>
          </div>
          <div className="property-body"><div className="property-type">{p.type} <span>•</span> {p.mode === "Rent" ? "For rent" : "For sale"}</div><h3>{p.title}</h3><div className="location"><MapPin size={14}/>{p.district}, {p.province}</div><div className="features"><span><BedDouble size={16}/>{p.beds} beds</span><span><Bath size={16}/>{p.baths} baths</span><span><Building2 size={16}/>{p.area} m²</span></div><div className="card-bottom"><strong>{formatPrice(p.price,p.mode)}</strong><Link className="card-link" href={p.href}>View details <ArrowRight size={14}/></Link></div></div>
        </article>)}</div> : <div className="empty-state"><Search size={28}/><h3>No matching properties</h3><p>{items.length ? "Try changing your search filters." : `No ${mode.toLowerCase()} properties are published yet. Check back soon.`}</p><button className="outline-btn" onClick={() => {setQuery("");setDistrict("All locations");setKind("Any property");setMaxPrice("Any budget");}}>Clear filters</button></div>}
        {filtered.length > 3 && !showAll && <div className="center"><button className="outline-btn" onClick={() => setShowAll(true)}>Explore more properties <ArrowRight size={16}/></button></div>}
      </section>

      <section className="how-section" id="how"><div className="section"><div className="section-heading centered"><div><div className="eyebrow dark">SIMPLE BY DESIGN</div><h2>A better way to<br/><em>find your place.</em></h2><p>From your first search to meeting the owner, UrugoLink keeps it straightforward.</p></div></div><div className="steps"><div className="step"><span className="step-icon"><Search/></span><b>01 / DISCOVER</b><h3>Search with confidence</h3><p>Explore rental and sale listings by location, budget and the features that matter to you.</p></div><div className="step"><span className="step-icon"><MessageCircle/></span><b>02 / CONNECT</b><h3>Talk directly to owners</h3><p>Ask questions, request more details and arrange a property visit with the owner.</p></div><div className="step"><span className="step-icon"><CheckCircle2/></span><b>03 / MOVE FORWARD</b><h3>Make your next move</h3><p>Compare your options and take the next step when you have found the right property.</p></div></div></div></section>

      <section className="landlord-section" id="landlords"><div className="landlord-copy"><div className="eyebrow light">FOR PROPERTY OWNERS</div><h2>Your property<br/>deserves to be <em>found.</em></h2><p>Reach people actively looking for a place to rent or buy. Present your property clearly and manage interest in one place.</p><ul><li><CheckCircle2 size={17}/> Create detailed property listings</li><li><CheckCircle2 size={17}/> Receive customer enquiries</li><li><CheckCircle2 size={17}/> Manage viewing requests</li></ul><button className="light-btn" onClick={listProperty}>{isProvider ? "List a property" : "Become a landlord"} <ArrowRight size={17}/></button></div><div className="landlord-photo"/></section>

      <section className="why-section section" id="about"><div className="why-card"><div><div className="eyebrow dark">THE URUGOLINK DIFFERENCE</div><h2>Local knowledge.<br/><em>Better connections.</em></h2></div><div className="why-points"><div><ShieldCheck/><span><b>Trust comes first</b><small>Build confidence through property and owner verification workflows.</small></span></div><div><MapPin/><span><b>Rooted in Rwanda</b><small>Search by province, district and neighbourhood.</small></span></div><div><Phone/><span><b>Human connections</b><small>Make it easier for customers and owners to communicate.</small></span></div></div></div></section>

      <footer><div className="footer-top"><a className="brand footer-brand" href="#"><span className="brand-mark"><Home size={22}/></span><span>urugo<span className="brand-light">link</span><small>RWANDA PROPERTY MARKETPLACE</small></span></a><p>Find a home. Connect. Make it yours.</p></div><div className="footer-bottom"><span>© {new Date().getFullYear()} UrugoLink. Prototype concept.</span><span>Built for Rwanda <span className="flag">🇷🇼</span></span></div></footer>

    </main>}
    {logoutState !== "idle" && (
      <div className="pl-modal-bg" role="alertdialog" aria-modal="true" aria-labelledby="pl-lo-title" aria-describedby="pl-lo-desc">
        <div className="pl-modal" ref={logoutRef} tabIndex={-1} data-state={logoutState} aria-live="polite">
          <div className="pl-lo-icon">{logoutState === "busy" ? <Home className="pl-pulse" size={30}/> : <CheckCircle2 size={34}/>}</div>
          <h2 id="pl-lo-title">{logoutState === "busy" ? "Logging out…" : "You're logged out"}</h2>
          <p id="pl-lo-desc">{logoutState === "busy" ? "Ending your session securely." : "See you soon. Your saved homes will be here when you log back in."}</p>
          {logoutState === "busy" && <div className="pl-bar" aria-hidden="true"><i/></div>}
        </div>
      </div>
    )}
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")}><X size={16}/></button></div>}
    </>
  );
}