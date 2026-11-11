"use client";

import "./property-details.css";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowLeft, BedDouble, Bath, Ruler, CarFront, CalendarDays, MapPin, Check, X, ChevronLeft, ChevronRight, ChevronDown,
  ShieldCheck, Flag, Phone, MessageCircle, Heart, Share2, Images, Minus, Plus, Copy, Loader2, Clock, Search, Download,
  Wifi, Droplets, Zap, Trees, Dumbbell, Waves, Camera, Snowflake, Tv, UtensilsCrossed, Sofa, KeyRound, BadgeCheck,
  Footprints, Car, Building2, Sparkles, Wallet, Landmark, CalendarClock, Receipt, Navigation, Info, ArrowUpRight, Maximize2, ZoomIn, ZoomOut, Play, Pause, Expand, Facebook, Twitter, Linkedin, Send, Mail, MessageSquare, Link2,
} from "lucide-react";
import { API, type Property, type Card } from "./property-api";

/* ═══════════════════════════ types ═══════════════════════════
 * `Extra` lists the fields Server.js sends that older versions of the Property type may not declare. */
type Extra = {
  ownerId?: string; ownerPhone?: string; ownerWhatsapp?: string; ownerVerified?: boolean; ownerResponseMinutes?: number;
  status?: string; floorPlans?: string[]; publishedAt?: string; stats?: { saves?: number };
};
type P = Property & Extra;
type Kind = "rent" | "offer" | "view";
type ModalKey = Kind | "report" | "track" | "share";

/* ═══════════════════════════ helpers ═══════════════════════════ */
const LOGIN_PATH = "/login"; // where "Log in" sends people. Change if your login page lives elsewhere.
const KIGALI_OFFSET_H = 2; // Rwanda is UTC+2 all year
const rwf = (n: number) => `RWF ${Math.round(n).toLocaleString("en-US")}`;
const short = (n: number) =>
  n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
const nice = (s = "") => (s && s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s-])(\w)/g, (_, a, b) => a + b.toUpperCase()) : s);
const cap = (s = "") => (s ? s[0].toUpperCase() + s.slice(1) : s);
const FURN = { furnished: "Furnished", semi_furnished: "Semi-furnished", unfurnished: "Unfurnished" } as const;
const PHONE_RE = /^(?:\+?250|0)?7[2389]\d{7}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const css = (o: Record<string, string | number>) => o as CSSProperties;
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** today's date in Kigali as a UTC-midnight Date, so day maths never shifts with the visitor's own time zone */
const kigaliToday = () => {
  const n = new Date(Date.now() + KIGALI_OFFSET_H * 36e5);
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const slotDate = (day: string, time: string) => new Date(`${day}T${time}:00+0${KIGALI_OFFSET_H}:00`);
const fmtDay = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const ago = (iso?: string) => {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : d < 365 ? `${Math.floor(d / 30)} mo ago` : `${Math.floor(d / 365)} yr ago`;
};
const replyTime = (m?: number) => (!m ? "" : m < 60 ? `${Math.max(5, Math.round(m / 5) * 5)} minutes` : m < 1440 ? `${Math.round(m / 60)} hour${Math.round(m / 60) > 1 ? "s" : ""}` : "a day");

const AMENITY_ICON: [RegExp, typeof Check][] = [
  [/wi-?fi|internet/i, Wifi], [/park|garage/i, CarFront], [/secur|guard|gate/i, ShieldCheck], [/cctv|camera/i, Camera],
  [/water|borehole/i, Droplets], [/electric|power|generator|solar/i, Zap], [/garden|yard|tree/i, Trees],
  [/gym|fitness/i, Dumbbell], [/pool|swim/i, Waves], [/air|a\/c|\bac\b|cool/i, Snowflake], [/tv|cable|dstv/i, Tv],
  [/kitchen/i, UtensilsCrossed], [/furnish/i, Sofa],
];
const amenityIcon = (label: string) => AMENITY_ICON.find(([re]) => re.test(label))?.[1] ?? Check;

/* ═══════════════════════════ browser storage (never throws) ═══════════════════════════ */
const store = {
  get<T>(k: string, fallback: T): T { try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : fallback; } catch { return fallback; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const TRACK_KEY = "urugolink.tracked";
const GUEST_KEY = "urugolink.guest";
type Tracked = { ref: string; token?: string; kind: Kind; title: string; at: number };
const rememberRequest = (t: Tracked) => store.set(TRACK_KEY, [t, ...store.get<Tracked[]>(TRACK_KEY, []).filter((x) => x.ref !== t.ref)].slice(0, 8));

/* ═══════════════════════════ session: read, refresh, listen ═══════════════════════════
 * Server.js access tokens live 15 minutes. This keeps the login alive by using the refresh token
 * (rotated by POST /api/auth/refresh) so a signed-in visitor never silently turns into a guest. */
const AUTH_KEY = "urugolink.auth";
const SESSION_EVT = "urugolink:session";
type Session = { id: string; name: string; phone: string; email: string; access: string; refresh: string };

function authStore(): Storage | null {
  for (const mk of [() => window.localStorage, () => window.sessionStorage]) {
    try { const s = mk(); if (s.getItem(AUTH_KEY)) return s; } catch { /* blocked */ }
  }
  return null;
}
function readSession(): Session | null {
  const s = authStore(); if (!s) return null;
  try {
    const d = JSON.parse(s.getItem(AUTH_KEY) || "null");
    if (d?.tokens?.access && d?.user) {
      return { id: String(d.user.id ?? d.user._id ?? ""), name: d.user.fullName ?? "You", phone: d.user.phone ?? "", email: d.user.email ?? "", access: d.tokens.access, refresh: d.tokens.refresh ?? "" };
    }
  } catch { /* corrupt */ }
  return null;
}
const emitSession = () => window.dispatchEvent(new Event(SESSION_EVT));
function clearSession() { try { localStorage.removeItem(AUTH_KEY); sessionStorage.removeItem(AUTH_KEY); } catch { /* ignore */ } emitSession(); }
function jwtExp(t: string) {
  try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp * 1000; } catch { return 0; }
}
let refreshing: Promise<string | null> | null = null;
function freshAccess(force = false): Promise<string | null> {
  const s = readSession(); if (!s) return Promise.resolve(null);
  if (!force && jwtExp(s.access) - Date.now() > 30_000) return Promise.resolve(s.access);
  if (!s.refresh) return Promise.resolve(s.access);
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const r = await fetch(`${API}/api/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: s.refresh }) });
      if (r.status === 401 || r.status === 403) { clearSession(); return null; } // refresh token is dead: really signed out
      if (!r.ok) return s.access;
      const j = await r.json();
      const st = authStore();
      if (st) {
        const d = JSON.parse(st.getItem(AUTH_KEY) || "{}");
        d.tokens = { ...(d.tokens || {}), ...j.tokens };
        d.user = j.user ?? d.user;
        st.setItem(AUTH_KEY, JSON.stringify(d));
      }
      emitSession();
      return (j.tokens?.access as string) ?? s.access;
    } catch { return s.access; } // offline: keep what we have
    finally { refreshing = null; }
  })();
  return refreshing;
}
function useSession() {
  const [s, setS] = useState<Session | null>(null);
  useEffect(() => {
    const sync = () => setS(readSession());
    sync();
    window.addEventListener(SESSION_EVT, sync); window.addEventListener("storage", sync);
    return () => { window.removeEventListener(SESSION_EVT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return s;
}

/* ═══════════════════════════ API client ═══════════════════════════ */
type ApiErr = { error: string; issues?: { path: string; message: string }[] };
type Res<T> = { ok: true; data: T } | { ok: false; err: ApiErr; status: number };
async function api<T = any>(path: string, method: "GET" | "POST" | "DELETE", body?: unknown): Promise<Res<T>> {
  const run = async (tok: string | null) => {
    const r = await fetch(`${API}${path}`, {
      method, cache: "no-store",
      headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { r, j: await r.json().catch(() => ({})) };
  };
  try {
    const tok = await freshAccess();
    let { r, j } = await run(tok);
    if (r.status === 401 && tok) { const t2 = await freshAccess(true); if (t2 && t2 !== tok) ({ r, j } = await run(t2)); }
    if (!r.ok) return { ok: false, status: r.status, err: { error: j.error ?? "request_failed", issues: j.issues } };
    return { ok: true, data: (j.data ?? j) as T };
  } catch {
    return { ok: false, status: 0, err: { error: "network" } };
  }
}
const ERR_TEXT: Record<string, string> = {
  duplicate_pending_request: "You already have a pending request for this home. The owner will reply soon.",
  duplicate_pending_offer: "You already have an open offer on this home. Wait for the owner's reply or withdraw it first.",
  move_in_in_past: "Pick a move-in date from today onwards.",
  move_in_before_available: "This home isn't available before the date shown. Pick a later move-in.",
  lease_below_minimum: "The owner asks for a longer minimum lease. Increase the lease length.",
  property_not_available: "This property is no longer available.",
  not_a_rental: "This home is for sale, not rent.",
  not_for_sale: "This home is for rent, not sale.",
  own_listing: "This is your own listing, so you can't send requests to yourself.",
  slot_already_requested: "You already asked for that time. Pick another slot.",
  slot_taken: "That time was just taken. Pick another slot.",
  scheduled_in_past: "Pick a time in the future.",
  viewing_too_far: "Viewings can be booked up to 60 days ahead.",
  guest_or_auth_required: "Add your contact details so the owner can reach you.",
  invalid_token: "That tracking code doesn't match this reference.",
  not_found: "We couldn't find that reference. Check it and try again.",
  not_cancellable: "This request can no longer be cancelled.",
  authentication_required: "Please log in and try again.",
  network: "Can't reach the server. Check your connection and try again.",
};
const FIELD_MAP: Record<string, string> = { desiredMoveIn: "moveIn", leaseMonths: "months", offerRwf: "offer", scheduledAt: "date" };
const errText = (e: ApiErr) => ERR_TEXT[e.error] ?? "Something went wrong. Please try again.";

/* ═══════════════════════════ hooks ═══════════════════════════ */
function useTween(target: number, { from, ms = 800 }: { from?: number; ms?: number } = {}) {
  const [v, setV] = useState(from ?? target);
  const cur = useRef(from ?? target);
  useEffect(() => {
    if (reduced()) { cur.current = target; setV(target); return; }
    const a = cur.current, t0 = performance.now(); let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 4);
      cur.current = a + (target - a) * e; setV(cur.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
function useScrollLock(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [on]);
}
const Count = ({ n, from = 0, ms = 1100 }: { n: number; from?: number; ms?: number }) => <>{Math.round(useTween(n, { from, ms })).toLocaleString("en-US")}</>;

/* ═══════════════════════════ small UI pieces ═══════════════════════════ */
function Img({ src, alt = "", className, loading = "lazy" }: { src?: string; alt?: string; className?: string; loading?: "lazy" | "eager" }) {
  const [bad, setBad] = useState(false);
  const [ok, setOk] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => { const el = ref.current; if (el?.complete && el.naturalWidth) setOk(true); }, [src]);
  if (!src || bad) return <span className={`img-ph ${className ?? ""}`} aria-hidden="true"><Images size={22} /></span>;
  return <img ref={ref} src={src} alt={alt} className={className} loading={loading} decoding="async" data-ok={ok} onLoad={() => setOk(true)} onError={() => setBad(true)} />;
}

function Modal({ open, onClose, label, children, className = "" }: { open: boolean; onClose: () => void; label: string; children: ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [show, setShow] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      opener.current = document.activeElement;
      setMounted(true);
      const r = requestAnimationFrame(() => { setShow(true); sheet.current?.focus(); });
      return () => cancelAnimationFrame(r);
    }
    setShow(false);
    const t = setTimeout(() => { setMounted(false); (opener.current as HTMLElement | null)?.focus?.(); }, 300);
    return () => clearTimeout(t);
  }, [open]);

  useScrollLock(mounted);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && sheet.current) {
        const f = sheet.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea,select,a[href],[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div className="pdx-modal" data-show={show} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={`pdx-sheet ${className}`}>{children}</div>
    </div>,
    document.body
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className={`fld${error ? " bad" : ""}`}>
      <span className="fld-l">{label}</span>
      {children}
      {error ? <em className="fld-e" role="alert">{error}</em> : hint ? <small className="fld-h">{hint}</small> : null}
    </label>
  );
}
function Stepper({ value, min, max, onChange, unit, plural, label }: { value: number; min: number; max: number; onChange: (n: number) => void; unit: string; plural?: string; label: string }) {
  return (
    <div className="stp" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Fewer ${plural ?? unit + "s"}`}><Minus size={16} /></button>
      <output><b key={value}>{value}</b> <span>{value === 1 ? unit : plural ?? `${unit}s`}</span></output>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More ${plural ?? unit + "s"}`}><Plus size={16} /></button>
    </div>
  );
}

/* ═══════════════════════════ booking flow (rent / offer / viewing) ═══════════════════════════ */
const COPY: Record<Kind, { title: string; steps: string[]; cta: string; done: string; doneText: string; next: string[] }> = {
  rent: { title: "Request to rent", steps: ["Your stay", "Contact", "Review"], cta: "Send rent request", done: "Request sent",
    doneText: "The owner has been notified and will reply to you shortly.", next: ["Owner reviews your request", "You hear back by phone or in your account", "If approved, you sign the lease and pay"] },
  offer: { title: "Make an offer", steps: ["Your offer", "Contact", "Review"], cta: "Send offer", done: "Offer sent",
    doneText: "The owner has 7 days to accept, decline or counter your offer.", next: ["Owner reviews your offer", "They accept, decline or counter within 7 days", "If accepted, the next steps are agreed with you directly"] },
  view: { title: "Book a viewing", steps: ["Pick a time", "Contact", "Review"], cta: "Request viewing", done: "Viewing requested",
    doneText: "The owner will confirm your slot. You'll be contacted on the number you gave.", next: ["Owner confirms or suggests another time", "You get a call or notification", "Arrive 5 minutes early with your ID"] },
};
const PAY = [
  { v: "bank_transfer", t: "Bank transfer", d: "Pay in full once agreed", I: Landmark },
  { v: "mortgage", t: "Mortgage", d: "Financed by a lender", I: Building2 },
  { v: "instalments", t: "Instalments", d: "Agreed payment plan", I: Wallet },
] as const;
const DEFAULT_SLOTS = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"];

function icsEscape(s: string) { return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function downloadIcs(p: P, day: string, time: string, ref: string) {
  const start = slotDate(day, time), end = new Date(start.getTime() + 30 * 60e3);
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const place = [p.neighbourhood, p.district, p.province].filter(Boolean).join(", ");
  const text = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//UrugoLink//Viewing//EN", "BEGIN:VEVENT", `UID:${ref}@urugolink`, `DTSTAMP:${f(new Date())}`,
    `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:${icsEscape(`Viewing: ${p.title}`)}`, `LOCATION:${icsEscape(place)}`,
    `DESCRIPTION:${icsEscape(`Reference ${ref}. Waiting for the owner to confirm.`)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
  const a = document.createElement("a"); a.href = url; a.download = `viewing-${ref}.ics`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Confetti() {
  const bits = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ x: (i % 2 ? 1 : -1) * (30 + ((i * 37) % 90)), y: -(70 + ((i * 53) % 90)), r: (i * 67) % 360, d: (i % 5) * 40, c: i % 3 })), []);
  return <div className="confetti" aria-hidden="true">{bits.map((b, i) => <i key={i} className={`c${b.c}`} style={css({ "--x": `${b.x}px`, "--y": `${b.y}px`, "--r": `${b.r}deg`, "--d": `${b.d}ms` })} />)}</div>;
}

function BookingFlow({ kind, p, session, onClose, onToast, onTrack }: {
  kind: Kind; p: P; session: Session | null; onClose: () => void; onToast: (m: string) => void; onTrack: (ref: string, token?: string) => void;
}) {
  const c = COPY[kind];
  const today = useMemo(() => isoOf(kigaliToday()), []);
  const minMove = useMemo(() => {
    const a = p.availableFrom ? isoOf(new Date(p.availableFrom)) : "";
    return a && a > today ? a : today;
  }, [p.availableFrom, today]);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => { const d = kigaliToday(); d.setUTCDate(d.getUTCDate() + i); return isoOf(d); }), []);
  const guestSaved = useMemo(() => store.get<{ name?: string; phone?: string; email?: string }>(GUEST_KEY, {}), []);
  const minLease = Math.max(p.minLeaseMonths ?? 1, 1);

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [f, setF] = useState({
    moveIn: "", months: Math.max(p.minLeaseMonths ?? 12, 1), occupants: 1, occupation: "",
    offer: p.priceRwf, pay: "bank_transfer" as string, date: "", time: "", visitors: 1,
    name: guestSaved.name ?? "", phone: guestSaved.phone ?? "", email: guestSaved.email ?? "", message: "", remember: true, agree: false,
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [top, setTop] = useState("");
  const [done, setDone] = useState<{ ref: string; token?: string } | null>(null);
  const [avail, setAvail] = useState<{ slots: string[]; booked: Set<number>; loading: boolean }>({ slots: DEFAULT_SLOTS, booked: new Set(), loading: kind === "view" });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((s) => ({ ...s, [k]: v })); setErr((e) => ({ ...e, [k]: "" })); setTop(""); };

  useEffect(() => {
    if (kind !== "view") return;
    let live = true;
    api<{ slots?: string[]; booked?: string[] }>(`/api/properties/${p.id}/availability`, "GET").then((r) => {
      if (!live) return;
      if (r.ok) setAvail({ slots: r.data.slots?.length ? r.data.slots : DEFAULT_SLOTS, booked: new Set((r.data.booked ?? []).map((s) => new Date(s).getTime())), loading: false });
      else setAvail((a) => ({ ...a, loading: false }));
    });
    return () => { live = false; };
  }, [kind, p.id]);

  const monthly = p.priceRwf, deposit = monthly * (p.depositMonths ?? 0), fee = Math.round(monthly * 0.03);
  const slotState = (t: string): "ok" | "past" | "taken" => {
    if (!f.date) return "past";
    const at = slotDate(f.date, t).getTime();
    if (at < Date.now() + 30 * 60e3) return "past";
    return avail.booked.has(at) ? "taken" : "ok";
  };
  const gap = f.offer ? Math.round((1 - f.offer / p.priceRwf) * 100) : 0;

  function validate(s: number) {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (kind === "rent") {
        if (!f.moveIn) e.moveIn = "Choose your move-in date.";
        else if (f.moveIn < today) e.moveIn = "Move-in can't be in the past.";
        else if (f.moveIn < minMove) e.moveIn = `Available from ${fmtDay(minMove, { day: "numeric", month: "short", year: "numeric" })}.`;
        if (f.months < minLease) e.months = `Minimum lease is ${minLease} months.`;
      }
      if (kind === "offer" && (!Number.isInteger(f.offer) || f.offer <= 0)) e.offer = "Enter an amount in RWF.";
      if (kind === "view") { if (!f.date) e.date = "Pick a day."; else if (!f.time) e.time = "Pick a time."; }
    }
    if (s === 1 && !session) {
      if (f.name.trim().length < 2) e.name = "Enter your full name.";
      if (!PHONE_RE.test(f.phone.replace(/[\s-]/g, ""))) e.phone = "Use a Rwandan number like 0788 123 456.";
      if (f.email && !EMAIL_RE.test(f.email.trim())) e.email = "That email doesn't look right.";
    }
    if (s === 2 && !f.agree) e.agree = "Please confirm before sending.";
    setErr(e);
    return !Object.keys(e).length;
  }
  const go = (n: number) => { setDir(n > step ? "fwd" : "back"); setStep(n); };
  const next = () => { if (validate(step)) go(step + 1); };

  async function submit() {
    if (!validate(2)) return;
    setBusy(true); setTop("");
    const guest = session ? undefined : { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() };
    const message = f.message.trim() || undefined;
    let path: string, body: Record<string, unknown> = { propertyId: p.id, message, guest };
    if (kind === "rent") {
      path = "/api/rent-requests";
      body = { ...body, desiredMoveIn: f.moveIn, leaseMonths: f.months, occupants: f.occupants, occupation: f.occupation.trim() || undefined };
    } else if (kind === "offer") {
      path = "/api/offers";
      body = { ...body, offerRwf: f.offer, paymentMethod: f.pay };
    } else {
      path = "/api/viewing-bookings";
      body = { ...body, scheduledAt: slotDate(f.date, f.time).toISOString(), durationMinutes: 30, visitors: f.visitors };
    }
    const r = await api<{ ref: string; trackingToken?: string }>(path, "POST", body);
    setBusy(false);
    if (r.ok) {
      rememberRequest({ ref: r.data.ref, token: r.data.trackingToken, kind, title: p.title, at: Date.now() });
      if (guest) store.set(GUEST_KEY, f.remember ? { name: guest.name, phone: guest.phone, email: guest.email } : {});
      setDone({ ref: r.data.ref, token: r.data.trackingToken });
      return;
    }
    const issue = r.err.issues?.[0];
    if (r.err.error === "validation_failed" && issue) {
      const raw = issue.path.replace("guest.", ""), key = FIELD_MAP[raw] ?? raw;
      setErr({ [key]: issue.message });
      go(["name", "phone", "email", "message"].includes(key) ? 1 : 0);
    } else if (r.err.error === "guest_or_auth_required" && session) {
      clearSession(); go(1); setTop("Your login expired. Add your contact details to continue, or log in again.");
    } else {
      if (r.err.error === "slot_taken") { setAvail((a) => ({ ...a, booked: new Set([...a.booked, slotDate(f.date, f.time).getTime()]) })); set("time", ""); go(0); }
      setTop(errText(r.err));
    }
  }

  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); onToast("Copied to clipboard."); } catch { onToast("Copy failed. Select the text and copy it."); } };
  const cover = p.coverUrl || p.gallery?.[0];

  if (done) {
    return (
      <div className="flow-done">
        <Confetti />
        <svg className="tick" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="36" /><path d="M24 41l11 11 21-24" /></svg>
        <h3>{c.done}</h3>
        <p>{c.doneText}</p>
        <div className="ref"><span>Reference</span><b>{done.ref}</b><button onClick={() => copy(done.ref)} aria-label="Copy reference"><Copy size={15} /></button></div>
        {done.token && (
          <div className="ref alt"><span>Tracking code</span><b>{done.token}</b><button onClick={() => copy(done.token!)} aria-label="Copy tracking code"><Copy size={15} /></button></div>
        )}
        {done.token && <small>Keep your tracking code. It's the only way to check this request without an account.</small>}
        <ol className="next">{c.next.map((t, i) => <li key={t} style={css({ "--n": i })}><span>{i + 1}</span>{t}</li>)}</ol>
        <div className="flow-actions">
          {kind === "view" && <button className="btn outline" onClick={() => downloadIcs(p, f.date, f.time, done.ref)}><Download size={17} /> Add to calendar</button>}
          <button className="btn outline" onClick={() => onTrack(done.ref, done.token)}><Search size={17} /> Track request</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="flow-h">
        <div className="flow-prop">
          <Img src={cover} className="flow-img" loading="eager" />
          <div><small>{c.title}</small><b>{nice(p.title)}</b></div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <ol className="prog" aria-label="Progress">
          {c.steps.map((s, i) => (
            <li key={s} className={i < step ? "done" : i === step ? "on" : ""} aria-current={i === step ? "step" : undefined}>
              <span>{i < step ? <Check size={13} /> : i + 1}</span><em>{s}</em>
            </li>
          ))}
          <i style={css({ "--p": step / (c.steps.length - 1) })} />
        </ol>
      </header>

      <div className="flow-b">
        <div className={`step dir-${dir}`} key={step}>
          {top && <div className="alert" role="alert">{top}</div>}

          {step === 0 && kind === "rent" && (
            <>
              <Field label="Move-in date" error={err.moveIn} hint={minMove > today ? `Available from ${fmtDay(minMove, { day: "numeric", month: "long" })}` : undefined}>
                <input type="date" min={minMove} value={f.moveIn} onChange={(e) => set("moveIn", e.target.value)} />
              </Field>
              <div className="two">
                <div className="fld"><span className="fld-l">Lease length</span><Stepper value={f.months} min={minLease} max={60} unit="month" label="Lease length" onChange={(n) => set("months", n)} />{err.months && <em className="fld-e">{err.months}</em>}</div>
                <div className="fld"><span className="fld-l">People moving in</span><Stepper value={f.occupants} min={1} max={20} unit="person" plural="people" label="Occupants" onChange={(n) => set("occupants", n)} /></div>
              </div>
              <Field label="What do you do? (optional)" hint="Helps the owner get to know you.">
                <input value={f.occupation} maxLength={120} onChange={(e) => set("occupation", e.target.value)} placeholder="e.g. Software engineer" />
              </Field>
            </>
          )}

          {step === 0 && kind === "offer" && (
            <>
              <Field label="Your offer (RWF)" error={err.offer} hint={`Asking price ${rwf(p.priceRwf)}`}>
                <input inputMode="numeric" value={f.offer ? f.offer.toLocaleString("en-US") : ""} onChange={(e) => set("offer", Number(e.target.value.replace(/\D/g, "")))} />
              </Field>
              <div className="chips" role="group" aria-label="Quick amounts">
                {[0, 3, 5, 10].map((d) => {
                  const v = Math.round(p.priceRwf * (1 - d / 100));
                  return <button type="button" key={d} className={f.offer === v ? "on" : ""} onClick={() => set("offer", v)}>{d === 0 ? "Asking price" : `${d}% below`}</button>;
                })}
              </div>
              {f.offer > 0 && (
                <p className={`gap${gap > 25 ? " warn" : ""}`}><Info size={15} />
                  {gap > 0 ? `${gap}% below asking. ${gap > 25 ? "Owners often decline offers this low." : ""}` : gap < 0 ? `${Math.abs(gap)}% above asking.` : "Matches the asking price."}
                </p>
              )}
              <div className="fld"><span className="fld-l">How will you pay?</span>
                <div className="radios">
                  {PAY.map(({ v, t, d, I }) => (
                    <button type="button" key={v} className={f.pay === v ? "on" : ""} onClick={() => set("pay", v)} aria-pressed={f.pay === v}><I size={20} /><b>{t}</b><small>{d}</small></button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 0 && kind === "view" && (
            <>
              <div className="fld"><span className="fld-l">Pick a day</span>
                <div className="days" role="listbox" aria-label="Day">
                  {days.map((d) => (
                    <button type="button" key={d} role="option" aria-selected={f.date === d} className={f.date === d ? "on" : ""} onClick={() => { set("date", d); set("time", ""); }}>
                      <small>{fmtDay(d, { weekday: "short" })}</small><b>{fmtDay(d, { day: "numeric" })}</b><small>{fmtDay(d, { month: "short" })}</small>
                    </button>
                  ))}
                </div>
                {err.date && <em className="fld-e" role="alert">{err.date}</em>}
              </div>
              <div className="fld"><span className="fld-l">Pick a time <small className="tz">Kigali time</small></span>
                <div className={`chips${avail.loading ? " loading" : ""}`}>
                  {avail.slots.map((t) => {
                    const st = slotState(t);
                    return <button type="button" key={t} disabled={st !== "ok" || avail.loading} className={f.time === t ? "on" : ""} onClick={() => set("time", t)} title={st === "taken" ? "Already booked" : undefined}>{t}{st === "taken" && <s> taken</s>}</button>;
                  })}
                </div>
                {!f.date && <small className="fld-h">Choose a day to see open times.</small>}
                {err.time && <em className="fld-e" role="alert">{err.time}</em>}
              </div>
              <div className="fld"><span className="fld-l">Visitors</span><Stepper value={f.visitors} min={1} max={10} unit="visitor" label="Visitors" onChange={(n) => set("visitors", n)} /></div>
            </>
          )}

          {step === 1 && (
            <>
              {session ? (
                <div className="me"><span>{session.name.slice(0, 1).toUpperCase()}</span><div><b>{session.name}</b><small>Sending as your UrugoLink account</small></div><Check size={18} /></div>
              ) : (
                <>
                  <Field label="Full name" error={err.name}><input autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Your name" /></Field>
                  <div className="two">
                    <Field label="Phone" error={err.phone}><input type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0788 123 456" /></Field>
                    <Field label="Email (optional)" error={err.email}><input type="email" autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="you@email.com" /></Field>
                  </div>
                  <label className="check slim"><input type="checkbox" checked={f.remember} onChange={(e) => set("remember", e.target.checked)} /><span><Check size={14} /></span><em>Remember my details on this device</em></label>
                </>
              )}
              <Field label="Message to the owner (optional)" error={err.message}>
                <textarea rows={3} maxLength={2000} value={f.message} onChange={(e) => set("message", e.target.value)} placeholder="Anything the owner should know?" />
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <dl className="sum">
                {kind === "rent" && <>
                  <div><dt>Move-in</dt><dd>{fmtDay(f.moveIn, { day: "numeric", month: "long", year: "numeric" })}</dd></div>
                  <div><dt>Lease</dt><dd>{f.months} months · {f.occupants} {f.occupants === 1 ? "person" : "people"}</dd></div>
                  <div><dt>Monthly rent</dt><dd>{rwf(monthly)}</dd></div>
                  {deposit > 0 && <div><dt>Deposit ({p.depositMonths} mo.)</dt><dd>{rwf(deposit)}</dd></div>}
                  <div><dt>Service fee (3%)</dt><dd>{rwf(fee)}</dd></div>
                  <div className="total"><dt>Due if accepted</dt><dd>{rwf(monthly + deposit + fee)}</dd></div>
                </>}
                {kind === "offer" && <>
                  <div><dt>Asking price</dt><dd>{rwf(p.priceRwf)}</dd></div>
                  <div><dt>Payment</dt><dd>{PAY.find((x) => x.v === f.pay)?.t}</dd></div>
                  <div className="total"><dt>Your offer</dt><dd>{rwf(f.offer)}</dd></div>
                </>}
                {kind === "view" && <>
                  <div><dt>Day</dt><dd>{fmtDay(f.date, { weekday: "long", day: "numeric", month: "long" })}</dd></div>
                  <div className="total"><dt>Time</dt><dd>{f.time} · 30 min · {f.visitors} {f.visitors === 1 ? "visitor" : "visitors"}</dd></div>
                </>}
                <div><dt>Contact</dt><dd>{session ? session.name : `${f.name} · ${f.phone}`}</dd></div>
              </dl>
              <label className={`check${err.agree ? " bad" : ""}`}>
                <input type="checkbox" checked={f.agree} onChange={(e) => set("agree", e.target.checked)} />
                <span><Check size={14} /></span>
                <em>I understand this is a request. Nothing is booked or paid until the owner accepts.</em>
              </label>
              {err.agree && <em className="fld-e" role="alert">{err.agree}</em>}
            </>
          )}
        </div>
      </div>

      <footer className="flow-f">
        {step > 0 ? <button className="btn ghost" onClick={() => go(step - 1)} disabled={busy}>Back</button> : <span />}
        {step < 2
          ? <button className="btn primary" onClick={next}>Continue</button>
          : <button className="btn primary" onClick={submit} disabled={busy}>{busy ? <><Loader2 className="spin" size={18} /> Sending…</> : c.cta}</button>}
      </footer>
    </>
  );
}

/* ═══════════════════════════ track a request ═══════════════════════════ */
type TrackRes = {
  ref: string; status: string; createdAt?: string; decidedAt?: string; declineReason?: string; property?: { title?: string };
  desiredMoveIn?: string; leaseMonths?: number; occupants?: number; pricing?: { totalDueRwf?: number };
  offerRwf?: number; askingPriceRwf?: number; counterOfferRwf?: number; paymentMethod?: string;
  scheduledAt?: string; visitors?: number;
};
const kindOfRef = (ref: string): Kind | null => (/^RR-/.test(ref) ? "rent" : /^OF-/.test(ref) ? "offer" : /^VB-/.test(ref) ? "view" : null);
const TRACK_PATH: Record<Kind, string> = { rent: "/api/rent-requests/track", offer: "/api/offers/track", view: "/api/viewing-bookings/track" };
const STATUS: Record<string, [string, "ok" | "wait" | "bad"]> = {
  pending: ["Waiting for the owner", "wait"], requested: ["Waiting for confirmation", "wait"], countered: ["Owner sent a counter-offer", "wait"],
  approved: ["Approved", "ok"], accepted: ["Accepted", "ok"], confirmed: ["Confirmed", "ok"], completed: ["Completed", "ok"],
  declined: ["Declined", "bad"], cancelled: ["Cancelled", "bad"], withdrawn: ["Withdrawn", "bad"], expired: ["Expired", "bad"], no_show: ["Marked as no-show", "bad"],
};
const CANCELLABLE: Record<Kind, string[]> = { rent: ["pending"], offer: ["pending"], view: ["requested", "confirmed"] };

function TrackFlow({ init, session, onClose, onToast }: { init?: { ref: string; token?: string }; session: Session | null; onClose: () => void; onToast: (m: string) => void }) {
  const [ref, setRef] = useState(init?.ref ?? "");
  const [token, setToken] = useState(init?.token ?? "");
  const [res, setRes] = useState<{ kind: Kind; data: TrackRes } | null>(null);
  const [busy, setBusy] = useState(false);
  const [e, setE] = useState("");
  const recent = useMemo(() => store.get<Tracked[]>(TRACK_KEY, []), []);

  const lookup = useCallback(async (r0: string, t0: string) => {
    const r = r0.trim().toUpperCase(), kind = kindOfRef(r);
    if (!kind) { setE("References start with RR-, OF- or VB-."); return; }
    setBusy(true); setE("");
    const out = await api<TrackRes>(`${TRACK_PATH[kind]}/${encodeURIComponent(r)}${t0.trim() ? `?token=${encodeURIComponent(t0.trim())}` : ""}`, "GET");
    setBusy(false);
    if (out.ok) setRes({ kind, data: out.data }); else { setRes(null); setE(errText(out.err)); }
  }, []);
  useEffect(() => { if (init?.ref) lookup(init.ref, init.token ?? ""); }, [init, lookup]);

  async function cancel() {
    if (!res) return;
    const { kind, data } = res;
    const path = `${TRACK_PATH[kind]}/${encodeURIComponent(data.ref)}/${kind === "offer" ? "withdraw" : "cancel"}`;
    setBusy(true);
    const out = await api(path, "POST", { token: token.trim() || undefined });
    setBusy(false);
    if (out.ok) { onToast(kind === "offer" ? "Offer withdrawn." : "Request cancelled."); lookup(data.ref, token); } else setE(errText(out.err));
  }

  const d = res?.data, st = d ? STATUS[d.status] ?? [cap(d.status), "wait" as const] : null;
  const rows: [string, string][] = !d || !res ? [] : [
    ...(d.property?.title ? [["Home", nice(d.property.title)] as [string, string]] : []),
    ...(res.kind === "rent" ? [
      ["Move-in", d.desiredMoveIn ? fmtDay(isoOf(new Date(d.desiredMoveIn)), { day: "numeric", month: "long", year: "numeric" }) : "—"],
      ["Lease", `${d.leaseMonths} months · ${d.occupants} ${d.occupants === 1 ? "person" : "people"}`],
      ...(d.pricing?.totalDueRwf ? [["Due if approved", rwf(d.pricing.totalDueRwf)] as [string, string]] : []),
    ] as [string, string][] : []),
    ...(res.kind === "offer" ? [
      ["Your offer", rwf(d.offerRwf ?? 0)], ["Asking price", rwf(d.askingPriceRwf ?? 0)],
      ...(d.counterOfferRwf ? [["Counter-offer", rwf(d.counterOfferRwf)] as [string, string]] : []),
    ] as [string, string][] : []),
    ...(res.kind === "view" && d.scheduledAt ? [
      ["When", new Date(d.scheduledAt).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" }) + " (Kigali)"],
      ["Visitors", String(d.visitors ?? 1)],
    ] as [string, string][] : []),
    ...(d.declineReason ? [["Owner's note", d.declineReason] as [string, string]] : []),
  ];
  const steps = d && st ? [
    { t: "Sent", s: d.createdAt ? new Date(d.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "", on: true },
    { t: "Owner review", s: "", on: true },
    { t: st[0], s: d.decidedAt ? new Date(d.decidedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "", on: st[1] !== "wait" },
  ] : [];

  return (
    <>
      <header className="flow-h"><div className="flow-prop"><div><small>Track a request</small><b>Where does it stand?</b></div></div><button className="x" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
      <div className="flow-b"><div className="step dir-fwd">
        {e && <div className="alert" role="alert">{e}</div>}
        {!d && (
          <>
            <Field label="Reference"><input value={ref} onChange={(ev) => setRef(ev.target.value.toUpperCase())} placeholder="e.g. VB-AB12CD34" autoCapitalize="characters" autoComplete="off" /></Field>
            <Field label="Tracking code" hint={session ? "Not needed when you're logged in to the account that sent it." : "You got this when you sent the request."}>
              <input value={token} onChange={(ev) => setToken(ev.target.value)} placeholder="24-character code" autoComplete="off" />
            </Field>
            {recent.length > 0 && (
              <div className="fld"><span className="fld-l">On this device</span>
                <div className="recent">
                  {recent.map((t) => (
                    <button type="button" key={t.ref} onClick={() => { setRef(t.ref); setToken(t.token ?? ""); lookup(t.ref, t.token ?? ""); }}>
                      <b>{t.ref}</b><span>{nice(t.title)}</span><ChevronRight size={16} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {d && st && (
          <>
            <div className={`pill ${st[1]}`}><i />{st[0]}</div>
            <ol className="tl">{steps.map((s, i) => <li key={i} className={s.on ? "on" : ""} style={css({ "--n": i })}><span />{<b>{s.t}</b>}{s.s && <small>{s.s}</small>}</li>)}</ol>
            <dl className="sum">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </>
        )}
      </div></div>
      <footer className="flow-f">
        {d ? <button className="btn ghost" onClick={() => { setRes(null); setE(""); }} disabled={busy}>Look up another</button> : <button className="btn ghost" onClick={onClose}>Close</button>}
        {d && res && CANCELLABLE[res.kind].includes(d.status)
          ? <button className="btn danger" onClick={cancel} disabled={busy}>{busy ? <Loader2 className="spin" size={18} /> : res.kind === "offer" ? "Withdraw offer" : "Cancel request"}</button>
          : !d && <button className="btn primary" onClick={() => lookup(ref, token)} disabled={busy || !ref.trim()}>{busy ? <><Loader2 className="spin" size={18} /> Checking…</> : "Check status"}</button>}
      </footer>
    </>
  );
}

/* ═══════════════════════════ report ═══════════════════════════ */
const REASONS = [
  ["scam", "Looks like a scam"], ["wrong_info", "Wrong information"], ["already_taken", "Already rented or sold"],
  ["duplicate", "Duplicate listing"], ["inappropriate", "Inappropriate content"], ["other", "Something else"],
] as const;
function ReportFlow({ p, onClose, onToast }: { p: P; onClose: () => void; onToast: (m: string) => void }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [e, setE] = useState("");
  async function send() {
    if (!reason) { setE("Choose a reason."); return; }
    setBusy(true);
    const r = await api(`/api/properties/${p.id}/report`, "POST", { reason, details: details.trim() || undefined });
    setBusy(false);
    if (r.ok) { onToast("Report sent. Thank you."); onClose(); } else setE(r.err.error === "network" ? errText(r.err) : "Couldn't send the report. Try again.");
  }
  return (
    <>
      <header className="flow-h"><div className="flow-prop"><div><small>Report this listing</small><b>What's wrong with it?</b></div></div><button className="x" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
      <div className="flow-b"><div className="step dir-fwd">
        {e && <div className="alert" role="alert">{e}</div>}
        <div className="radios list">
          {REASONS.map(([v, t]) => (
            <button type="button" key={v} className={reason === v ? "on" : ""} aria-pressed={reason === v} onClick={() => { setReason(v); setE(""); }}><b>{t}</b><Check size={16} /></button>
          ))}
        </div>
        <Field label="Details (optional)"><textarea rows={3} maxLength={1000} value={details} onChange={(ev) => setDetails(ev.target.value)} placeholder="Tell us what you noticed" /></Field>
      </div></div>
      <footer className="flow-f"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={send} disabled={busy}>{busy ? <><Loader2 className="spin" size={18} /> Sending…</> : "Send report"}</button></footer>
    </>
  );
}

/* ═══════════════════════════ share ═══════════════════════════ */
function ShareFlow({ p, place, onClose, onNative }: { p: P; place: string; onClose: () => void; onNative: () => void }) {
  const [url] = useState(() => window.location.href.split("#")[0]);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const isRent = p.mode === "rent";
  const text = `${nice(p.title)} · ${rwf(p.priceRwf)}${isRent ? " / month" : ""} · ${place}`;
  const full = `${text}\n${url}`, e = encodeURIComponent;
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const targets = [
    { t: "WhatsApp", I: MessageCircle, c: "#25d366", h: `https://wa.me/?text=${e(full)}` },
    { t: "Facebook", I: Facebook, c: "#1877f2", h: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}` },
    { t: "X", I: Twitter, c: "#14171a", h: `https://twitter.com/intent/tweet?text=${e(text)}&url=${e(url)}` },
    { t: "Telegram", I: Send, c: "#27a7e7", h: `https://t.me/share/url?url=${e(url)}&text=${e(text)}` },
    { t: "LinkedIn", I: Linkedin, c: "#0a66c2", h: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}` },
    { t: "Message", I: MessageSquare, c: "#1f7a4f", h: `sms:?&body=${e(full)}` },
    { t: "Email", I: Mail, c: "#b97f0a", h: `mailto:?subject=${e(nice(p.title))}&body=${e(full)}` },
  ];
  async function copy() {
    try { await navigator.clipboard.writeText(url); }
    catch { input.current?.select(); try { document.execCommand("copy"); } catch { /* manual copy */ } }
    setCopied(true); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 2200);
  }
  return (
    <>
      <header className="flow-h">
        <div className="flow-prop"><span className="sh-ico"><Share2 size={22} /></span><div><small>Share this home</small><b>Send it to someone</b></div></div>
        <button className="x" onClick={onClose} aria-label="Close"><X size={20} /></button>
      </header>
      <div className="flow-b sh-b"><div className="step dir-fwd">
        <div className="sh-card">
          <Img src={p.coverUrl || p.gallery?.[0]} loading="eager" />
          <div><b>{nice(p.title)}</b><small><MapPin size={13} />{place}</small><strong>{rwf(p.priceRwf)}{isRent ? " / month" : ""}</strong></div>
        </div>
        <div className="fld"><span className="fld-l">Page link</span>
          <div className={`sh-link${copied ? " ok" : ""}`}>
            <input id="share-url" ref={input} readOnly value={url} onFocus={(ev) => ev.target.select()} aria-label="Page link" />
            <button className={`btn primary sh-copy${copied ? " ok" : ""}`} onClick={copy} aria-live="polite">
              {copied ? <><Check key="c" size={18} /> Copied</> : <><Link2 key="l" size={18} /> Copy</>}
            </button>
          </div>
        </div>
        <div className="sh-grid" role="group" aria-label="Share with">
          {targets.map(({ t, I, c, h }, n) => (
            <a key={t} className="sh-t" style={css({ "--n": n, "--c": c })} href={h} {...(h.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}><i><I size={24} /></i>{t}</a>
          ))}
          {canNative && <button type="button" className="sh-t" style={css({ "--n": targets.length, "--c": "#5c6b64" })} onClick={onNative}><i><Share2 size={24} /></i>More</button>}
        </div>
      </div></div>
    </>
  );
}

/* ═══════════════════════════ lightbox ═══════════════════════════ */
function Lightbox({ imgs, start, onClose, title }: { imgs: string[]; start: number; onClose: () => void; title?: string }) {
  const [i, setI] = useState(start);
  const [dir, setDir] = useState(1);
  const [z, setZ] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [play, setPlay] = useState(false);
  const [ok, setOk] = useState(false);
  const [drag, setDrag] = useState(false);
  const x0 = useRef<number | null>(null);
  const d0 = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const reset = () => { setZ(1); setPan({ x: 0, y: 0 }); setOk(false); };
  const go = useCallback((d: number) => { setDir(d); setI((v) => (v + d + imgs.length) % imgs.length); setZ(1); setPan({ x: 0, y: 0 }); setOk(false); }, [imgs.length]);
  const jump = (n: number) => { if (n === i) return; setDir(n > i ? 1 : -1); setI(n); reset(); };
  const lim = (c: number) => { const el = stage.current; return { mx: el ? ((c - 1) * el.clientWidth) / 2 : 0, my: el ? ((c - 1) * el.clientHeight) / 2 : 0 }; };
  const zoom = (nz: number) => {
    const c = Math.min(4, Math.max(1, nz)); setZ(c);
    setPan((p) => { if (c === 1) return { x: 0, y: 0 }; const { mx, my } = lim(c); return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) }; });
  };
  const fs = () => { try { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {}); } catch { /* unsupported */ } };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Home") jump(0); else if (e.key === "End") jump(imgs.length - 1);
      else if (e.key === "+" || e.key === "=") zoom(z + 0.75); else if (e.key === "-") zoom(z - 0.75); else if (e.key === "0") zoom(1);
      else if (e.key === " " && imgs.length > 1) { e.preventDefault(); setPlay((v) => !v); } else if (e.key.toLowerCase() === "f") fs();
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  });
  useEffect(() => { [i + 1, i - 1].forEach((n) => { const s = imgs[(n + imgs.length) % imgs.length]; if (s) new window.Image().src = s; }); }, [i, imgs]);
  useEffect(() => { (strip.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); }, [i]);
  useEffect(() => { if (!play || z > 1) return; const t = setTimeout(() => go(1), 3500); return () => clearTimeout(t); }, [play, i, z, go]);

  return (
    <div className="lb-body" onTouchStart={(e) => { x0.current = z === 1 ? e.touches[0].clientX : null; }}
      onTouchEnd={(e) => { if (x0.current === null) return; const dx = e.changedTouches[0].clientX - x0.current; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); x0.current = null; }}>
      <div key={i} className="lb-bg" style={{ backgroundImage: `url("${imgs[i]}")` }} aria-hidden="true" />
      <div className="lb-top">
        <span className="lb-count"><b>{i + 1}</b> / {imgs.length}{title && <em>{title}</em>}</span>
        <div className="lb-tools">
          {imgs.length > 1 && <button className="lb-tool" onClick={() => setPlay((v) => !v)} aria-label={play ? "Pause slideshow" : "Play slideshow"} title="Slideshow (space)">{play ? <Pause size={19} /> : <Play size={19} />}</button>}
          <button className="lb-tool" onClick={() => zoom(z - 0.75)} disabled={z <= 1} aria-label="Zoom out" title="Zoom out (-)"><ZoomOut size={19} /></button>
          <button className="lb-tool" onClick={() => zoom(z + 0.75)} disabled={z >= 4} aria-label="Zoom in" title="Zoom in (+)"><ZoomIn size={19} /></button>
          <button className="lb-tool" onClick={fs} aria-label="Toggle full screen" title="Full screen (f)"><Expand size={19} /></button>
          <a className="lb-tool" href={imgs[i]} target="_blank" rel="noopener noreferrer" download aria-label="Open original photo" title="Open original"><Download size={19} /></a>
          <button className="lb-tool x2" onClick={onClose} aria-label="Close gallery"><X size={22} /></button>
        </div>
      </div>
      <div className="lb-stage" ref={stage}
        onClick={(e) => { if (e.target === e.currentTarget && z === 1) onClose(); }}
        onWheel={(e) => zoom(z - e.deltaY * 0.0025)}
        onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest(".lb-nav")) zoom(z > 1 ? 1 : 2.5); }}
        onPointerDown={(e) => { if (z <= 1 || (e.target as HTMLElement).closest(".lb-nav")) return; d0.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; setDrag(true); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { const d = d0.current; if (!d) return; const { mx, my } = lim(z); setPan({ x: Math.max(-mx, Math.min(mx, d.px + e.clientX - d.x)), y: Math.max(-my, Math.min(my, d.py + e.clientY - d.y)) }); }}
        onPointerUp={() => { d0.current = null; setDrag(false); }} onPointerCancel={() => { d0.current = null; setDrag(false); }}>
        {imgs.length > 1 && <button className="lb-nav l" onClick={() => go(-1)} aria-label="Previous photo"><ChevronLeft size={26} /></button>}
        <div className={`lb-pan${drag ? " drag" : ""}`} data-z={z > 1} style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${z})` }}>
          <img key={i} className={`lb-img ${dir > 0 ? "fr" : "fl"}`} src={imgs[i]} alt={`Photo ${i + 1} of ${imgs.length}`} draggable={false} onLoad={() => setOk(true)} />
        </div>
        {!ok && <span className="lb-load" aria-hidden="true"><Loader2 className="spin" size={30} /></span>}
        {imgs.length > 1 && <button className="lb-nav r" onClick={() => go(1)} aria-label="Next photo"><ChevronRight size={26} /></button>}
      </div>
      {imgs.length > 1 && (
        <div className="lb-thumbs" ref={strip}>
          {imgs.map((s, n) => <button key={s + n} className={n === i ? "on" : ""} onClick={() => jump(n)} aria-label={`Show photo ${n + 1}`} aria-current={n === i}><img src={s} alt="" loading="lazy" /></button>)}
        </div>
      )}
      {play && <i key={i} className="lb-prog" aria-hidden="true" />}
    </div>
  );
}

/* ═══════════════════════════ mortgage estimate (sale listings) ═══════════════════════════ */
function monthlyPayment(loan: number, yearly: number, years: number) {
  const r = yearly / 100 / 12, n = years * 12;
  return r === 0 ? loan / n : (loan * r) / (1 - Math.pow(1 + r, -n));
}
function Mortgage({ price }: { price: number }) {
  const [down, setDown] = useState(20);
  const [years, setYears] = useState(20);
  const [rate, setRate] = useState(13);
  const loan = price * (1 - down / 100);
  const pay = monthlyPayment(loan, rate, years);
  const total = pay * years * 12, interest = total - loan;
  const shown = useTween(pay, { ms: 500 });
  const pct = Math.round((loan / total) * 100);
  const fill = (v: number, a: number, b: number) => css({ "--fill": `${((v - a) / (b - a)) * 100}%` });
  return (
    <div className="calc">
      <div className="calc-out">
        <small>Estimated monthly payment</small>
        <b>{rwf(shown)}</b>
        <div className="split" role="img" aria-label={`${pct}% principal, ${100 - pct}% interest`}><i style={{ width: `${pct}%` }} /><i className="int" /></div>
        <div className="split-k"><span><em /> Principal {rwf(loan)}</span><span><em className="int" /> Interest {rwf(interest)}</span></div>
      </div>
      <div className="calc-in">
        <label className="rng"><span>Down payment <b>{down}% · {rwf(price * down / 100)}</b></span>
          <input type="range" min={10} max={80} step={5} value={down} onChange={(e) => setDown(+e.target.value)} style={fill(down, 10, 80)} /></label>
        <label className="rng"><span>Loan term <b>{years} years</b></span>
          <input type="range" min={5} max={25} step={1} value={years} onChange={(e) => setYears(+e.target.value)} style={fill(years, 5, 25)} /></label>
        <label className="rng"><span>Interest rate <b>{rate.toFixed(2).replace(/\.?0+$/, "")}% a year</b></span>
          <input type="range" min={8} max={20} step={0.25} value={rate} onChange={(e) => setRate(+e.target.value)} style={fill(rate, 8, 20)} /></label>
      </div>
      <p className="calc-note"><Info size={14} /> A rough guide only. Ask your bank for the rate and fees they would offer you.</p>
    </div>
  );
}

/* ═══════════════════════════ page ═══════════════════════════ */
export default function PropertyDetails({ property, similar = [] }: { property: Property; similar?: Card[] }) {
  const p = property as P;
  const isRent = p.mode === "rent";
  const imgs = useMemo(() => (p.gallery?.length ? p.gallery : ([p.coverUrl || p.image].filter(Boolean) as string[])), [p]);
  const plans = p.floorPlans ?? [];
  const coords = p.location?.point?.coordinates;
  const [lng, lat] = coords ?? [NaN, NaN];
  const hasMap = Number.isFinite(lat) && Number.isFinite(lng);
  const approx = !!(p.location as { approximate?: boolean } | undefined)?.approximate;

  const session = useSession();
  const [saved, setSaved] = useState(false);
  const [modal, setModal] = useState<ModalKey | null>(null);
  const [trackInit, setTrackInit] = useState<{ ref: string; token?: string } | undefined>();
  const [lb, setLb] = useState<{ list: string[]; i: number } | null>(null);
  const [toast, setToast] = useState<{ m: string; href?: string; label?: string } | null>(null);
  const [solid, setSolid] = useState(false);
  const [active, setActive] = useState(imgs.length > 1 ? "photos" : "overview");
  const [cost, setCost] = useState(false);
  const [burst, setBurst] = useState(0);
  const [hi, setHi] = useState(0);
  const [paused, setPaused] = useState(false);
  const hx = useRef<number | null>(null);
  const hero = imgs.slice(0, 4);
  const heroGo = (d: number) => setHi((v) => (v + d + hero.length) % hero.length);
  const root = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const tt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastModal = useRef(modal); if (modal) lastModal.current = modal;
  const mk = modal ?? lastModal.current;
  const lastLb = useRef(lb); if (lb) lastLb.current = lb;

  const say = useCallback((m: string, href?: string, label?: string) => {
    setToast({ m, href, label });
    if (tt.current) clearTimeout(tt.current);
    tt.current = setTimeout(() => setToast(null), href ? 5200 : 3200);
  }, []);
  const price = useTween(p.priceRwf, { from: 0, ms: 1300 });

  const live = !p.status || p.status === "published";
  const isOwner = !!session && !!p.ownerId && session.id === p.ownerId;
  const blocked = !live ? `This listing isn't live yet (${String(p.status).replace("_", " ")}).` : isOwner ? "This is your listing, so booking is turned off." : "";
  const open = (k: ModalKey) => { if (blocked && k !== "report" && k !== "track") { say(blocked); return; } setModal(k); };

  /* saved state comes from the server */
  useEffect(() => {
    if (!session) { setSaved(false); return; }
    let live2 = true;
    api<Card[]>("/api/saved-properties", "GET").then((r) => { if (live2 && r.ok) setSaved(r.data.some((x) => x.id === p.id)); });
    return () => { live2 = false; };
  }, [session?.id, p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* scroll: progress bar, hero parallax, solid top bar */
  useEffect(() => {
    const el = root.current; if (!el) return;
    const calm = reduced(); let raf = 0;
    const tick = () => {
      raf = 0;
      const y = window.scrollY, max = document.documentElement.scrollHeight - window.innerHeight;
      el.style.setProperty("--prog", String(max > 0 ? Math.min(1, y / max) : 0));
      if (!calm && y < 1000) el.style.setProperty("--sy", String(y));
      setSolid(y > 360);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(tick); };
    tick();
    window.addEventListener("scroll", on, { passive: true }); window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); if (raf) cancelAnimationFrame(raf); };
  }, []);

  /* scroll reveals + section spy */
  useEffect(() => {
    const el = root.current; if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    el.querySelectorAll("[data-r]").forEach((n) => io.observe(n));
    const spy = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); }), { rootMargin: "-35% 0px -55% 0px" });
    el.querySelectorAll(".main section[id]").forEach((n) => spy.observe(n));
    return () => { io.disconnect(); spy.disconnect(); };
  }, []);

  /* hero slideshow: advances every 6s, pauses on hover and while the gallery is open */
  useEffect(() => {
    if (hero.length < 2 || paused || lb || reduced()) return;
    const id = setTimeout(() => setHi((v) => (v + 1) % hero.length), 6000);
    return () => clearTimeout(id);
  }, [hero.length, paused, lb, hi]);

  /* click ripple on every button, wherever it lives (modals render outside the page root) */
  useEffect(() => {
    if (reduced()) return;
    const on = (e: PointerEvent) => {
      const b = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".btn, .thumbs-all, .chips button, .days button, .radios button, .sim-nav button, .lb-tool");
      if (!b || (b as HTMLButtonElement).disabled) return;
      const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.2;
      const el = document.createElement("span"); el.className = "rip";
      el.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
      b.appendChild(el); setTimeout(() => el.remove(), 700);
    };
    document.addEventListener("pointerdown", on);
    return () => document.removeEventListener("pointerdown", on);
  }, []);

  async function toggleSave() {
    if (!session) { say("Log in to save homes you like.", `${LOGIN_PATH}?next=${encodeURIComponent(window.location.pathname)}`, "Log in"); return; }
    const was = saved; setSaved(!was); if (!was) setBurst((b) => b + 1);
    const r = await api(`/api/saved-properties/${p.id}`, was ? "DELETE" : "POST");
    if (!r.ok) { setSaved(was); say(r.err.error === "network" ? errText(r.err) : "Couldn't update saved homes. Try again."); }
    else say(was ? "Removed from saved homes." : "Saved to your homes.");
  }
  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: p.title, text: `${nice(p.title)} · ${rwf(p.priceRwf)}${isRent ? " / month" : ""}`, url });
      else { await navigator.clipboard.writeText(url); say("Link copied."); }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      try { await navigator.clipboard.writeText(url); say("Link copied."); } catch { say("Couldn't share. Copy the address from your browser."); }
    }
  }
  const slide = (d: number) => strip.current?.scrollBy({ left: d * (strip.current.clientWidth * 0.8), behavior: "smooth" });

  const stats = [
    { I: BedDouble, v: p.bedrooms ?? 0, l: (p.bedrooms ?? 0) === 1 ? "bedroom" : "bedrooms", show: true },
    { I: Bath, v: p.bathrooms ?? 0, l: (p.bathrooms ?? 0) === 1 ? "bathroom" : "bathrooms", show: true },
    { I: Ruler, v: p.areaSqm ?? 0, l: "m²", show: !!p.areaSqm },
    { I: Car, v: p.parkingSpaces ?? 0, l: "parking", show: (p.parkingSpaces ?? 0) > 0 },
  ].filter((s) => s.show);

  const facts: [string, string, typeof Check][] = ([
    ["Furnishing", p.furnishing ? FURN[p.furnishing] : "", Sofa],
    ["Available from", p.availableFrom ? new Date(p.availableFrom).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "", CalendarDays],
    ["Deposit", isRent && p.depositMonths ? `${p.depositMonths} month${p.depositMonths > 1 ? "s" : ""}` : "", Wallet],
    ["Minimum lease", isRent && p.minLeaseMonths ? `${p.minLeaseMonths} months` : "", CalendarClock],
    ["Built in", p.yearBuilt ? String(p.yearBuilt) : "", Building2],
    ["Listed", ago(p.publishedAt), Clock],
    ["Listing ref", p.ref ?? "", KeyRound],
  ] as [string, string, typeof Check][]).filter((x) => x[1]);

  const primary: Kind = isRent ? "rent" : "offer";
  const primaryLabel = isRent ? "Request to rent" : "Make an offer";
  const wa = (p.ownerWhatsapp || p.ownerPhone || "").replace(/\D/g, "");
  const ownerWa = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(`Hello, I'm interested in "${p.title}" (${p.ref}) on UrugoLink.`)}` : "";
  const place = [p.neighbourhood, p.district, p.province].filter(Boolean).join(", ");
  const saves = p.stats?.saves ?? 0;
  const monthlyMove = p.priceRwf + p.priceRwf * (p.depositMonths ?? 0) + Math.round(p.priceRwf * 0.03);
  const estMortgage = !isRent ? monthlyPayment(p.priceRwf * 0.8, 13, 20) : 0;
  const nav: [string, string][] = [...(imgs.length > 1 ? [["photos", "Photos"] as [string, string]] : []), ["overview", "Overview"], ...(p.amenities?.length ? [["amenities", "Amenities"] as [string, string]] : []), ...(p.nearby?.length ? [["nearby", "Nearby"] as [string, string]] : []), ...(!isRent ? [["finance", "Mortgage"] as [string, string]] : []), ["location", "Location"]];
  const box = approx ? 0.02 : 0.012;

  const ld = {
    "@context": "https://schema.org", "@type": "RealEstateListing", name: p.title, image: imgs.slice(0, 6), datePosted: p.publishedAt,
    offers: { "@type": "Offer", price: p.priceRwf, priceCurrency: "RWF" },
    about: { "@type": "Residence", numberOfBedrooms: p.bedrooms, numberOfBathroomsTotal: p.bathrooms, address: { "@type": "PostalAddress", addressLocality: p.district, addressRegion: p.province, addressCountry: "RW" } },
  };

  return (
    <div className="pdx" ref={root}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <div className="progress" aria-hidden="true"><i /></div>

      <header className={`bar${solid ? " solid" : ""}`}>
        <div className="bar-in">
          <Link href="/#properties" className="back"><ArrowLeft size={18} /><span>All homes</span></Link>
          <div className="bar-title" aria-hidden={!solid}><b>{nice(p.title)}</b><span>{rwf(p.priceRwf)}{isRent ? " / month" : ""}</span></div>
          <div className="bar-act">
            <button onClick={() => setModal("track")} aria-label="Track a request" title="Track a request"><Search size={18} /></button>
            <button onClick={() => setModal("share")} aria-label="Share this home" title="Share"><Share2 size={18} /></button>
            <button onClick={toggleSave} aria-pressed={saved} aria-label={saved ? "Remove from saved homes" : "Save this home"} title={saved ? "Saved" : "Save"} className={saved ? "saved" : ""}>
              <Heart size={18} fill={saved ? "currentColor" : "none"} />{burst > 0 && saved && <i key={burst} className="burst" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* hero: crossfading slideshow with arrows, thumbs and swipe */}
        <section className="hero" aria-label="Photos" data-paused={paused || !!lb}
          onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
          onTouchStart={(e) => { hx.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => { if (hx.current === null) return; const dx = e.changedTouches[0].clientX - hx.current; hx.current = null; if (Math.abs(dx) > 50) heroGo(dx < 0 ? 1 : -1); }}>
          {hero.length ? (
            <button className="hero-img" onClick={() => setLb({ list: imgs, i: hi })} aria-label={`Open all ${imgs.length} photos`}>
              <span className="pz">{hero.map((s, n) => <span key={s + n} className={`hs${n === hi ? " on" : ""}`}><Img src={s} alt={n === hi ? p.title : ""} loading={n === 0 ? "eager" : "lazy"} /></span>)}</span>
            </button>
          ) : <div className="hero-empty"><Images size={40} /><span>No photos yet</span></div>}
          <div className="hero-shade" />
          {hero.length > 1 && (
            <>
              <button className="hero-nav l" onClick={() => heroGo(-1)} aria-label="Previous photo"><ChevronLeft size={22} /></button>
              <button className="hero-nav r" onClick={() => heroGo(1)} aria-label="Next photo"><ChevronRight size={22} /></button>
              <div className="hero-dots">{hero.map((_, n) => <button key={n} className={n === hi ? "on" : ""} onClick={() => setHi(n)} aria-label={`Show photo ${n + 1}`} />)}</div>
              <div className="hero-bar" aria-hidden="true"><i key={hi} /></div>
            </>
          )}
          <div className="hero-in">
            <div className="hero-copy">
              <div className="badges">
                {p.tag && <span className="b gold"><Sparkles size={13} /> {p.tag}</span>}
                <span className={`b ${isRent ? "rent" : "sale"}`}>{isRent ? "For rent" : "For sale"}</span>
                <span className="b glass">{cap(p.propertyType)}</span>
              </div>
              <h1>{nice(p.title)}</h1>
              <p className="loc"><MapPin size={17} />{place}</p>
            </div>
            {imgs.length > 0 && (
              <div className="thumbs">
                {hero.length > 1 && hero.map((s, n) => (
                  <button key={s + n} className={`thumb${n === hi ? " on" : ""}`} style={css({ "--n": n })} onClick={() => setHi(n)} aria-label={`Show photo ${n + 1}`} aria-current={n === hi}><Img src={s} loading="eager" /></button>
                ))}
                <button className="thumbs-all" style={css({ "--n": hero.length })} onClick={() => setLb({ list: imgs, i: hi })}><Images size={16} /> {imgs.length > 1 ? `All ${imgs.length} photos` : "View photo"}</button>
              </div>
            )}
          </div>
        </section>

        <div className="wrap">
          <ul className="stats" aria-label="Key facts">
            {stats.map(({ I, v, l }, i) => <li key={l} style={css({ "--n": i })}><I size={20} /><b><Count n={v} ms={900} /></b><span>{l}</span></li>)}
          </ul>

          <nav className="sec-nav" aria-label="Sections">
            {nav.map(([id, t]) => <a key={id} href={`#${id}`} className={active === id ? "on" : ""} aria-current={active === id ? "location" : undefined}>{t}</a>)}
          </nav>

          <div className="cols">
            <div className="main">
              {imgs.length > 1 && (
                <section id="photos" data-r>
                  <div className="sec-head">
                    <h2>Photo gallery</h2>
                    <button className="btn outline sm" onClick={() => setLb({ list: imgs, i: 0 })}><Images size={16} /> View all {imgs.length}</button>
                  </div>
                  <div className={`gal n${Math.min(imgs.length, 5)}`} data-stagger>
                    {imgs.slice(0, 5).map((s, n) => (
                      <button key={s + n} className="gt" style={css({ "--n": n })} onClick={() => setLb({ list: imgs, i: n })} aria-label={`Open photo ${n + 1} of ${imgs.length}`}>
                        <Img src={s} alt={`${nice(p.title)}, photo ${n + 1}`} loading={n < 2 ? "eager" : "lazy"} />
                        <span className="gt-zoom" aria-hidden="true"><Maximize2 size={17} /></span>
                        {n === 4 && imgs.length > 5 && <span className="gt-more"><b>+{imgs.length - 5}</b><small>more photos</small></span>}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section id="overview" data-r>
                <h2>About this home</h2>
                {p.description?.length ? p.description.map((t, i) => <p className="txt" key={i}>{t}</p>) : <p className="txt mute">The owner hasn't added a description yet.</p>}
                {facts.length > 0 && <dl className="facts" data-stagger>{facts.map(([k, v, I], i) => <div key={k} style={css({ "--n": i })}><I size={18} /><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
                {plans.length > 0 && (
                  <button className="plan" onClick={() => setLb({ list: plans, i: 0 })}><Ruler size={18} /><span><b>Floor plan</b><small>{plans.length} {plans.length === 1 ? "drawing" : "drawings"}</small></span><ArrowUpRight size={18} /></button>
                )}
              </section>

              {!!p.amenities?.length && (
                <section id="amenities" data-r>
                  <h2>What this place offers</h2>
                  <ul className="amen" data-stagger>{p.amenities.map((a, i) => { const I = amenityIcon(a); return <li key={a} style={css({ "--n": i })}><I size={18} />{a}</li>; })}</ul>
                </section>
              )}

              {!!p.nearby?.length && (
                <section id="nearby" data-r>
                  <h2>Getting around</h2>
                  <ul className="near" data-stagger>{p.nearby.map((n, i) => <li key={n.label} style={css({ "--n": i })}><Footprints size={18} /><b>{n.label}</b><span>{n.distance}</span></li>)}</ul>
                </section>
              )}

              {!isRent && (
                <section id="finance" data-r>
                  <h2>Mortgage estimate</h2>
                  <Mortgage price={p.priceRwf} />
                </section>
              )}

              <section id="location" data-r>
                <h2>Location</h2>
                <div className="map">
                  {hasMap ? (
                    <iframe title={`Map of ${place}`} loading="lazy" src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - box}%2C${lat - box * 0.6}%2C${lng + box}%2C${lat + box * 0.6}&layer=mapnik${approx ? "" : `&marker=${lat}%2C${lng}`}`} />
                  ) : (
                    <div className="map-ph"><MapPin size={30} /><b>{p.neighbourhood || p.district}</b><span>{p.district}, {p.province}</span></div>
                  )}
                </div>
                {approx && <p className="map-note"><Info size={14} /> The owner keeps the exact address private. The map shows the general area. You'll get the address when a viewing is confirmed.</p>}
                {hasMap && (
                  <div className="maplinks">
                    <a target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`}>Open larger map <ArrowUpRight size={14} /></a>
                    {!approx && <a target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}><Navigation size={14} /> Get directions</a>}
                  </div>
                )}
              </section>
            </div>

            <aside className="side">
              <div className="card">
                <div className="price"><b>{rwf(price)}</b>{isRent && <span>/ month</span>}</div>
                {isRent && (p.depositMonths ?? 0) > 0 && <p className="price-sub">Deposit of {p.depositMonths} month{p.depositMonths! > 1 ? "s" : ""} · {rwf(p.priceRwf * p.depositMonths!)}</p>}
                {!isRent && <p className="price-sub">{p.areaSqm ? `About ${rwf(p.priceRwf / p.areaSqm)} per m² · ` : ""}from ~{rwf(estMortgage)} / month <a href="#finance">with a mortgage</a></p>}

                {isRent && (
                  <div className={`cost${cost ? " open" : ""}`}>
                    <button onClick={() => setCost(!cost)} aria-expanded={cost}><Receipt size={16} /> Cost to move in <b>{rwf(monthlyMove)}</b><ChevronDown size={16} /></button>
                    <div className="cost-b"><div>
                      <p><span>First month</span><b>{rwf(p.priceRwf)}</b></p>
                      {(p.depositMonths ?? 0) > 0 && <p><span>Deposit</span><b>{rwf(p.priceRwf * p.depositMonths!)}</b></p>}
                      <p><span>Service fee (3%)</span><b>{rwf(Math.round(p.priceRwf * 0.03))}</b></p>
                    </div></div>
                  </div>
                )}

                {blocked && <p className="notice" role="status"><Info size={15} />{blocked}</p>}
                <button className="btn primary wide" onClick={() => open(primary)} disabled={!!blocked}>{primaryLabel}</button>
                <button className="btn outline wide" onClick={() => open("view")} disabled={!!blocked}><CalendarDays size={18} /> Book a viewing</button>
                <p className="note"><ShieldCheck size={15} /> Nothing is charged until the owner accepts.</p>

                <div className="owner">
                  <span className="av">{(p.ownerName || "O").slice(0, 1).toUpperCase()}</span>
                  <div><small>Listed by</small><b>{p.ownerName || "Property owner"}{p.ownerVerified && <BadgeCheck size={16} className="ver" aria-label="Verified" />}</b>
                    {p.ownerResponseMinutes ? <small className="rep">Usually replies within {replyTime(p.ownerResponseMinutes)}</small> : null}</div>
                </div>
                {p.ownerPhone && (
                  <div className="reach">
                    <a className="btn outline" href={`tel:${p.ownerPhone.replace(/[^\d+]/g, "")}`}><Phone size={16} /> Call</a>
                    <a className="btn outline" href={ownerWa} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> WhatsApp</a>
                  </div>
                )}
                <div className="card-foot">
                  {saves > 0 && <span><Heart size={13} /> {saves} saved this</span>}
                  <button className="report" onClick={() => setModal("report")}><Flag size={14} /> Report</button>
                </div>
              </div>
            </aside>
          </div>

          {similar.length > 0 && (
            <section className="sim" data-r>
              <div className="sim-head">
                <h2>More homes nearby</h2>
                <div className="sim-nav"><button onClick={() => slide(-1)} aria-label="Scroll left"><ChevronLeft size={18} /></button><button onClick={() => slide(1)} aria-label="Scroll right"><ChevronRight size={18} /></button></div>
              </div>
              <div className="sim-row" ref={strip}>
                {similar.map((s) => (
                  <Link key={s.id} href={`/properties/${s.slug || s.id}`} className="sc">
                    <div className="sc-img"><Img src={s.coverUrl} />{s.tag && <em>{s.tag}</em>}</div>
                    <div className="sc-b">
                      <small>{cap(s.propertyType)} · {s.mode === "rent" ? "For rent" : "For sale"}</small>
                      <h3>{nice(s.title)}</h3>
                      <p><MapPin size={13} />{s.district}, {s.province}</p>
                      <div><b>RWF {short(s.priceRwf)}</b>{s.mode === "rent" && <span> / month</span>}<i>{s.bedrooms ?? 0} bd · {s.bathrooms ?? 0} ba</i></div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      <div className="dock">
        <div><b>RWF {short(p.priceRwf)}</b>{isRent && <span> / month</span>}</div>
        <button className="btn outline" onClick={() => open("view")} disabled={!!blocked} aria-label="Book a viewing"><CalendarDays size={18} /></button>
        <button className="btn primary" onClick={() => open(primary)} disabled={!!blocked}>{primaryLabel}</button>
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} label={mk === "report" ? "Report listing" : mk === "track" ? "Track a request" : mk === "share" ? "Share this home" : "Booking"}>
        {(mk === "rent" || mk === "offer" || mk === "view") && <BookingFlow key={mk} kind={mk} p={p} session={session} onClose={() => setModal(null)} onToast={say} onTrack={(ref, token) => { setTrackInit({ ref, token }); setModal("track"); }} />}
        {mk === "track" && <TrackFlow key={trackInit?.ref ?? "t"} init={trackInit} session={session} onClose={() => { setModal(null); setTrackInit(undefined); }} onToast={say} />}
        {mk === "report" && <ReportFlow p={p} onClose={() => setModal(null)} onToast={say} />}
        {mk === "share" && <ShareFlow p={p} place={place} onClose={() => setModal(null)} onNative={share} />}
      </Modal>
      <Modal open={lb !== null} onClose={() => setLb(null)} label="Photo gallery" className="lb">
        {lastLb.current && <Lightbox imgs={lastLb.current.list} start={lastLb.current.i} onClose={() => setLb(null)} title={nice(p.title)} />}
      </Modal>

      <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">
        <Clock size={16} /><span>{toast?.m}</span>{toast?.href && <a href={toast.href}>{toast.label}</a>}
      </div>
    </div>
  );
}