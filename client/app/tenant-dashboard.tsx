"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Bell, CalendarDays, CheckCircle2, ChevronRight, FileText,
  Heart, Home, KeyRound, LayoutDashboard, LogOut, MessageCircle, Search,
  UserRound, Wallet,
} from "lucide-react";
import { formatPrice } from "./properties-data";
import "./tenant-dashboard.css";

type TenantUser = { id: string; fullName: string; email: string; phone: string };
type TenantProperty = {
  id: string;
  href: string;
  title: string;
  price: number;
  mode: "Rent" | "Sale";
  district: string;
  province: string;
  image: string;
  beds: number;
  baths: number;
  type: string;
};
type TenantRecord = {
  id?: string;
  ref?: string;
  status?: string;
  title?: string;
  body?: string;
  message?: string;
  type?: string;
  purpose?: string;
  createdAt?: string;
  scheduledAt?: string;
  desiredMoveIn?: string;
  startDate?: string;
  endDate?: string;
  amountRwf?: number;
  monthlyRentRwf?: number;
  durationMinutes?: number;
  property?: { title?: string };
  pricing?: { monthlyRentRwf?: number };
};
type SectionId =
  | "dashboard" | "rentals" | "saved" | "applications" | "viewings"
  | "lease" | "payments" | "messages" | "notifications" | "profile";
type Section = { id: SectionId; label: string; icon: typeof Home };

const sections: Section[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "rentals", label: "Find Rentals", icon: Search },
  { id: "saved", label: "Saved Properties", icon: Heart },
  { id: "applications", label: "Rental Applications", icon: FileText },
  { id: "viewings", label: "Viewings", icon: CalendarDays },
  { id: "lease", label: "My Lease", icon: KeyRound },
  { id: "payments", label: "Rent & Payments", icon: Wallet },
  { id: "messages", label: "Messages", icon: MessageCircle },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "profile", label: "My Profile", icon: UserRound },
];

const sectionTitles: Record<SectionId, string> = {
  dashboard: "Your home search, in one place",
  rentals: "Find your next home",
  saved: "Your saved properties",
  applications: "Rental applications",
  viewings: "Your viewings",
  lease: "My lease",
  payments: "Rent & payments",
  messages: "Messages",
  notifications: "Notifications",
  profile: "My profile",
};

const endpoints: Partial<Record<SectionId, string>> = {
  applications: "/api/me/my-rent-requests",
  viewings: "/api/me/viewing-bookings",
  lease: "/api/leases",
  payments: "/api/payments",
  notifications: "/api/notifications",
};

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

function recordHeading(record: TenantRecord, section: SectionId) {
  if (section === "notifications") return record.title || "UrugoLink update";
  if (section === "payments") return record.purpose?.replaceAll("_", " ") || "Rent payment";
  return record.property?.title || record.ref || sectionTitles[section];
}

function recordDescription(record: TenantRecord, section: SectionId) {
  if (section === "notifications") return record.body || record.message || "You have a new update.";
  if (section === "applications") {
    const rent = record.pricing?.monthlyRentRwf;
    return [record.desiredMoveIn && `Move-in ${formatDate(record.desiredMoveIn)}`, rent && formatPrice(rent, "Rent")].filter(Boolean).join(" · ");
  }
  if (section === "viewings") {
    const date = formatDate(record.scheduledAt);
    return [date, record.durationMinutes && `${record.durationMinutes} min`].filter(Boolean).join(" · ");
  }
  if (section === "lease") {
    const rent = record.monthlyRentRwf;
    return [record.startDate && `From ${formatDate(record.startDate)}`, rent && formatPrice(rent, "Rent")].filter(Boolean).join(" · ");
  }
  if (section === "payments") {
    const amount = record.amountRwf;
    return [amount && formatPrice(amount, "Rent"), formatDate(record.createdAt)].filter(Boolean).join(" · ");
  }
  return formatDate(record.createdAt);
}

export default function TenantDashboard({
  user,
  properties,
  savedIds,
  savedProperties,
  loadingProperties,
  fetchData,
  onSave,
  onSignOut,
}: {
  user: TenantUser;
  properties: TenantProperty[];
  savedIds: string[];
  savedProperties: TenantProperty[];
  loadingProperties: boolean;
  fetchData: (path: string, init?: RequestInit) => Promise<Response>;
  onSave: (id: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const [active, setActive] = useState<SectionId>("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [records, setRecords] = useState<TenantRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [rentalQuery, setRentalQuery] = useState("");
  const firstName = user.fullName.trim().split(/\s+/)[0] || "there";

  useEffect(() => {
    const endpoint = endpoints[active];
    if (!endpoint) {
      setRecords([]);
      setRecordsError("");
      setRecordsLoading(false);
      return;
    }

    const controller = new AbortController();
    setRecordsLoading(true);
    setRecordsError("");
    fetchData(endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load this section (status ${response.status}).`);
        const result = await response.json() as { data?: TenantRecord[] };
        setRecords(result.data ?? []);
      })
      .catch((error: Error) => {
        if (error.name === "AbortError") return;
        setRecordsError(error.message || "Could not load this section. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setRecordsLoading(false);
      });

    return () => controller.abort();
  }, [active, fetchData]);

  const rentals = useMemo(() => properties.filter((property) => {
    const search = rentalQuery.trim().toLowerCase();
    return property.mode === "Rent" && (!search || `${property.title} ${property.district} ${property.province}`.toLowerCase().includes(search));
  }), [properties, rentalQuery]);
  const selected = sections.find((section) => section.id === active) ?? sections[0];
  const Icon = selected.icon;

  function chooseSection(id: SectionId) {
    setActive(id);
    setMobileNavOpen(false);
  }

  function propertyGrid(list: TenantProperty[]) {
    if (!list.length) {
      return <div className="td-empty"><span><Home size={21}/></span><h3>No properties to show yet</h3><p>Save a rental you like and it will appear here.</p><button className="td-secondary" onClick={() => chooseSection("rentals")}>Browse rentals <ArrowRight size={15}/></button></div>;
    }
    return <div className="td-property-grid">{list.map((property) => (
      <article className="td-property" key={property.id}>
        <a className="td-property-image" href={property.href} style={property.image ? { backgroundImage: `url("${property.image}")` } : undefined} aria-label={`View ${property.title}`} />
        <div className="td-property-body">
          <div className="td-property-meta">{property.type} <span>·</span> {property.district}</div>
          <a className="td-property-title" href={property.href}>{property.title}</a>
          <div className="td-property-bottom"><strong>{formatPrice(property.price, property.mode)}</strong>
            <button type="button" className={savedIds.includes(property.id) ? "td-save is-saved" : "td-save"} aria-label={savedIds.includes(property.id) ? "Remove saved property" : "Save property"} onClick={() => void onSave(property.id)}><Heart size={17} fill={savedIds.includes(property.id) ? "currentColor" : "none"}/></button>
          </div>
        </div>
      </article>
    ))}</div>;
  }

  function sectionContent() {
    if (active === "dashboard") {
      return <>
        <section className="td-welcome">
          <div><span className="td-overline">TENANT PORTAL</span><h1>Welcome home, {firstName}.</h1><p>Pick up where you left off and find a place that feels right.</p></div>
          <button className="td-primary" onClick={() => chooseSection("rentals")}><Search size={16}/> Find a rental</button>
        </section>
        <section className="td-stats" aria-label="Your activity">
          <button onClick={() => chooseSection("saved")}><span className="td-stat-icon"><Heart size={18}/></span><span><small>Saved properties</small><strong>{savedIds.length}</strong></span><ChevronRight size={17}/></button>
          <button onClick={() => chooseSection("rentals")}><span className="td-stat-icon"><Home size={18}/></span><span><small>Rentals to explore</small><strong>{loadingProperties ? "…" : rentals.length}</strong></span><ChevronRight size={17}/></button>
          <button onClick={() => chooseSection("applications")}><span className="td-stat-icon"><FileText size={18}/></span><span><small>Rental applications</small><strong>View activity</strong></span><ChevronRight size={17}/></button>
        </section>
        <section className="td-content-section"><div className="td-section-heading"><div><span className="td-overline">HANDPICKED FOR YOU</span><h2>Explore rentals</h2></div><button className="td-text-link" onClick={() => chooseSection("rentals")}>View all <ArrowRight size={15}/></button></div>{propertyGrid(rentals.slice(0, 3))}</section>
      </>;
    }

    if (active === "rentals" || active === "saved") {
      const list = active === "rentals" ? rentals : savedProperties;
      return <section className="td-content-section">
        <div className="td-section-heading"><div><span className="td-overline">{active === "rentals" ? "AVAILABLE HOMES" : "YOUR SHORTLIST"}</span><h2>{active === "rentals" ? "Find a rental" : "Saved properties"}</h2></div></div>
        {active === "rentals" && <label className="td-search"><Search size={17}/><input value={rentalQuery} onChange={(event) => setRentalQuery(event.target.value)} placeholder="Search by home or location" aria-label="Search rentals"/></label>}
        {loadingProperties && active === "rentals" ? <div className="td-loading">Loading available rentals…</div> : propertyGrid(list)}
      </section>;
    }

    if (active === "profile") {
      return <section className="td-content-section td-profile">
        <span className="td-overline">ACCOUNT DETAILS</span><h2>My profile</h2>
        <div className="td-profile-card"><div className="td-profile-avatar">{user.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}</div><div><h3>{user.fullName}</h3><p>{user.email}</p><p>{user.phone}</p></div></div>
        <p className="td-muted">Profile editing will be available here soon.</p>
      </section>;
    }

    if (active === "messages") {
      return <div className="td-empty"><span><MessageCircle size={21}/></span><h3>Messages are coming soon</h3><p>Owner conversations will appear here when messaging is available.</p></div>;
    }

    return <section className="td-content-section">
      <span className="td-overline">YOUR ACCOUNT</span><h2>{sectionTitles[active]}</h2>
      {recordsLoading ? <div className="td-loading">Loading your {selected.label.toLowerCase()}…</div>
        : recordsError ? <div className="td-error" role="alert">{recordsError}</div>
        : records.length ? <div className="td-records">{records.map((record, index) => (
          <article className="td-record" key={record.id ?? record.ref ?? index}>
            <span className="td-record-icon"><Icon size={18}/></span>
            <div className="td-record-copy"><strong>{recordHeading(record, active)}</strong><small>{recordDescription(record, active)}</small></div>
            {record.status && <span className="td-status">{record.status.replaceAll("_", " ")}</span>}
          </article>
        ))}</div>
        : <div className="td-empty"><span><CheckCircle2 size={21}/></span><h3>Nothing here yet</h3><p>Your {selected.label.toLowerCase()} will appear here when you have activity.</p>{active === "applications" && <button className="td-secondary" onClick={() => chooseSection("rentals")}>Explore rentals <ArrowRight size={15}/></button>}</div>}
    </section>;
  }

  return <div className="td-shell">
    <aside className={mobileNavOpen ? "td-sidebar is-open" : "td-sidebar"}>
      <a className="td-brand" href="/" aria-label="UrugoLink home"><span className="td-brand-mark"><Home size={19}/></span><span>urugo<span>link</span><small>TENANT PORTAL</small></span></a>
      <div className="td-nav-label">MENU</div>
      <nav className="td-nav" aria-label="Tenant navigation">
        {sections.slice(0, 7).map(({ id, label, icon: NavIcon }) => <button key={id} type="button" className={active === id ? "is-active" : ""} aria-current={active === id ? "page" : undefined} onClick={() => chooseSection(id)}><NavIcon size={18}/><span>{label}</span>{id === "saved" && savedIds.length > 0 && <small>{savedIds.length}</small>}</button>)}
      </nav>
      <div className="td-nav-label td-nav-label-secondary">ACCOUNT</div>
      <nav className="td-nav" aria-label="Account navigation">
        {sections.slice(7).map(({ id, label, icon: NavIcon }) => <button key={id} type="button" className={active === id ? "is-active" : ""} aria-current={active === id ? "page" : undefined} onClick={() => chooseSection(id)}><NavIcon size={18}/><span>{label}</span></button>)}
        <button type="button" onClick={onSignOut}><LogOut size={18}/><span>Sign Out</span></button>
      </nav>
      <div className="td-sidebar-footer"><span className="td-footer-avatar">{user.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}</span><span><b>{user.fullName}</b><small>Home seeker</small></span><LogOut className="td-footer-exit" size={16}/></div>
    </aside>
    {mobileNavOpen && <button className="td-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}/>}
    <main className="td-main">
      <header className="td-topbar">
        <button className="td-mobile-menu" type="button" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><span/></button>
        <div className="td-breadcrumb"><span>Tenant portal</span><ChevronRight size={15}/><b>{selected.label}</b></div>
        <button className="td-top-profile" type="button" onClick={() => chooseSection("profile")}><span className="td-footer-avatar">{user.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}</span><span>{firstName}</span><UserRound size={17}/></button>
      </header>
      <div className="td-page">{active !== "dashboard" && <div className="td-page-heading"><div><span className="td-overline">TENANT PORTAL</span><h1>{sectionTitles[active]}</h1></div></div>}{sectionContent()}</div>
      <footer className="td-page-footer">UrugoLink <span>·</span> Find a place. Make it home.</footer>
    </main>
  </div>;
}
