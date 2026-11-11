"use client";

import Link from "next/link";
import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Activity, BarChart3, Ban, Briefcase, Building2, CalendarCheck, Check, Eye, FileText, Home,
  LogOut, Menu, RefreshCw, Search, Tag, Trash2, Users, Wallet, X, ChevronLeft, ChevronRight, Plus, Star, Upload,
} from "lucide-react";

/* ═════════════ API + auth (same session the /login page saves) ═════════════ */
const API = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const AUTH_KEY = "urugolink.auth";
type Role = "tenant" | "landlord" | "agent" | "admin";
type AuthUser = { id: string; email: string; phone: string; fullName: string; role: Role };
type Stored = { user: AuthUser; tokens: { access: string; refresh: string } };

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
      if (r.status === 401 || r.status === 422) clearAuth();
    } catch (e) {
      console.log("[auth] refresh network error", e);
    }
    return null;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

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

const FRIENDLY: Record<string, string> = {
  not_logged_in: "Your session ended. Please log in again.",
  authentication_required: "Your session ended. Please log in again.",
  forbidden: "You don’t have permission to do that.",
  not_pending: "That item is no longer pending.",
  invalid_transition: "That change isn’t allowed from the current status.",
  slot_taken: "Another viewing is already confirmed for that time.",
  last_admin: "You can’t remove or change the last active admin.",
  cannot_target_self: "You can’t do that to your own account.",
  cannot_change_own_role: "You can’t change your own role.",
  cover_image_required: "The listing needs a cover image before it can be published.",
  guest_requests_require_registration: "Guest requests can’t be approved. The requester must register first.",
  active_lease_exists: "This property already has an active lease.",
  lease_active: "Terminate the active lease before deleting it.",
  has_lease: "A lease was created from this request. Delete or terminate the lease first.",
  has_payments: "Payments are linked to this record, so it can’t be deleted.",
  not_terminable: "Only draft or active leases can be terminated.",
  not_found: "That record no longer exists.",
  upload_route_missing: "The API doesn’t have the upload route yet. Replace Server.js with the updated one and restart the API.",
  file_too_large: "That image is too large (the limit is 8 MB).",
  unsupported_image: "Only JPG, PNG or WebP images are allowed.",
  invalid_image: "That file isn’t a valid image.",
};
const friendly = (code: string) => FRIENDLY[code] ?? code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const msg = (e: unknown) => (e instanceof Error ? friendly(e.message) : "Something went wrong.");

type Rec = Record<string, unknown>;
/** turns MongoDB's "document failed validation" details into short readable lines */
function ruleIssues(d: unknown, path = "", out: string[] = []): string[] {
  if (Array.isArray(d)) { d.forEach((x) => ruleIssues(x, path, out)); return out; }
  if (!d || typeof d !== "object") return out;
  const o = d as Rec;
  const here = typeof o.propertyName === "string" ? (path ? `${path}.${o.propertyName}` : o.propertyName) : path;
  if (Array.isArray(o.missingProperties)) out.push(`${here || "document"}: missing ${(o.missingProperties as string[]).join(", ")}`);
  else if (typeof o.reason === "string") {
    const want = o.specifiedAs ? ` ${JSON.stringify(o.specifiedAs)}` : "";
    const got = "consideredValue" in o ? `, got ${JSON.stringify(o.consideredValue)}` : "";
    out.push(`${here || "document"}: ${String(o.operatorName ?? "rule")}${want} (${o.reason}${got})`);
  }
  for (const [k, v] of Object.entries(o)) if (k !== "specifiedAs" && k !== "consideredValue") ruleIssues(v, here, out);
  return out;
}

async function call<T = Rec>(fullPath: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
  if (init.body) headers["Content-Type"] = "application/json";
  const res = await authFetch(fullPath, { ...init, headers });
  const json = (await res.json().catch(() => ({}))) as Rec;
  if (res.status === 401 && !readAuth()) {
    window.location.assign("/login?next=/admin-dashboard"); // the session ended (for example the API restarted)
    throw new Error("not_logged_in");
  }
  if (!res.ok && json.rules) {
    const lines = ruleIssues(json.rules);
    if (lines.length) throw new Error(`The database rejected this record: ${[...new Set(lines)].slice(0, 6).join(" | ")}`);
  }
  if (!res.ok) {
    const issues = Array.isArray(json.issues)
      ? (json.issues as { path: string; message: string }[]).map((i) => `${i.path}: ${i.message}`).join("; ")
      : "";
    throw new Error(issues || String(json.error ?? json.message ?? `status_${res.status}`));
  }
  return json as T;
}
const api = <T = Rec,>(path: string, init: RequestInit = {}) => call<T>(`/api/admin${path}`, init);
const post = (path: string, body: Rec) => api(path, { method: "POST", body: JSON.stringify(body) });

/* ═════════════ small helpers ═════════════ */
const get = (o: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Rec)[k] : undefined), o);
const str = (o: unknown, path: string, d = "—"): string => {
  const v = get(o, path);
  return v == null || v === "" ? d : String(v);
};
const rid = (r: Rec) => String(r._id ?? r.id ?? "");
const sum = (o?: Record<string, number>) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const rwf = (n: unknown) => `RWF ${(Number(n) || 0).toLocaleString("en-US")}`;
const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const human = (s: string) => s.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
const fmtDate = (v: unknown) =>
  v ? new Date(String(v)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (v: unknown) =>
  v ? new Date(String(v)).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const ago = (v: unknown) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(String(v)).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const GOOD = new Set(["approved", "confirmed", "accepted", "active", "published", "succeeded", "completed", "verified"]);
const WARN = new Set(["pending", "requested", "pending_review", "draft", "countered", "reviewing", "open"]);
const BAD = new Set(["declined", "cancelled", "rejected", "failed", "terminated", "suspended", "deactivated", "no_show"]);
const tone = (s: string) => (GOOD.has(s) ? "good" : WARN.has(s) ? "warn" : BAD.has(s) ? "bad" : "mute");
const Badge = ({ s }: { s: string }) => <span className={`ad-badge ${tone(s)}`}>{human(s)}</span>;
const Cell = ({ main, sub }: { main: ReactNode; sub?: string }) => (
  <div className="ad-cell"><b>{main}</b>{sub ? <small>{sub}</small> : null}</div>
);
const who = (r: Rec) => (
  <Cell main={str(r, "requester.fullName", str(r, "guest.name"))} sub={str(r, "requester.phone", str(r, "guest.phone", ""))} />
);

function usePoll(fn: () => Promise<void> | void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    void ref.current();
    const t = setInterval(() => { if (!document.hidden) void ref.current(); }, ms);
    return () => clearInterval(t);
  }, [ms]);
}

/* ═════════════ shared UI context: toast, confirm dialog, details dialog ═════════════ */
type Ask = {
  title: string; message?: ReactNode; confirm: string; danger?: boolean;
  reason?: "optional" | "required"; run: (reason: string) => Promise<void>;
};
type Ctx = { toast: (m: string, bad?: boolean) => void; ask: (a: Ask) => void; detail: (title: string, path: string) => void };
const AdminCtx = createContext<Ctx>({ toast: () => undefined, ask: () => undefined, detail: () => undefined });

type Tools = Ctx & {
  reload: () => void;
  done: (m: string) => void;
  quick: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
};
type Col = { head: string; cell: (r: Rec) => ReactNode };
type Act = { label: string; icon: ReactNode; tone?: "ok" | "bad"; show?: (r: Rec) => boolean; run: (r: Rec) => void };

const viewAct = (t: Tools, title: (r: Rec) => string, path: (r: Rec) => string): Act => ({
  label: "View details", icon: <Eye size={14} />, run: (r) => t.detail(title(r), path(r)),
});
const deleteAct = (
  t: Tools, name: (r: Rec) => string, path: (r: Rec) => string,
  opts: { reason?: boolean; show?: (r: Rec) => boolean } = {},
): Act => ({
  label: "Delete", icon: <Trash2 size={14} />, tone: "bad", show: opts.show,
  run: (r) => t.ask({
    title: `Delete ${name(r)}?`,
    message: opts.reason ? "It will be hidden and anything still open on it is closed." : "This permanently removes the record and can’t be undone.",
    confirm: "Delete", danger: true, reason: opts.reason ? "optional" : undefined,
    run: async (reason) => {
      await api(path(r), { method: "DELETE", ...(opts.reason ? { body: JSON.stringify({ reason: reason || undefined }) } : {}) });
      t.done("Deleted");
    },
  }),
});

/* ═════════════ generic table with search, filter, paging, live refresh ═════════════ */
type TableProps = {
  path: string; cols: Col[]; actions: (t: Tools) => Act[]; empty: string;
  statuses?: string[]; searchable?: boolean; sort?: string; extra?: Record<string, string>; refresh?: number;
};
function ResourceTable({ path, cols, actions, empty, statuses, searchable = true, sort, extra, refresh }: TableProps) {
  const ctx = useContext(AdminCtx);
  const [rows, setRows] = useState<Rec[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [status, setStatus] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");
  const extraKey = JSON.stringify(extra ?? {});

  useEffect(() => {
    const t = setTimeout(() => { setQd(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [status, extraKey]);

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setState("loading");
    try {
      const p = new URLSearchParams({ page: String(page), limit: "10", ...(JSON.parse(extraKey) as Record<string, string>) });
      if (qd) p.set("q", qd);
      if (status) p.set("status", status);
      if (sort) p.set("sort", sort);
      const j = await api<{ data: Rec[]; pagination: { pages: number; total: number } }>(`${path}?${p}`);
      setRows(j.data);
      setPages(Math.max(1, j.pagination.pages));
      setTotal(j.pagination.total);
      setState("ready");
    } catch (e) {
      if (!silent) { setErr(msg(e)); setState("error"); }
    }
  }, [path, extraKey, page, qd, status, sort]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { void load(false); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) void loadRef.current(true); }, 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  useEffect(() => { if (refresh) void loadRef.current(true); }, [refresh]);

  const reload = useCallback(() => { void loadRef.current(true); }, []);
  const tools: Tools = useMemo(() => ({
    ...ctx,
    reload,
    done: (m: string) => { ctx.toast(m); reload(); },
    quick: async (fn: () => Promise<unknown>, ok: string) => {
      try { await fn(); ctx.toast(ok); reload(); } catch (e) { ctx.toast(msg(e), true); }
    },
  }), [ctx, reload]);
  const acts = actions(tools);

  return (
    <div>
      <div className="ad-toolbar">
        {searchable && (
          <label className="ad-search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search" />
          </label>
        )}
        {statuses && (
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="ad-select">
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{human(s)}</option>)}
          </select>
        )}
        <span className="ad-count">{state === "ready" ? `${total} total` : ""}</span>
        <button className="ad-btn ghost" onClick={() => void load(false)} aria-label="Refresh"><RefreshCw size={15} /> Refresh</button>
      </div>

      {state === "error" ? (
        <div className="ad-empty" role="alert"><p>{err}</p><button className="ad-btn" onClick={() => void load(false)}>Try again</button></div>
      ) : (
        <div className="ad-tw">
          <table className="ad-table">
            <thead><tr>{cols.map((c) => <th key={c.head}>{c.head}</th>)}<th>Actions</th></tr></thead>
            <tbody>
              {state === "loading"
                ? [0, 1, 2, 3].map((n) => (
                  <tr key={n} aria-hidden="true"><td colSpan={cols.length + 1}><div className="ad-skel" /></td></tr>
                ))
                : rows.length === 0
                  ? <tr><td colSpan={cols.length + 1} className="ad-none">{empty}</td></tr>
                  : rows.map((r) => (
                    <tr key={rid(r)}>
                      {cols.map((c) => <td key={c.head} data-label={c.head}>{c.cell(r)}</td>)}
                      <td data-label="Actions" className="ad-actions">
                        {acts.filter((a) => !a.show || a.show(r)).map((a) => (
                          <button key={a.label} className={`ad-act ${a.tone ?? ""}`} onClick={() => a.run(r)} title={a.label} aria-label={a.label}>
                            {a.icon}<span>{a.label}</span>
                          </button>
                        ))}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {state === "ready" && pages > 1 && (
        <div className="ad-pager">
          <button className="ad-btn ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={15} /> Prev</button>
          <span>Page {page} of {pages}</span>
          <button className="ad-btn ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight size={15} /></button>
        </div>
      )}
    </div>
  );
}

function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: string }[] }) {
  return (
    <div className="ad-tabs" role="tablist">
      {items.map((i) => (
        <button key={i.key} role="tab" aria-selected={value === i.key} className={value === i.key ? "on" : ""} onClick={() => onChange(i.key)}>{i.label}</button>
      ))}
    </div>
  );
}

/* ═════════════ SVG charts (no extra dependency, scale to any width) ═════════════ */
const COLORS = ["#1b7f56", "#f2b632", "#4f8fc0", "#e07a3f", "#8e6bbf", "#c0504d", "#0c3b2e"];
type Point = { label: string; value: number };
const nice = (max: number) => {
  if (max <= 4) return 4;
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : 10) * p * 4;
};
const polar = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;

function BarChart({ data, label }: { data: Point[]; label: string }) {
  const W = 420, H = 270, L = 36, R = 10, T = 16, B = 74;
  const iw = W - L - R, ih = H - T - B;
  const top = nice(Math.max(0, ...data.map((d) => d.value)));
  const bw = iw / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ad-svg" role="img" aria-label={label}>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = T + ih - (ih * i) / 4;
        return <g key={i}><line x1={L} x2={W - R} y1={y} y2={y} className="ad-gl" /><text x={L - 6} y={y + 3} textAnchor="end" className="ad-tick">{Math.round((top * i) / 4)}</text></g>;
      })}
      {data.map((d, i) => {
        const h = (d.value / top) * ih, w = bw * 0.62, x = L + i * bw + (bw - w) / 2, y = T + ih - h;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={w} height={h} rx={4} fill={COLORS[i % COLORS.length]} className="ad-bar" style={{ animationDelay: `${i * 70}ms` }} />
            <text x={x + w / 2} y={y - 5} textAnchor="middle" className="ad-val">{d.value}</text>
            <text transform={`translate(${x + w / 2 + 4},${T + ih + 14}) rotate(-38)`} textAnchor="end" className="ad-tick">{human(d.label)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ data, label }: { data: Point[]; label: string }) {
  const gid = useId().replace(/:/g, "");
  const W = 420, H = 250, L = 34, R = 16, T = 18, B = 34;
  const iw = W - L - R, ih = H - T - B;
  const top = nice(Math.max(0, ...data.map((d) => d.value)));
  const pts = data.map((d, i) => [L + (data.length > 1 ? (iw * i) / (data.length - 1) : iw / 2), T + ih - (d.value / top) * ih] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0]},${T + ih} L${pts[0][0]},${T + ih} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ad-svg" role="img" aria-label={label}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1b7f56" stopOpacity=".32" /><stop offset="1" stopColor="#1b7f56" stopOpacity="0" /></linearGradient></defs>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = T + ih - (ih * i) / 4;
        return <g key={i}><line x1={L} x2={W - R} y1={y} y2={y} className="ad-gl" /><text x={L - 6} y={y + 3} textAnchor="end" className="ad-tick">{Math.round((top * i) / 4)}</text></g>;
      })}
      <path d={area} fill={`url(#${gid})`} className="ad-area" />
      <path d={line} fill="none" stroke="#1b7f56" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="ad-line" />
      {pts.map((p, i) => (
        <g key={data[i].label} className="ad-fade" style={{ animationDelay: `${500 + i * 80}ms` }}>
          <circle cx={p[0]} cy={p[1]} r={4} fill="#fff" stroke="#1b7f56" strokeWidth={2} />
          <text x={p[0]} y={p[1] - 9} textAnchor="middle" className="ad-val">{data[i].value}</text>
          <text x={p[0]} y={T + ih + 18} textAnchor="middle" className="ad-tick">{data[i].label}</text>
        </g>
      ))}
    </svg>
  );
}

function RadarChart({ data, label }: { data: Point[]; label: string }) {
  const W = 380, H = 320, cx = W / 2, cy = H / 2 + 4, R = 100, n = data.length;
  const top = nice(Math.max(0, ...data.map((d) => d.value)));
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const ring = (k: number) => data.map((_, i) => polar(cx, cy, (R * k) / 4, ang(i)).join(",")).join(" ");
  const shape = data.map((d, i) => polar(cx, cy, (R * d.value) / top, ang(i)).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ad-svg" role="img" aria-label={label}>
      {[1, 2, 3, 4].map((k) => <polygon key={k} points={ring(k)} className="ad-ring" />)}
      {data.map((_, i) => { const p = polar(cx, cy, R, ang(i)); return <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} className="ad-gl" />; })}
      <polygon points={shape} fill="#1b7f56" fillOpacity={0.28} stroke="#1b7f56" strokeWidth={2.5} strokeLinejoin="round" className="ad-zoom" style={{ transformOrigin: `${cx}px ${cy}px` }} />
      {data.map((d, i) => {
        const dot = polar(cx, cy, (R * d.value) / top, ang(i));
        const lab = polar(cx, cy, R + 16, ang(i));
        const c = Math.cos(ang(i));
        return (
          <g key={d.label}>
            <circle cx={dot[0]} cy={dot[1]} r={4} fill="#1b7f56" />
            <text x={lab[0]} y={lab[1] + 4} textAnchor={c > 0.3 ? "start" : c < -0.3 ? "end" : "middle"} className="ad-tick">{human(d.label)} ({d.value})</text>
          </g>
        );
      })}
    </svg>
  );
}

function Legend({ items, fmt = String }: { items: (Point & { color: string })[]; fmt?: (n: number) => string }) {
  return (
    <ul className="ad-legend">
      {items.map((i) => <li key={i.label}><i style={{ background: i.color }} />{human(i.label)}<b>{fmt(i.value)}</b></li>)}
    </ul>
  );
}

function PieChart({ data, label }: { data: Point[]; label: string }) {
  const W = 260, c = W / 2, Ro = 100, Ri = 62;
  const total = data.reduce((a, d) => a + d.value, 0);
  const items = data.map((d, i) => ({ ...d, color: COLORS[i % COLORS.length] }));
  if (!total) return <div className="ad-empty small">No successful payments yet.</div>;
  let start = -Math.PI / 2;
  const arcs = items.filter((d) => d.value > 0).map((d) => {
    const a = (d.value / total) * 2 * Math.PI;
    const end = start + a;
    const [x1, y1] = polar(c, c, Ro, start), [x2, y2] = polar(c, c, Ro, end - 0.0001);
    const [x3, y3] = polar(c, c, Ri, end - 0.0001), [x4, y4] = polar(c, c, Ri, start);
    const big = a > Math.PI ? 1 : 0;
    const path = `M${x1},${y1} A${Ro},${Ro} 0 ${big} 1 ${x2},${y2} L${x3},${y3} A${Ri},${Ri} 0 ${big} 0 ${x4},${y4} Z`;
    start = end;
    return { d, path };
  });
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${W}`} className="ad-svg pie" role="img" aria-label={label}>
        {arcs.map(({ d, path }, i) => <path key={d.label} d={path} fill={items.find((x) => x.label === d.label)?.color} stroke="#fff" strokeWidth={2} className="ad-fade" style={{ animationDelay: `${i * 120}ms` }} />)}
        <text x={c} y={c - 2} textAnchor="middle" className="ad-big">{compact(total)}</text>
        <text x={c} y={c + 16} textAnchor="middle" className="ad-tick">RWF total</text>
      </svg>
      <Legend items={items} fmt={(n) => rwf(n)} />
    </div>
  );
}

function PolarChart({ data, label }: { data: Point[]; label: string }) {
  const W = 380, H = 320, cx = W / 2, cy = H / 2, R = 100, n = data.length;
  const top = Math.max(1, ...data.map((d) => d.value));
  const items = data.map((d, i) => ({ ...d, color: COLORS[i % COLORS.length] }));
  const step = (2 * Math.PI) / n;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="ad-svg" role="img" aria-label={label}>
        {[1, 2, 3, 4].map((k) => <circle key={k} cx={cx} cy={cy} r={(R * k) / 4} className="ad-ring" />)}
        {items.map((d, i) => {
          const a0 = -Math.PI / 2 + i * step, a1 = a0 + step;
          const r = R * Math.sqrt(d.value / top);
          const [x1, y1] = polar(cx, cy, r, a0), [x2, y2] = polar(cx, cy, r, a1);
          const mid = polar(cx, cy, R + 16, (a0 + a1) / 2);
          const cs = Math.cos((a0 + a1) / 2);
          return (
            <g key={d.label}>
              {d.value > 0 && <path d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2} Z`} fill={d.color} fillOpacity={0.82} stroke="#fff" strokeWidth={1.5} className="ad-zoom" style={{ transformOrigin: `${cx}px ${cy}px`, animationDelay: `${i * 90}ms` }} />}
              <text x={mid[0]} y={mid[1] + 4} textAnchor={cs > 0.3 ? "start" : cs < -0.3 ? "end" : "middle"} className="ad-tick">{human(d.label)} ({d.value})</text>
            </g>
          );
        })}
      </svg>
      <Legend items={items} />
    </div>
  );
}

/* ═════════════ Analytics (live) ═════════════ */
type Counts = Record<string, number>;
type Stats = {
  attention?: Counts;
  users?: { byRole?: Counts; byStatus?: Counts; new7d?: number };
  properties?: { byStatus?: Counts };
  offers?: { byStatus?: Counts };
  leases?: { byStatus?: Counts };
  payments?: { revenueByPurpose?: { purpose: string; totalRwf: number; count: number }[] };
};
type FeedItem = { type: string; id: string; title: string; status: string; at: string };
type SectionKey = "analytics" | "bookings" | "lease" | "offers" | "properties" | "users" | "revenue" | "agents";

const PROPERTY_ST = ["draft", "pending_review", "published", "rented", "sold", "archived", "rejected"];
const OFFER_ST = ["pending", "accepted", "declined", "countered", "withdrawn", "expired"];
const LEASE_ST = ["draft", "active", "ended", "terminated"];
const series = (keys: string[], c?: Counts): Point[] => keys.map((k) => ({ label: k, value: c?.[k] ?? 0 }));
const FEED_ICON: Record<string, ReactNode> = {
  user: <Users size={15} />, property: <Building2 size={15} />, rent_request: <FileText size={15} />,
  viewing: <CalendarCheck size={15} />, offer: <Tag size={15} />, payment: <Wallet size={15} />,
  provider_application: <Briefcase size={15} />,
};
const ATTENTION: { k: string; label: string; to: SectionKey }[] = [
  { k: "propertiesPendingReview", label: "listings to review", to: "properties" },
  { k: "viewingsRequested", label: "viewings requested", to: "bookings" },
  { k: "rentRequestsPending", label: "rent requests", to: "lease" },
  { k: "offersPending", label: "offers pending", to: "offers" },
  { k: "providerApplicationsPending", label: "agent applications", to: "agents" },
];

function ChartCard({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return <section className="ad-card"><header><h3>{title}</h3><small>{sub}</small></header>{children}</section>;
}

function Analytics({ go }: { go: (k: SectionKey) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [audit, setAudit] = useState<Rec[]>([]);
  const [bookings, setBookings] = useState<Rec[]>([]);
  const [updated, setUpdated] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"activity" | "admin">("activity");
  const [, setTick] = useState(0);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 5000); return () => clearInterval(t); }, []);

  usePoll(async () => {
    try {
      const [s, a, b, l] = await Promise.all([
        api<{ data: Stats }>("/stats"),
        api<{ data: FeedItem[] }>("/activity?limit=25"),
        api<{ data: Rec[] }>("/viewing-bookings?limit=100&sort=-createdAt"),
        api<{ data: Rec[] }>("/audit-logs?limit=15"),
      ]);
      setStats(s.data); setFeed(a.data); setBookings(b.data); setAudit(l.data);
      setUpdated(Date.now()); setOnline(true);
      const keys = a.data.map((i) => `${i.type}:${i.id}:${i.status}`);
      if (seen.current) {
        const known = seen.current;
        const added = keys.filter((k) => !known.has(k));
        if (added.length) { setFresh(new Set(added)); setTimeout(() => setFresh(new Set()), 6000); }
      }
      seen.current = new Set([...(seen.current ?? []), ...keys]);
    } catch { setOnline(false); }
  }, 6000);

  const perDay = useMemo<Point[]>(() => {
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); return d; });
    return days.map((d) => ({
      label: d.toLocaleDateString("en-GB", { weekday: "short" }),
      value: bookings.filter((b) => new Date(str(b, "createdAt", "")).toDateString() === d.toDateString()).length,
    }));
  }, [bookings]);

  const revenue = stats?.payments?.revenueByPurpose ?? [];
  const revenueTotal = revenue.reduce((a, r) => a + r.totalRwf, 0);
  const attention = ATTENTION.filter((a) => (stats?.attention?.[a.k] ?? 0) > 0);

  return (
    <div className="ad-stack">
      <div className="ad-live">
        <span className={`ad-dot ${online ? "" : "off"}`} />
        {online ? "Live" : "Reconnecting…"}
        <small>{updated ? `updated ${ago(updated)}` : "loading…"} · refreshes every 6s</small>
      </div>

      <div className="ad-kpis">
        <div className="ad-kpi"><span>Users</span><b>{sum(stats?.users?.byRole)}</b><small>+{stats?.users?.new7d ?? 0} this week</small></div>
        <div className="ad-kpi"><span>Properties</span><b>{sum(stats?.properties?.byStatus)}</b><small>{stats?.properties?.byStatus?.published ?? 0} published</small></div>
        <div className="ad-kpi"><span>Needs attention</span><b>{sum(stats?.attention)}</b><small>open items</small></div>
        <div className="ad-kpi"><span>Revenue</span><b>{compact(revenueTotal)}</b><small>RWF collected</small></div>
      </div>

      {attention.length > 0 && (
        <div className="ad-chips">
          {attention.map((a) => (
            <button key={a.k} className="ad-chip" onClick={() => go(a.to)}><b>{stats?.attention?.[a.k]}</b> {a.label}</button>
          ))}
        </div>
      )}

      <div className="ad-grid">
        <ChartCard title="Properties" sub="Listings by status"><BarChart data={series(PROPERTY_ST, stats?.properties?.byStatus)} label="Properties by status" /></ChartCard>
        <ChartCard title="Bookings" sub="Viewing requests per day, last 7 days"><LineChart data={perDay} label="Bookings per day" /></ChartCard>
        <ChartCard title="Offers" sub="Offers by status"><RadarChart data={series(OFFER_ST, stats?.offers?.byStatus)} label="Offers by status" /></ChartCard>
        <ChartCard title="Revenue" sub="Collected by purpose"><PieChart data={revenue.map((r) => ({ label: r.purpose, value: r.totalRwf }))} label="Revenue by purpose" /></ChartCard>
        <ChartCard title="Leases" sub="Leases by status"><PolarChart data={series(LEASE_ST, stats?.leases?.byStatus)} label="Leases by status" /></ChartCard>

        <section className="ad-card ad-feed">
          <header>
            <h3>Live activity</h3>
            <Tabs value={tab} onChange={setTab} items={[{ key: "activity", label: "Website" }, { key: "admin", label: "Admin actions" }]} />
          </header>
          {tab === "activity" ? (
            <ul>
              {feed.length === 0 && <li className="ad-none">No activity yet.</li>}
              {feed.map((i) => (
                <li key={`${i.type}:${i.id}:${i.status}`} className={fresh.has(`${i.type}:${i.id}:${i.status}`) ? "new" : ""}>
                  <span className="ico">{FEED_ICON[i.type] ?? <Activity size={15} />}</span>
                  <div><p>{i.title}</p><small><Badge s={i.status} /> {ago(i.at)}</small></div>
                </li>
              ))}
            </ul>
          ) : (
            <ul>
              {audit.length === 0 && <li className="ad-none">No admin actions recorded yet.</li>}
              {audit.map((a) => (
                <li key={rid(a)}>
                  <span className="ico"><Check size={15} /></span>
                  <div><p>{str(a, "summary")}</p><small>{str(a, "adminName")} · {ago(get(a, "createdAt"))}</small></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/* ═════════════ Bookings ═════════════ */
function Bookings() {
  return (
    <ResourceTable
      path="/viewing-bookings" sort="-createdAt" empty="No viewing bookings yet."
      statuses={["requested", "confirmed", "declined", "cancelled", "completed", "no_show"]}
      cols={[
        { head: "Ref", cell: (r) => <b>{str(r, "ref")}</b> },
        { head: "Property", cell: (r) => <Cell main={str(r, "property.title")} sub={str(r, "property.ref", "")} /> },
        { head: "Booked by", cell: who },
        { head: "Scheduled", cell: (r) => fmtDateTime(get(r, "scheduledAt")) },
        { head: "Visitors", cell: (r) => str(r, "visitors") },
        { head: "Status", cell: (r) => <Badge s={str(r, "status")} /> },
      ]}
      actions={(t) => [
        {
          label: "Approve", icon: <Check size={14} />, tone: "ok", show: (r) => str(r, "status") === "requested",
          run: (r) => void t.quick(() => post(`/viewing-bookings/${rid(r)}/decision`, { decision: "confirm" }), "Booking approved"),
        },
        {
          label: "Cancel", icon: <Ban size={14} />, tone: "bad", show: (r) => ["requested", "confirmed"].includes(str(r, "status")),
          run: (r) => t.ask({
            title: `Cancel booking ${str(r, "ref")}?`, message: "The person who booked is notified.",
            confirm: "Cancel booking", danger: true, reason: "optional",
            run: async (reason) => { await post(`/viewing-bookings/${rid(r)}/decision`, { decision: "cancel", reason: reason || undefined }); t.done("Booking cancelled"); },
          }),
        },
        viewAct(t, (r) => `Booking ${str(r, "ref")}`, (r) => `/viewing-bookings/${rid(r)}`),
        deleteAct(t, (r) => `booking ${str(r, "ref")}`, (r) => `/viewing-bookings/${rid(r)}`),
      ]}
    />
  );
}

/* ═════════════ Lease (leases + rent requests that create them) ═════════════ */
function Lease() {
  const [tab, setTab] = useState<"leases" | "requests">("leases");
  return (
    <div className="ad-stack">
      <Tabs value={tab} onChange={setTab} items={[{ key: "leases", label: "Leases" }, { key: "requests", label: "Rent requests" }]} />
      {tab === "leases" ? (
        <ResourceTable
          key="leases" path="/leases" sort="-createdAt" empty="No leases yet."
          statuses={["draft", "active", "ended", "terminated"]}
          cols={[
            { head: "Ref", cell: (r) => <b>{str(r, "ref")}</b> },
            { head: "Tenant", cell: (r) => <Cell main={str(r, "tenant.fullName")} sub={str(r, "tenant.phone", "")} /> },
            { head: "Landlord", cell: (r) => <Cell main={str(r, "landlord.fullName")} sub={str(r, "landlord.phone", "")} /> },
            { head: "Rent / month", cell: (r) => rwf(get(r, "monthlyRentRwf")) },
            { head: "Period", cell: (r) => `${fmtDate(get(r, "startDate"))} → ${fmtDate(get(r, "endDate"))}` },
            { head: "Status", cell: (r) => <Badge s={str(r, "status")} /> },
          ]}
          actions={(t) => [
            viewAct(t, (r) => `Lease ${str(r, "ref")}`, (r) => `/leases/${rid(r)}`),
            {
              label: "Terminate", icon: <Ban size={14} />, tone: "bad", show: (r) => ["draft", "active"].includes(str(r, "status")),
              run: (r) => t.ask({
                title: `Terminate lease ${str(r, "ref")}?`, message: "Both the tenant and the landlord are notified.",
                confirm: "Terminate lease", danger: true, reason: "required",
                run: async (reason) => { await post(`/leases/${rid(r)}/terminate`, { reason }); t.done("Lease terminated"); },
              }),
            },
            deleteAct(t, (r) => `lease ${str(r, "ref")}`, (r) => `/leases/${rid(r)}`, { show: (r) => str(r, "status") !== "active" }),
          ]}
        />
      ) : (
        <ResourceTable
          key="requests" path="/rent-requests" sort="-createdAt" empty="No rent requests yet."
          statuses={["pending", "approved", "declined", "cancelled", "expired"]}
          cols={[
            { head: "Ref", cell: (r) => <b>{str(r, "ref")}</b> },
            { head: "Property", cell: (r) => <Cell main={str(r, "property.title")} sub={str(r, "property.ref", "")} /> },
            { head: "Requested by", cell: who },
            { head: "Move-in", cell: (r) => <Cell main={fmtDate(get(r, "desiredMoveIn"))} sub={`${str(r, "leaseMonths")} months`} /> },
            { head: "Total due", cell: (r) => rwf(get(r, "pricing.totalDueRwf")) },
            { head: "Status", cell: (r) => <Badge s={str(r, "status")} /> },
          ]}
          actions={(t) => [
            {
              label: "Approve", icon: <Check size={14} />, tone: "ok", show: (r) => str(r, "status") === "pending",
              run: (r) => t.ask({
                title: `Approve ${str(r, "ref")}?`, message: "A draft lease is created and every other pending request for this property is declined.",
                confirm: "Approve",
                run: async () => { await post(`/rent-requests/${rid(r)}/decision`, { decision: "approve" }); t.done("Request approved, lease drafted"); },
              }),
            },
            {
              label: "Cancel", icon: <Ban size={14} />, tone: "bad", show: (r) => str(r, "status") === "pending",
              run: (r) => t.ask({
                title: `Cancel ${str(r, "ref")}?`, confirm: "Cancel request", danger: true, reason: "optional",
                run: async (reason) => { await post(`/rent-requests/${rid(r)}/decision`, { decision: "cancel", reason: reason || undefined }); t.done("Request cancelled"); },
              }),
            },
            viewAct(t, (r) => `Rent request ${str(r, "ref")}`, (r) => `/rent-requests/${rid(r)}`),
            deleteAct(t, (r) => `request ${str(r, "ref")}`, (r) => `/rent-requests/${rid(r)}`),
          ]}
        />
      )}
    </div>
  );
}

/* ═════════════ Offers ═════════════ */
function Offers() {
  return (
    <ResourceTable
      path="/offers" sort="-createdAt" empty="No offers yet."
      statuses={["pending", "accepted", "declined", "countered", "withdrawn", "expired"]}
      cols={[
        { head: "Ref", cell: (r) => <b>{str(r, "ref")}</b> },
        { head: "Property", cell: (r) => <Cell main={str(r, "property.title")} sub={str(r, "property.ref", "")} /> },
        { head: "Offered by", cell: who },
        { head: "Offer", cell: (r) => <Cell main={rwf(get(r, "offerRwf"))} sub={`asking ${rwf(get(r, "askingPriceRwf"))}`} /> },
        { head: "Payment", cell: (r) => human(str(r, "paymentMethod", "")) },
        { head: "Status", cell: (r) => <Badge s={str(r, "status")} /> },
      ]}
      actions={(t) => [
        {
          label: "Approve", icon: <Check size={14} />, tone: "ok", show: (r) => str(r, "status") === "pending",
          run: (r) => t.ask({
            title: `Accept offer ${str(r, "ref")}?`, message: "The property is marked as sold and all other pending offers on it are declined.",
            confirm: "Accept offer",
            run: async () => { await post(`/offers/${rid(r)}/decision`, { decision: "accept" }); t.done("Offer accepted"); },
          }),
        },
        {
          label: "Cancel", icon: <Ban size={14} />, tone: "bad", show: (r) => str(r, "status") === "pending",
          run: (r) => t.ask({
            title: `Decline offer ${str(r, "ref")}?`, confirm: "Decline offer", danger: true, reason: "optional",
            run: async (reason) => { await post(`/offers/${rid(r)}/decision`, { decision: "decline", reason: reason || undefined }); t.done("Offer declined"); },
          }),
        },
        viewAct(t, (r) => `Offer ${str(r, "ref")}`, (r) => `/offers/${rid(r)}`),
        deleteAct(t, (r) => `offer ${str(r, "ref")}`, (r) => `/offers/${rid(r)}`),
      ]}
    />
  );
}

/* ═════════════ Properties ═════════════ */
function PropertiesTable({ refresh }: { refresh: number }) {
  return (
    <ResourceTable
      refresh={refresh} path="/properties" sort="-createdAt" empty="No properties found."
      statuses={["draft", "pending_review", "published", "rented", "sold", "archived", "rejected"]}
      cols={[
        { head: "Property", cell: (r) => <Cell main={str(r, "title")} sub={`${str(r, "ref", "")} · ${str(r, "district", "")}`} /> },
        { head: "Owner", cell: (r) => <Cell main={str(r, "ownerName")} sub={human(str(r, "ownerRole", ""))} /> },
        { head: "Type", cell: (r) => <Cell main={human(str(r, "propertyType", ""))} sub={str(r, "mode") === "sale" ? "For sale" : "For rent"} /> },
        { head: "Price", cell: (r) => rwf(get(r, "priceRwf")) + (str(r, "mode") === "rent" ? " /mo" : "") },
        { head: "Status", cell: (r) => <Badge s={str(r, "status")} /> },
        { head: "Added", cell: (r) => fmtDate(get(r, "createdAt")) },
      ]}
      actions={(t) => [
        {
          label: "Approve", icon: <Check size={14} />, tone: "ok", show: (r) => ["pending_review", "rejected", "draft", "archived"].includes(str(r, "status")),
          run: (r) => void t.quick(() => post(`/properties/${rid(r)}/review`, { decision: "approve" }), "Listing published"),
        },
        {
          label: "Cancel", icon: <Ban size={14} />, tone: "bad", show: (r) => ["pending_review", "published"].includes(str(r, "status")),
          run: (r) => t.ask({
            title: `Reject ${str(r, "ref")}?`, message: "The owner is notified with your reason and the listing leaves the site.",
            confirm: "Reject listing", danger: true, reason: "optional",
            run: async (reason) => { await post(`/properties/${rid(r)}/review`, { decision: "reject", rejectionReason: reason || undefined }); t.done("Listing rejected"); },
          }),
        },
        viewAct(t, (r) => str(r, "title"), (r) => `/properties/${rid(r)}`),
        deleteAct(t, (r) => str(r, "ref"), (r) => `/properties/${rid(r)}`, { reason: true }),
      ]}
    />
  );
}

function Properties() {
  const [open, setOpen] = useState(false);
  const [rk, setRk] = useState(0);
  return (
    <div className="ad-stack">
      <div className="ad-pagehead">
        <p>Add a listing yourself or review the ones owners and agents submitted.</p>
        <button className="ad-btn" onClick={() => setOpen(true)}><Plus size={16} /> Add property</button>
      </div>
      <PropertiesTable refresh={rk} />
      {open && <PropertyForm onClose={() => setOpen(false)} onSaved={() => setRk((n) => n + 1)} />}
    </div>
  );
}

/* ═════════════ Users + Agents ═════════════ */
function UserTable({ fixedRole }: { fixedRole?: Role }) {
  const [role, setRole] = useState("");
  const extra: Record<string, string> = fixedRole ? { role: fixedRole } : role ? { role } : {};
  return (
    <div>
      {!fixedRole && (
        <div className="ad-toolbar" style={{ marginBottom: 8 }}>
          <select className="ad-select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role">
            <option value="">All roles</option>
            {["tenant", "landlord", "agent", "admin"].map((r) => <option key={r} value={r}>{human(r)}</option>)}
          </select>
        </div>
      )}
      <ResourceTable
        path="/users" sort="-createdAt" extra={extra} empty={fixedRole ? "No agents yet." : "No users found."}
        statuses={["active", "suspended", "deactivated"]}
        cols={[
          { head: "User", cell: (r) => <Cell main={str(r, "fullName")} sub={str(r, "email", "")} /> },
          { head: "Phone", cell: (r) => str(r, "phone") },
          { head: "Role", cell: (r) => <Badge s={str(r, "role")} /> },
          { head: "Status", cell: (r) => <Badge s={str(r, "status")} /> },
          { head: "Last login", cell: (r) => (get(r, "lastLoginAt") ? ago(get(r, "lastLoginAt")) : "Never") },
          { head: "Joined", cell: (r) => fmtDate(get(r, "createdAt")) },
        ]}
        actions={(t) => [
          {
            label: "Approve", icon: <Check size={14} />, tone: "ok", show: (r) => str(r, "status") !== "active",
            run: (r) => void t.quick(() => post(`/users/${rid(r)}/reactivate`, {}), "Account activated"),
          },
          {
            label: "Cancel", icon: <Ban size={14} />, tone: "bad", show: (r) => str(r, "status") === "active",
            run: (r) => t.ask({
              title: `Suspend ${str(r, "fullName")}?`, message: "They are logged out everywhere and can’t sign in until reactivated.",
              confirm: "Suspend", danger: true, reason: "optional",
              run: async (reason) => { await post(`/users/${rid(r)}/suspend`, { reason: reason || undefined }); t.done("Account suspended"); },
            }),
          },
          viewAct(t, (r) => str(r, "fullName"), (r) => `/users/${rid(r)}`),
          deleteAct(t, (r) => str(r, "fullName"), (r) => `/users/${rid(r)}`, { reason: true }),
        ]}
      />
    </div>
  );
}

function Agents() {
  const [tab, setTab] = useState<"agents" | "apps">("agents");
  return (
    <div className="ad-stack">
      <Tabs value={tab} onChange={setTab} items={[{ key: "agents", label: "Agents" }, { key: "apps", label: "Applications" }]} />
      {tab === "agents" ? <UserTable key="agents" fixedRole="agent" /> : (
        <ResourceTable
          key="apps" path="/provider-applications" sort="-createdAt" searchable={false} empty="No applications yet."
          statuses={["pending", "approved", "rejected"]}
          cols={[
            { head: "Applicant", cell: (r) => <Cell main={str(r, "user.fullName")} sub={str(r, "user.email", "")} /> },
            { head: "Display name", cell: (r) => str(r, "displayName") },
            { head: "Wants to be", cell: (r) => human(str(r, "requestedRole", "")) },
            { head: "Message", cell: (r) => <span className="ad-clip">{str(r, "message")}</span> },
            { head: "Status", cell: (r) => <Badge s={str(r, "status")} /> },
            { head: "Applied", cell: (r) => fmtDate(get(r, "createdAt")) },
          ]}
          actions={(t) => [
            {
              label: "Approve", icon: <Check size={14} />, tone: "ok", show: (r) => str(r, "status") === "pending",
              run: (r) => t.ask({
                title: `Approve ${str(r, "displayName")}?`, message: `Their account becomes a ${str(r, "requestedRole")} and they must log in again.`,
                confirm: "Approve", reason: "optional",
                run: async (note) => { await post(`/provider-applications/${rid(r)}/review`, { decision: "approve", note: note || undefined }); t.done("Application approved"); },
              }),
            },
            {
              label: "Cancel", icon: <Ban size={14} />, tone: "bad", show: (r) => str(r, "status") === "pending",
              run: (r) => t.ask({
                title: `Reject ${str(r, "displayName")}?`, confirm: "Reject", danger: true, reason: "optional",
                run: async (note) => { await post(`/provider-applications/${rid(r)}/review`, { decision: "reject", note: note || undefined }); t.done("Application rejected"); },
              }),
            },
            viewAct(t, (r) => str(r, "displayName"), (r) => `/provider-applications/${rid(r)}`),
          ]}
        />
      )}
    </div>
  );
}

/* ═════════════ Revenue ═════════════ */
function Revenue() {
  const [stats, setStats] = useState<Stats | null>(null);
  usePoll(async () => { try { setStats((await api<{ data: Stats }>("/stats")).data); } catch { /* keep last numbers */ } }, 10000);
  const rows = stats?.payments?.revenueByPurpose ?? [];
  const total = rows.reduce((a, r) => a + r.totalRwf, 0);
  const count = rows.reduce((a, r) => a + r.count, 0);
  return (
    <div className="ad-stack">
      <div className="ad-kpis">
        <div className="ad-kpi"><span>Total collected</span><b>{rwf(total)}</b><small>{count} successful payments</small></div>
        {rows.slice(0, 3).map((r) => <div className="ad-kpi" key={r.purpose}><span>{human(r.purpose)}</span><b>{rwf(r.totalRwf)}</b><small>{r.count} payments</small></div>)}
      </div>
      <div className="ad-grid one">
        <ChartCard title="Revenue split" sub="Collected by purpose"><PieChart data={rows.map((r) => ({ label: r.purpose, value: r.totalRwf }))} label="Revenue by purpose" /></ChartCard>
      </div>
      <ResourceTable
        path="/payments" sort="-createdAt" searchable={false} empty="No payments yet."
        statuses={["pending", "succeeded", "failed", "refunded"]}
        cols={[
          { head: "Payment", cell: (r) => <Cell main={human(str(r, "purpose", ""))} sub={`#${rid(r).slice(-6)}`} /> },
          { head: "Payer", cell: (r) => <Cell main={str(r, "payer.fullName")} sub={str(r, "payer.phone", "")} /> },
          { head: "Method", cell: (r) => human(str(r, "method", "")) },
          { head: "Amount", cell: (r) => <b>{rwf(get(r, "amountRwf"))}</b> },
          { head: "Status", cell: (r) => <Badge s={str(r, "status")} /> },
          { head: "Date", cell: (r) => fmtDateTime(get(r, "createdAt")) },
        ]}
        actions={(t) => [
          viewAct(t, (r) => `Payment #${rid(r).slice(-6)}`, (r) => `/payments/${rid(r)}`),
          {
            label: "Mark failed", icon: <Ban size={14} />, tone: "bad", show: (r) => str(r, "status") === "pending",
            run: (r) => t.ask({
              title: "Mark this payment as failed?", confirm: "Mark failed", danger: true, reason: "optional",
              run: async (reason) => { await post(`/payments/${rid(r)}/status`, { status: "failed", reason: reason || undefined }); t.done("Payment marked failed"); },
            }),
          },
          {
            label: "Refund", icon: <RefreshCw size={14} />, tone: "bad", show: (r) => str(r, "status") === "succeeded",
            run: (r) => t.ask({
              title: `Refund ${rwf(get(r, "amountRwf"))}?`,
              message: "This records the payment as refunded. It does not move money, so send the refund through the payment provider.",
              confirm: "Mark refunded", danger: true, reason: "optional",
              run: async (reason) => { await post(`/payments/${rid(r)}/status`, { status: "refunded", reason: reason || undefined }); t.done("Payment marked refunded"); },
            }),
          },
        ]}
      />
    </div>
  );
}

/* ═════════════ dialogs: one Modal (header · scrolling body · sticky footer) ═════════════ */
function Modal({ title, onClose, children, footer, size = "md", busy = false }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "md" | "wide" | "lg"; busy?: boolean;
}) {
  const id = useId();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [busy, onClose]);
  return (
    <div className="ad-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={`ad-modal ${size}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="ad-m-head">
          <h2 id={id}>{title}</h2>
          <button className="ad-icon" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="ad-m-body">{children}</div>
        {footer && <footer className="ad-m-foot">{footer}</footer>}
      </div>
    </div>
  );
}

function AskDialog({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const needs = ask.reason === "required" && !reason.trim();
  async function go() {
    setBusy(true); setErr("");
    try { await ask.run(reason.trim()); onClose(); } catch (e) { setErr(msg(e)); setBusy(false); }
  }
  return (
    <Modal
      title={ask.title} onClose={onClose} busy={busy}
      footer={<>
        <button className="ad-btn ghost" onClick={onClose} disabled={busy}>Back</button>
        <button className={`ad-btn ${ask.danger ? "danger" : ""}`} onClick={() => void go()} disabled={busy || needs}>
          {busy && <span className="ad-spin sm" />}{busy ? "Working…" : ask.confirm}
        </button>
      </>}
    >
      {ask.message && <p className="ad-m-text">{ask.message}</p>}
      {ask.reason && (
        <label className="ad-f">
          <span>Reason{ask.reason === "optional" ? " (optional)" : ""}</span>
          <textarea className="ad-in" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
        </label>
      )}
      {err && <p className="ad-err" role="alert">{err}</p>}
    </Modal>
  );
}

const HIDE = new Set(["gallery", "image", "coverUrl", "coverAlt", "description", "avatarUrl", "trackingToken", "passwordHash", "__v"]);
function flatten(o: unknown, prefix = "", out: [string, string][] = []) {
  for (const [k, v] of Object.entries((o ?? {}) as Rec)) {
    if (v == null || HIDE.has(k)) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) out.push([key, v.length && typeof v[0] !== "object" ? v.join(", ") : `${v.length} item(s)`]);
    else if (typeof v === "object") flatten(v, key, out);
    else if (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v)) out.push([key, new Date(v).toLocaleString("en-GB")]);
    else if (typeof v === "number" && /rwf/i.test(k)) out.push([key, rwf(v)]);
    else out.push([key, String(v)]);
  }
  return out;
}
const keyLabel = (k: string) => k.split(".").map(human).join(" › ");
type Group = { title: string; rows: [string, string][] };
function groupsOf(o: unknown): Group[] {
  const entries = Object.entries((o ?? {}) as Rec);
  const plain = Object.fromEntries(entries.filter(([, v]) => Array.isArray(v) || typeof v !== "object"));
  const out: Group[] = [{ title: "Overview", rows: flatten(plain) }];
  for (const [k, v] of entries) {
    if (v && typeof v === "object" && !Array.isArray(v) && !HIDE.has(k)) {
      const rows = flatten(v);
      if (rows.length) out.push({ title: human(k), rows });
    }
  }
  return out.filter((g) => g.rows.length);
}

function DetailDialog({ title, path, onClose }: { title: string; path: string; onClose: () => void }) {
  const [data, setData] = useState<Group[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let off = false;
    api<{ data: Rec }>(path).then((j) => { if (!off) setData(groupsOf(j.data)); }).catch((e) => { if (!off) setErr(msg(e)); });
    return () => { off = true; };
  }, [path]);
  return (
    <Modal title={title} size="wide" onClose={onClose} footer={<button className="ad-btn ghost" onClick={onClose}>Close</button>}>
      {err ? <p className="ad-err" role="alert">{err}</p> : !data ? (
        <><div className="ad-skel" /><div className="ad-skel" /><div className="ad-skel" /></>
      ) : data.map((g) => (
        <section className="ad-grp" key={g.title}>
          <h3>{g.title}</h3>
          <dl className="ad-dl">
            {g.rows.map(([k, v]) => (
              <div key={k}><dt>{keyLabel(k)}</dt><dd>{k === "status" || k.endsWith(".status") ? <Badge s={v} /> : v}</dd></div>
            ))}
          </dl>
        </section>
      ))}
    </Modal>
  );
}

/* ───── add property ───── */
type Loc = { _id: string; name: string; province: string };
type Form = {
  title: string; description: string; mode: "rent" | "sale"; propertyType: string; price: string; deposit: string; minLease: string;
  beds: string; baths: string; area: string; parking: string; furnishing: string; availableFrom: string;
  districtId: string; district: string; province: string; neighbourhood: string; address: string; lat: string; lng: string; publish: boolean;
};
type Photo = { id: string; file: File; preview: string; state: "ready" | "uploading" | "done" | "error"; url?: string; error?: string };
const PROPERTY_TYPES = ["house", "apartment", "villa", "townhouse", "studio", "land", "commercial"];
const MAX_PHOTOS = 20;
const slugify = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** shrink big phone photos before upload (max 1920px, JPEG); falls back to the original file */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const longest = Math.max(bmp.width, bmp.height);
    if (longest <= 1920 && file.size <= 2 * 1024 * 1024) { bmp.close(); return file; }
    const scale = Math.min(1, 1920 / longest);
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const g = c.getContext("2d");
    if (!g) { bmp.close(); return file; }
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
    return out && out.size < file.size ? out : file;
  } catch { return file; }
}
async function uploadPhoto(file: File): Promise<string> {
  const blob = await shrink(file);
  const res = await authFetch("/api/admin/uploads", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
  if (res.status === 404) {
    let build = "";
    try { build = String(((await (await fetch(`${API}/api`)).json()) as Rec).build ?? ""); } catch { /* API unreachable */ }
    throw new Error(
      build === "uploads-1"
        ? `The API at ${API} reports the new build but still answered 404 for /api/admin/uploads. Check for a proxy or a second server on that port.`
        : `The API at ${API} is an old version of Server.js (${build ? `build ${build}` : "no build marker"}) with no upload route. Stop every running API process, then start the updated Server.js.`,
    );
  }
  const j = (await res.json().catch(() => ({}))) as Rec;
  if (!res.ok) throw new Error(String(j.error ?? `status_${res.status}`));
  return String(j.url);
}
const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return <label className={`ad-f ${wide ? "wide" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function PropertyForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useContext(AdminCtx);
  const [locs, setLocs] = useState<Loc[]>([]);
  const [f, setF] = useState<Form>({
    title: "", description: "", mode: "rent", propertyType: "house", price: "", deposit: "2", minLease: "6",
    beds: "1", baths: "1", area: "", parking: "0", furnishing: "unfurnished", availableFrom: "",
    districtId: "", district: "", province: "", neighbourhood: "", address: "", lat: "", lng: "", publish: true,
  });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [coverId, setCoverId] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [err, setErr] = useState("");
  const [photoNote, setPhotoNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<Photo[]>([]);
  photosRef.current = photos;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const cover = photos.some((p) => p.id === coverId) ? coverId : photos[0]?.id ?? "";

  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);
  useEffect(() => {
    let off = false;
    fetch(`${API}/api/locations`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("locations"))))
      .then((j: { data?: Loc[] }) => { if (!off) setLocs(j.data ?? []); })
      .catch(() => undefined);
    return () => { off = true; };
  }, []);

  function addFiles(list: FileList | File[]) {
    const notes: string[] = [];
    const added: Photo[] = [];
    for (const file of Array.from(list)) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { notes.push(`${file.name}: only JPG, PNG or WebP`); continue; }
      if (file.size > 25 * 1024 * 1024) { notes.push(`${file.name}: larger than 25 MB`); continue; }
      if (photosRef.current.length + added.length >= MAX_PHOTOS) { notes.push(`You can add up to ${MAX_PHOTOS} photos`); break; }
      added.push({ id: Math.random().toString(36).slice(2), file, preview: URL.createObjectURL(file), state: "ready" });
    }
    setPhotoNote(notes.join(" · "));
    if (added.length) setPhotos((prev) => [...prev, ...added]);
  }
  function removePhoto(id: string) {
    const gone = photos.find((p) => p.id === id);
    if (gone) URL.revokeObjectURL(gone.preview);
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }
  const patchPhoto = (id: string, patch: Partial<Photo>) => setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  function problem(): string | null {
    if (f.title.trim().length < 10) return "The title needs at least 10 characters.";
    if (f.description.trim().length < 20) return "The description needs at least 20 characters.";
    const price = Number(f.price);
    if (!Number.isInteger(price) || price <= 0) return "Enter the price as a whole number of RWF.";
    if (f.mode === "rent") {
      const d = Number(f.deposit), m = Number(f.minLease);
      if (!Number.isInteger(d) || d < 0 || d > 12) return "Deposit must be 0 to 12 months.";
      if (!Number.isInteger(m) || m < 1 || m > 60) return "Minimum lease must be 1 to 60 months.";
    }
    if (!f.district.trim() || !f.province.trim()) return "Choose or enter the district and province.";
    if (f.lat.trim() || f.lng.trim()) {
      const la = Number(f.lat), lo = Number(f.lng);
      if (!f.lat.trim() || !f.lng.trim() || !Number.isFinite(la) || !Number.isFinite(lo)) return "Enter both latitude and longitude as numbers, or leave both empty.";
      if (la < -90 || la > 90 || lo < -180 || lo > 180) return "Latitude must be between -90 and 90, and longitude between -180 and 180.";
    }
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = problem();
    if (p) { setErr(p); return; }
    setBusy(true); setErr("");

    /* 1. upload the photos that aren't on the server yet (3 at a time) */
    const urlById = new Map<string, string>(photos.filter((x) => x.url).map((x) => [x.id, x.url as string]));
    const pending = photos.filter((x) => !x.url);
    let finished = 0, next = 0, failed = 0;
    const worker = async () => {
      while (next < pending.length) {
        const item = pending[next++];
        patchPhoto(item.id, { state: "uploading", error: undefined });
        try {
          const url = await uploadPhoto(item.file);
          urlById.set(item.id, url);
          patchPhoto(item.id, { state: "done", url });
        } catch (e2) { failed++; patchPhoto(item.id, { state: "error", error: msg(e2) }); }
        finished++;
        setStage(`Uploading photos ${finished}/${pending.length}…`);
      }
    };
    if (pending.length) {
      setStage(`Uploading photos 0/${pending.length}…`);
      await Promise.all([worker(), worker(), worker()]);
    }
    if (failed) { setErr(`${failed} photo${failed > 1 ? "s" : ""} failed to upload. Remove ${failed > 1 ? "them" : "it"} or press Save again to retry.`); setBusy(false); setStage(""); return; }

    /* 2. create the property — the chosen cover photo goes first */
    setStage("Saving property…");
    const ordered = [...photos.filter((x) => x.id === cover), ...photos.filter((x) => x.id !== cover)];
    const body = {
      title: f.title.trim(), description: f.description.trim(), mode: f.mode, propertyType: f.propertyType,
      priceRwf: Number(f.price),
      ...(f.mode === "rent" ? { depositMonths: Number(f.deposit), minLeaseMonths: Number(f.minLease) } : {}),
      bedrooms: Number(f.beds) || 0, bathrooms: Number(f.baths) || 0,
      ...(f.area ? { areaSqm: Number(f.area) } : {}),
      parkingSpaces: Number(f.parking) || 0, furnishing: f.furnishing,
      ...(f.availableFrom ? { availableFrom: f.availableFrom } : {}),
      location: {
        districtId: f.districtId || slugify(f.district), district: f.district.trim(), province: f.province.trim(),
        ...(f.neighbourhood.trim() ? { neighbourhood: f.neighbourhood.trim() } : {}),
        ...(f.address.trim() ? { addressLine: f.address.trim() } : {}),
        ...(f.lat.trim() && f.lng.trim() ? { point: { type: "Point", coordinates: [Number(f.lng), Number(f.lat)] } } : {}),
      },
      images: ordered.map((x, i) => ({ url: urlById.get(x.id) as string, sortOrder: i, kind: "photo" })),
    };
    try {
      const created = await call<{ data: { id: string } }>("/api/properties", { method: "POST", body: JSON.stringify(body) });
      if (f.publish && photos.length) {
        try { await post(`/properties/${created.data.id}/review`, { decision: "approve" }); toast("Property added and published"); }
        catch (e3) { toast(`Saved, but publishing failed: ${msg(e3)}`, true); }
      } else toast("Property saved and waiting for review");
      onSaved(); onClose();
    } catch (e4) { setErr(msg(e4)); setBusy(false); setStage(""); }
  }

  return (
    <Modal
      title="Add property" size="lg" onClose={onClose} busy={busy}
      footer={<>
        <button type="button" className="ad-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="ad-prop-form" className="ad-btn" disabled={busy}>{busy && <span className="ad-spin sm" />}{busy ? stage || "Saving…" : "Save property"}</button>
      </>}
    >
      <form id="ad-prop-form" className="ad-fgrid" onSubmit={(e) => void submit(e)} noValidate>
        <h4 className="ad-fh">Basics</h4>
        <Field label="Title" wide hint="At least 10 characters"><input className="ad-in" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={160} autoFocus /></Field>
        <Field label="Description" wide hint="At least 20 characters"><textarea className="ad-in" rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={5000} /></Field>
        <Field label="Listing type">
          <select className="ad-in" value={f.mode} onChange={(e) => set("mode", e.target.value as "rent" | "sale")}><option value="rent">For rent</option><option value="sale">For sale</option></select>
        </Field>
        <Field label="Property type">
          <select className="ad-in" value={f.propertyType} onChange={(e) => set("propertyType", e.target.value)}>{PROPERTY_TYPES.map((t) => <option key={t} value={t}>{human(t)}</option>)}</select>
        </Field>

        <h4 className="ad-fh">Price and size</h4>
        <Field label={f.mode === "rent" ? "Monthly rent (RWF)" : "Asking price (RWF)"}><input className="ad-in" type="number" inputMode="numeric" min={1} step={1} value={f.price} onChange={(e) => set("price", e.target.value)} /></Field>
        {f.mode === "rent" ? (
          <>
            <Field label="Deposit (months)"><input className="ad-in" type="number" min={0} max={12} step={1} value={f.deposit} onChange={(e) => set("deposit", e.target.value)} /></Field>
            <Field label="Minimum lease (months)"><input className="ad-in" type="number" min={1} max={60} step={1} value={f.minLease} onChange={(e) => set("minLease", e.target.value)} /></Field>
          </>
        ) : null}
        <Field label="Bedrooms"><input className="ad-in" type="number" min={0} max={30} value={f.beds} onChange={(e) => set("beds", e.target.value)} /></Field>
        <Field label="Bathrooms"><input className="ad-in" type="number" min={0} max={30} value={f.baths} onChange={(e) => set("baths", e.target.value)} /></Field>
        <Field label="Area (m²)"><input className="ad-in" type="number" min={1} value={f.area} onChange={(e) => set("area", e.target.value)} /></Field>
        <Field label="Parking spaces"><input className="ad-in" type="number" min={0} max={100} value={f.parking} onChange={(e) => set("parking", e.target.value)} /></Field>
        <Field label="Furnishing">
          <select className="ad-in" value={f.furnishing} onChange={(e) => set("furnishing", e.target.value)}><option value="unfurnished">Unfurnished</option><option value="semi_furnished">Semi-furnished</option><option value="furnished">Furnished</option></select>
        </Field>
        <Field label="Available from"><input className="ad-in" type="date" value={f.availableFrom} onChange={(e) => set("availableFrom", e.target.value)} /></Field>

        <h4 className="ad-fh">Location</h4>
        {locs.length ? (
          <Field label="District" wide>
            <select
              className="ad-in" value={f.districtId}
              onChange={(e) => { const l = locs.find((x) => x._id === e.target.value); setF((q) => ({ ...q, districtId: l?._id ?? "", district: l?.name ?? "", province: l?.province ?? "" })); }}
            >
              <option value="">Select a district…</option>
              {locs.map((l) => <option key={l._id} value={l._id}>{l.name} — {l.province}</option>)}
            </select>
          </Field>
        ) : (
          <>
            <Field label="District"><input className="ad-in" value={f.district} onChange={(e) => set("district", e.target.value)} /></Field>
            <Field label="Province"><input className="ad-in" value={f.province} onChange={(e) => set("province", e.target.value)} /></Field>
          </>
        )}
        <Field label="Neighbourhood"><input className="ad-in" value={f.neighbourhood} onChange={(e) => set("neighbourhood", e.target.value)} /></Field>
        <Field label="Street address"><input className="ad-in" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Latitude (optional)" hint="Example: -1.9441"><input className="ad-in" inputMode="decimal" value={f.lat} onChange={(e) => set("lat", e.target.value)} /></Field>
        <Field label="Longitude (optional)" hint="Example: 30.0619. In Google Maps, right-click the place to copy both numbers."><input className="ad-in" inputMode="decimal" value={f.lng} onChange={(e) => set("lng", e.target.value)} /></Field>

        <h4 className="ad-fh">Photos</h4>
        <div
          className={`ad-drop wide ${drag ? "over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) addFiles(e.dataTransfer.files); }}
        >
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          <span className="ad-drop-ico"><Upload size={22} /></span>
          <button type="button" className="ad-btn" onClick={() => fileRef.current?.click()} disabled={busy || photos.length >= MAX_PHOTOS}><Upload size={15} /> Upload photos</button>
          <small>or drag them here · JPG, PNG or WebP · up to {MAX_PHOTOS} photos · large photos are resized for you</small>
        </div>
        {photoNote && <p className="ad-err wide" role="alert">{photoNote}</p>}
        {photos.length > 0 && (
          <div className="wide">
            <p className="ad-thumbs-head">{photos.length} photo{photos.length > 1 ? "s" : ""} · pick the one shown first on the listing</p>
            <ul className="ad-thumbs">
              {photos.map((ph) => (
                <li key={ph.id} className={`ad-thumb ${ph.id === cover ? "cover" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ph.preview} alt={`Preview of ${ph.file.name}`} />
                  {ph.id === cover
                    ? <span className="ad-cvtag"><Star size={12} fill="currentColor" /> Cover photo</span>
                    : <button type="button" className="ad-cvbtn" onClick={() => setCoverId(ph.id)} disabled={busy}><Star size={12} /> Set as cover</button>}
                  <button type="button" className="ad-rm" aria-label={`Remove ${ph.file.name}`} onClick={() => removePhoto(ph.id)} disabled={busy}><X size={14} /></button>
                  <span className="ad-fname">{ph.file.name} · {fileSize(ph.file.size)}</span>
                  {ph.state === "uploading" && <span className="ad-ov"><span className="ad-spin sm" /> Uploading</span>}
                  {ph.state === "done" && <span className="ad-ok" title="Uploaded"><Check size={12} /></span>}
                  {ph.state === "error" && <span className="ad-ov bad" title={ph.error}>Failed · {ph.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <label className="ad-check wide">
          <input type="checkbox" checked={f.publish && photos.length > 0} disabled={photos.length === 0} onChange={(e) => set("publish", e.target.checked)} />
          <span>Publish right away{photos.length === 0 ? " (add at least one photo first)" : ""}</span>
        </label>
        {err && <p className="ad-err wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
}

/* ═════════════ shell: sidebar, top bar, auth gate ═════════════ */
const NAV: { key: SectionKey; label: string; icon: ReactNode }[] = [
  { key: "analytics", label: "Analytics", icon: <BarChart3 size={18} /> },
  { key: "bookings", label: "Bookings", icon: <CalendarCheck size={18} /> },
  { key: "lease", label: "Lease", icon: <FileText size={18} /> },
  { key: "offers", label: "Offers", icon: <Tag size={18} /> },
  { key: "properties", label: "Properties", icon: <Building2 size={18} /> },
  { key: "users", label: "Users", icon: <Users size={18} /> },
  { key: "revenue", label: "Revenue", icon: <Wallet size={18} /> },
  { key: "agents", label: "Agents", icon: <Briefcase size={18} /> },
];

export default function AdminDashboard() {
  const router = useRouter();
  const [gate, setGate] = useState<"checking" | "ok">("checking");
  const [me, setMe] = useState<AuthUser | null>(null);
  const [section, setSection] = useState<SectionKey>("analytics");
  const [navOpen, setNavOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ m: string; bad: boolean } | null>(null);
  const [dlg, setDlg] = useState<Ask | null>(null);
  const [det, setDet] = useState<{ title: string; path: string } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* only signed-in admins get in */
  useEffect(() => {
    let off = false;
    (async () => {
      const cur = readAuth();
      if (!cur) { router.replace("/login?next=/admin-dashboard"); return; }
      let user: AuthUser | null = cur.data.user;
      try {
        const r = await authFetch("/api/auth/me");
        if (r.ok) user = ((await r.json()) as { user: AuthUser }).user;
        else if (r.status === 401 || r.status === 403) user = null;
      } catch { /* API unreachable: keep the cached user */ }
      if (off) return;
      if (!user) { router.replace("/login?next=/admin-dashboard"); return; }
      if (user.role !== "admin") { router.replace("/"); return; }
      setMe(user);
      const hash = window.location.hash.slice(1);
      if (NAV.some((n) => n.key === hash)) setSection(hash as SectionKey);
      setGate("ok");
    })();
    return () => { off = true; };
  }, [router]);

  /* click ripple on every button */
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(".ad-btn,.ad-act,.ad-nav,.ad-chip,.ad-icon,.ad-tabs button");
      if (!el || (el as HTMLButtonElement).disabled) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2;
      const dot = document.createElement("span");
      dot.className = "ad-ripple";
      dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      el.appendChild(dot);
      setTimeout(() => dot.remove(), 650);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const toast = useCallback((m: string, bad = false) => {
    setToastMsg({ m, bad });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 4500);
  }, []);
  const ctx = useMemo<Ctx>(() => ({
    toast,
    ask: (a) => setDlg(a),
    detail: (title, path) => setDet({ title, path }),
  }), [toast]);

  const go = useCallback((k: SectionKey) => {
    setSection(k); setNavOpen(false);
    window.history.replaceState(null, "", `#${k}`);
    window.scrollTo({ top: 0 });
  }, []);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const cur = readAuth();
    clearAuth();
    try {
      if (cur) await fetch(`${API}/api/auth/logout`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: cur.data.tokens.refresh }),
      });
    } catch { /* the session is already cleared in this browser */ }
    router.replace("/login");
  }

  if (gate === "checking") {
    return (
      <main className="ad-boot" role="status" aria-busy="true">
        <style>{CSS}</style>
        <span className="ad-spin" /><p>Checking your access…</p>
      </main>
    );
  }

  const current = NAV.find((n) => n.key === section) ?? NAV[0];
  const initials = (me?.fullName ?? "A").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

  return (
    <AdminCtx.Provider value={ctx}>
      <div className="ad-root">
        <style>{CSS}</style>

        <aside className={`ad-side ${navOpen ? "open" : ""}`} aria-label="Admin navigation">
          <div className="ad-brand">
            <span className="ad-mark"><Home size={20} /></span>
            <span>urugo<em>link</em><small>ADMIN</small></span>
            <button className="ad-icon ad-close" onClick={() => setNavOpen(false)} aria-label="Close menu"><X size={18} /></button>
          </div>
          <nav>
            {NAV.map((n) => (
              <button key={n.key} className={`ad-nav ${section === n.key ? "on" : ""}`} onClick={() => go(n.key)} aria-current={section === n.key ? "page" : undefined}>
                {n.icon}<span>{n.label}</span>
              </button>
            ))}
          </nav>
          <div className="ad-side-foot">
            <div className="ad-me"><span className="ad-avatar">{initials}</span><div><b>{me?.fullName}</b><small>{me?.email}</small></div></div>
            <button className="ad-nav out" onClick={() => void logout()} disabled={loggingOut}><LogOut size={18} /><span>{loggingOut ? "Logging out…" : "Logout"}</span></button>
          </div>
        </aside>
        {navOpen && <div className="ad-backdrop" onClick={() => setNavOpen(false)} />}

        <div className="ad-main">
          <header className="ad-top">
            <button className="ad-icon ad-burger" onClick={() => setNavOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
            <h1 key={section} className="ad-title">{current.label}</h1>
            <Link className="ad-btn ghost ad-site" href="/?site=1">View website</Link>
          </header>
          <main className="ad-content">
            <div key={section} className="ad-page">
              {section === "analytics" && <Analytics go={go} />}
              {section === "bookings" && <Bookings />}
              {section === "lease" && <Lease />}
              {section === "offers" && <Offers />}
              {section === "properties" && <Properties />}
              {section === "users" && <UserTable />}
              {section === "revenue" && <Revenue />}
              {section === "agents" && <Agents />}
            </div>
          </main>
        </div>

        {dlg && <AskDialog ask={dlg} onClose={() => setDlg(null)} />}
        {det && <DetailDialog title={det.title} path={det.path} onClose={() => setDet(null)} />}
        {toastMsg && <div className={`ad-toast ${toastMsg.bad ? "bad" : ""}`} role="status">{toastMsg.m}<button onClick={() => setToastMsg(null)} aria-label="Dismiss"><X size={15} /></button></div>}
      </div>
    </AdminCtx.Provider>
  );
}

/* ═════════════ styles (scoped with the ad- prefix) ═════════════ */
const CSS = `
@keyframes ad-spin{to{transform:rotate(360deg)}}
@keyframes ad-pulse{0%{box-shadow:0 0 0 0 rgba(27,127,86,.55)}100%{box-shadow:0 0 0 10px rgba(27,127,86,0)}}
@keyframes ad-shim{0%{background-position:100% 0}100%{background-position:-100% 0}}
@keyframes ad-pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
@keyframes ad-flash{from{background:#fff4d3}to{background:transparent}}
.ad-root,.ad-boot{--g:#0c3b2e;--g2:#14604a;--gold:#f2b632;--bg:#f2f6f2;--card:#fff;--line:#e3e9e4;--tx:#14201b;--mut:#5a6a63;color:var(--tx)}
.ad-root *,.ad-boot *{box-sizing:border-box}
.ad-boot{min-height:100dvh;display:grid;place-content:center;justify-items:center;gap:14px;background:var(--bg)}
.ad-spin{width:34px;height:34px;border-radius:50%;border:3px solid #cfe0d6;border-top-color:var(--g2);animation:ad-spin .8s linear infinite}
.ad-root{display:flex;min-height:100dvh;background:var(--bg);overflow-x:hidden}
.ad-side{position:fixed;inset:0 auto 0 0;z-index:90;width:min(280px,84vw);display:flex;flex-direction:column;background:var(--g);color:#dbe8e0;transform:translateX(-100%);transition:transform .25s ease;overflow-y:auto}
.ad-side.open{transform:none;box-shadow:0 0 40px rgba(0,0,0,.35)}
.ad-backdrop{position:fixed;inset:0;z-index:80;background:rgba(7,30,23,.5)}
.ad-brand{display:flex;align-items:center;gap:10px;padding:20px 18px;font-size:1.25rem;font-weight:700;color:#fff;line-height:1.1}
.ad-brand em{font-style:normal;color:var(--gold)}
.ad-brand small{display:block;font-size:.62rem;letter-spacing:.18em;color:#9fb9ab;font-weight:600;margin-top:3px}
.ad-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:var(--gold);color:var(--g)}
.ad-close{margin-left:auto}
.ad-side nav{display:grid;gap:3px;padding:6px 12px}
.ad-nav{display:flex;align-items:center;gap:12px;width:100%;padding:11px 14px;border:0;border-radius:11px;background:none;color:inherit;font:inherit;font-weight:500;text-align:left;cursor:pointer;transition:background .15s}
.ad-nav:hover{background:rgba(255,255,255,.08)}
.ad-nav.on{background:var(--gold);color:var(--g);font-weight:700}
.ad-nav.out{color:#ffb4a6}
.ad-nav:disabled{opacity:.6;cursor:wait}
.ad-side-foot{margin-top:auto;padding:12px;border-top:1px solid rgba(255,255,255,.1);display:grid;gap:8px}
.ad-me{display:flex;align-items:center;gap:10px;padding:6px 8px;min-width:0}
.ad-me div{min-width:0;display:grid}
.ad-me b{font-size:.88rem;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ad-me small{font-size:.74rem;color:#9fb9ab;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ad-avatar{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.12);color:var(--gold);font-weight:700;font-size:.8rem}
.ad-main{flex:1;min-width:0;width:100%}
.ad-top{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:12px;height:64px;padding:0 16px;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.ad-top h1{margin:0;font-size:1.2rem;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ad-content{padding:16px;max-width:1500px;margin:0 auto}
@media(min-width:720px){.ad-top{padding:0 28px}.ad-content{padding:28px}}
@media(min-width:960px){
.ad-side{transform:none;width:252px}
.ad-main{margin-left:252px;width:calc(100% - 252px)}
.ad-burger,.ad-close,.ad-backdrop{display:none}
}
@media(max-width:420px){.ad-site{display:none}}
.ad-icon{display:inline-grid;place-items:center;width:38px;height:38px;border:0;border-radius:10px;background:none;color:inherit;cursor:pointer}
.ad-icon:hover{background:rgba(12,59,46,.08)}
.ad-side .ad-icon:hover{background:rgba(255,255,255,.1)}
.ad-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 16px;border:1px solid var(--g);border-radius:10px;background:var(--g);color:#fff;font:inherit;font-size:.88rem;font-weight:600;text-decoration:none;cursor:pointer;white-space:nowrap}
.ad-btn:hover{background:var(--g2)}
.ad-btn.ghost{background:#fff;color:var(--g);border-color:var(--line)}
.ad-btn.ghost:hover{background:#edf3ee}
.ad-btn.danger{background:#b3321f;border-color:#b3321f}
.ad-btn:disabled{opacity:.5;cursor:not-allowed}
.ad-stack{display:grid;gap:18px}
.ad-live{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-weight:700;color:var(--g2)}
.ad-live small{color:var(--mut);font-weight:500}
.ad-dot{width:10px;height:10px;border-radius:50%;background:#1b7f56;animation:ad-pulse 1.6s infinite}
.ad-dot.off{background:#c0504d;animation:none}
.ad-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:14px}
.ad-kpi{display:grid;gap:2px;padding:16px 18px;border:1px solid var(--line);border-radius:16px;background:var(--card)}
.ad-kpi span{font-size:.8rem;color:var(--mut);font-weight:600}
.ad-kpi b{font-size:1.55rem;overflow-wrap:anywhere}
.ad-kpi small{color:var(--mut);font-size:.78rem}
.ad-chips{display:flex;flex-wrap:wrap;gap:8px}
.ad-chip{padding:7px 14px;border:1px solid #f0d27c;border-radius:999px;background:#fff8e1;color:#6b4e00;font:inherit;font-size:.84rem;cursor:pointer}
.ad-chip:hover{background:#ffefb8}
.ad-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:16px}
.ad-grid.one{grid-template-columns:minmax(0,520px)}
@media(max-width:560px){.ad-grid.one{grid-template-columns:minmax(0,1fr)}}
.ad-card{min-width:0;padding:18px;border:1px solid var(--line);border-radius:18px;background:var(--card)}
.ad-card header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.ad-card h3{margin:0;font-size:1.02rem}
.ad-card header small{width:100%;color:var(--mut);margin-top:-6px}
.ad-card header:has(.ad-tabs) small{width:auto}
.ad-svg{display:block;width:100%;height:auto;max-height:340px}
.ad-svg.pie{max-width:260px;margin:0 auto}
.ad-gl{stroke:#e3e9e4;stroke-width:1}
.ad-ring{fill:none;stroke:#e3e9e4;stroke-width:1}
.ad-tick{font-size:10.5px;fill:#5a6a63}
.ad-val{font-size:11px;font-weight:700;fill:#14201b}
.ad-big{font-size:24px;font-weight:700;fill:#14201b}
.ad-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:10px 0 0;padding:0;list-style:none;font-size:.82rem}
.ad-legend li{display:flex;align-items:center;gap:6px}
.ad-legend i{width:10px;height:10px;border-radius:3px}
.ad-legend b{margin-left:2px}
.ad-feed ul{margin:0;padding:0;list-style:none;max-height:340px;overflow-y:auto;display:grid;gap:2px}
.ad-feed li{display:flex;gap:10px;padding:9px 6px;border-radius:10px;align-items:flex-start}
.ad-feed li.new{animation:ad-flash 6s ease-out}
.ad-feed .ico{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#eef6f1;color:var(--g2)}
.ad-feed li p{margin:0;font-size:.88rem;overflow-wrap:anywhere}
.ad-feed li small{color:var(--mut);display:flex;align-items:center;gap:6px;margin-top:3px}
.ad-tabs{display:inline-flex;gap:4px;padding:4px;border-radius:11px;background:#e8efe9;max-width:100%;overflow-x:auto}
.ad-tabs button{padding:7px 14px;border:0;border-radius:8px;background:none;font:inherit;font-size:.86rem;font-weight:600;color:var(--mut);cursor:pointer;white-space:nowrap}
.ad-tabs button.on{background:#fff;color:var(--g);box-shadow:0 1px 4px rgba(0,0,0,.1)}
.ad-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px}
.ad-search{display:flex;align-items:center;gap:8px;flex:1 1 220px;max-width:380px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--mut)}
.ad-search input{flex:1;min-width:0;font-size:.84rem;padding:9px 0;border:0;outline:0;background:none;font:inherit;color:var(--tx)}
.ad-search:focus-within{border-color:var(--g2)}
.ad-select{font-size:.84rem;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;font:inherit;color:var(--tx);max-width:100%}
.ad-count{margin-left:auto;color:var(--mut);font-size:.84rem}
.ad-tw{overflow-x:auto;border:1px solid var(--line);border-radius:16px;background:var(--card)}
.ad-table{width:100%;border-collapse:collapse;font-size:.78rem;line-height:1.35}
.ad-table th{padding:9px 12px;text-align:left;font-size:.65rem;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);background:#f7faf7;white-space:nowrap}
.ad-table td{padding:9px 12px;border-top:1px solid var(--line);vertical-align:middle}
.ad-table tbody tr:hover{background:#fafcfa}
.ad-cell{display:grid;gap:1px;min-width:0}
.ad-cell small{color:var(--mut);font-size:.68rem}
.ad-clip{display:inline-block;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}
.ad-none{padding:34px 14px!important;text-align:center;color:var(--mut)}
.ad-actions{display:flex;flex-wrap:wrap;gap:6px}
.ad-table td.ad-actions{display:table-cell}
.ad-table td.ad-actions .ad-act{margin:2px 4px 2px 0}
@media(min-width:761px) and (max-width:1279px){.ad-act span{display:none}.ad-act{padding:6px 7px}}
.ad-act{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--tx);font:inherit;font-size:.7rem;font-weight:600;cursor:pointer;white-space:nowrap}
.ad-act:hover{background:#edf3ee}
.ad-act.ok{color:#14604a;border-color:#bfe0cf;background:#f1faf5}
.ad-act.ok:hover{background:#dff3e7}
.ad-act.bad{color:#b3321f;border-color:#f0c9c2;background:#fff6f4}
.ad-act.bad:hover{background:#fde8e4}
.ad-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.66rem;font-weight:700;white-space:nowrap}
.ad-badge.good{background:#dff3e7;color:#14604a}
.ad-badge.warn{background:#fff1c7;color:#7a5700}
.ad-badge.bad{background:#fde3df;color:#a62d1b}
.ad-badge.mute{background:#e8eee9;color:#44544c}
.ad-skel{height:18px;margin:8px 0;border-radius:8px;background:linear-gradient(90deg,#e6ece7 30%,#f5f8f5 50%,#e6ece7 70%);background-size:300% 100%;animation:ad-shim 1.4s ease-in-out infinite}
.ad-empty{display:grid;justify-items:center;gap:10px;padding:30px;border:1px dashed var(--line);border-radius:16px;color:var(--mut);text-align:center}
.ad-empty.small{padding:60px 14px}
.ad-pager{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:14px;font-size:.88rem;color:var(--mut)}
@media(max-width:760px){
.ad-tw{border:0;background:none;overflow:visible;border-radius:0}
.ad-table,.ad-table tbody,.ad-table tr,.ad-table td{display:block;width:100%}
.ad-table thead{display:none}
.ad-table tr{margin-bottom:12px;padding:6px 4px;border:1px solid var(--line);border-radius:14px;background:var(--card)}
.ad-table tbody tr:hover{background:var(--card)}
.ad-table td{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:8px 12px;border:0;text-align:right}
.ad-table td::before{content:attr(data-label);flex:none;color:var(--mut);font-size:.76rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left}
.ad-table td .ad-cell{justify-items:end}
.ad-table td.ad-actions,.ad-table td.ad-actions.ad-actions{display:flex;flex-wrap:wrap;justify-content:flex-start;border-top:1px solid var(--line);margin-top:4px;padding-top:12px}
.ad-table td.ad-actions::before{display:none}
.ad-table td[colspan]{display:block;text-align:center}
.ad-table td[colspan]::before{display:none}
.ad-clip{max-width:60vw}
.ad-count{width:100%;margin:0}
.ad-search{max-width:none}
}
.ad-modal-bg{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:16px;background:rgba(7,30,23,.55);backdrop-filter:blur(4px)}
.ad-modal{display:flex;flex-direction:column;width:min(100%,460px);max-height:min(90dvh,840px);overflow:hidden;border-radius:20px;background:#fff;box-shadow:0 30px 70px -20px rgba(0,0,0,.5);animation:ad-pop .26s cubic-bezier(.2,1.1,.4,1)}
.ad-modal.wide{width:min(100%,620px)}
.ad-modal.lg{width:min(100%,720px)}
.ad-m-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px 14px 22px;border-bottom:1px solid var(--line)}
.ad-m-head h2{margin:0;font-size:1.02rem;overflow-wrap:anywhere}
.ad-m-body{flex:1;min-height:0;overflow-y:auto;padding:18px 22px}
.ad-m-foot{flex:none;display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px;padding:12px 22px;border-top:1px solid var(--line);background:#f8faf8}
.ad-m-text{margin:0 0 14px;color:var(--mut);line-height:1.55;font-size:.9rem}
.ad-grp{margin-bottom:16px}
.ad-grp:last-child{margin-bottom:0}
.ad-grp h3{margin:0 0 6px;font-size:.68rem;letter-spacing:.09em;text-transform:uppercase;color:var(--mut)}
.ad-pagehead{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.ad-pagehead p{margin:0;color:var(--mut);font-size:.88rem}
.ad-fgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 14px}
.ad-fgrid .wide{grid-column:1/-1}
.ad-fh{grid-column:1/-1;margin:8px 0 0;padding-bottom:6px;border-bottom:1px solid var(--line);font-size:.68rem;letter-spacing:.09em;text-transform:uppercase;color:var(--mut)}
.ad-fh:first-child{margin-top:0}
.ad-f small{color:var(--mut);font-size:.72rem}
.ad-in{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--tx);font:inherit;font-size:.86rem;transition:border-color .15s,box-shadow .15s}
.ad-in:focus{outline:0;border-color:var(--g2);box-shadow:0 0 0 3px rgba(27,127,86,.16)}
textarea.ad-in{resize:vertical}
.ad-check{display:flex;align-items:center;gap:8px;font-size:.86rem}
.ad-drop{display:grid;justify-items:center;gap:8px;padding:20px 14px;border:2px dashed #bcd2c4;border-radius:14px;background:#f6faf7;text-align:center;transition:border-color .2s,background .2s,transform .2s}
.ad-drop.over{border-color:var(--g2);background:#e7f4ec;transform:scale(1.01)}
.ad-drop small{color:var(--mut);font-size:.72rem}
.ad-drop-ico{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:#dff3e7;color:var(--g2)}
.ad-thumbs-head{margin:2px 0 8px;font-size:.78rem;color:var(--mut)}
.ad-thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:0;padding:0;list-style:none}
.ad-thumb{position:relative;aspect-ratio:4/3;overflow:hidden;border-radius:12px;border:2px solid transparent;background:#e6ece7;animation:ad-zoomin .3s cubic-bezier(.2,.9,.3,1) backwards;transition:border-color .2s,box-shadow .2s}
.ad-thumb.cover{border-color:var(--gold);box-shadow:0 0 0 3px rgba(242,182,50,.28)}
.ad-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.ad-cvtag,.ad-cvbtn{position:absolute;left:6px;top:6px;display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:0;border-radius:999px;font:inherit;font-size:.66rem;font-weight:700}
.ad-cvtag{background:var(--gold);color:var(--g)}
.ad-cvbtn{background:rgba(255,255,255,.92);color:var(--tx);cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.25);transition:transform .15s,background .15s}
.ad-cvbtn:hover:not(:disabled){background:#fff;transform:scale(1.05)}
.ad-rm{position:absolute;right:6px;top:6px;display:grid;place-items:center;width:24px;height:24px;border:0;border-radius:50%;background:rgba(20,32,27,.72);color:#fff;cursor:pointer;transition:background .15s,transform .15s}
.ad-rm:hover:not(:disabled){background:#b3321f;transform:scale(1.1)}
.ad-fname{position:absolute;left:0;right:0;bottom:0;padding:14px 8px 5px;background:linear-gradient(transparent,rgba(0,0,0,.65));color:#fff;font-size:.62rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ad-ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px;background:rgba(12,59,46,.62);color:#fff;font-size:.72rem;font-weight:700;text-align:center}
.ad-ov.bad{background:rgba(166,45,27,.82)}
.ad-ok{position:absolute;right:6px;bottom:20px;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#1b7f56;color:#fff}
.ad-check input{width:16px;height:16px;accent-color:var(--g2)}
@media(max-width:560px){
.ad-fgrid{grid-template-columns:1fr}
.ad-modal-bg{place-items:end center!important;padding:0!important}
.ad-modal,.ad-modal.wide,.ad-modal.lg{width:100%;max-height:92dvh;border-radius:20px 20px 0 0;animation:ad-sheet .3s cubic-bezier(.2,.9,.3,1)}
.ad-m-foot .ad-btn{flex:1}
}
.ad-f{display:grid;gap:5px;font-size:.8rem}
.ad-f span{font-weight:600}
.ad-field{display:grid;gap:6px;margin:8px 0}
.ad-field span{font-size:.82rem;font-weight:600}
.ad-field textarea{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font:inherit;resize:vertical}
.ad-field textarea:focus{outline:2px solid #bfe0cf;border-color:var(--g2)}
.ad-err{margin:10px 0 0;color:#b3321f;font-weight:600;font-size:.84rem}
.ad-dl{display:grid;gap:0;margin:0;padding:0 12px;border:1px solid var(--line);border-radius:12px}
.ad-dl div{display:grid;grid-template-columns:minmax(110px,36%) 1fr;gap:12px;padding:8px 0;border-top:1px solid var(--line)}
.ad-dl div:first-child{border-top:0}
.ad-dl dt{color:var(--mut);font-size:.74rem;font-weight:600}
.ad-dl dd{margin:0;font-size:.82rem;overflow-wrap:anywhere}
@media(max-width:480px){.ad-dl div{grid-template-columns:1fr;gap:2px}}
.ad-toast{position:fixed;left:0;right:0;margin-inline:auto;width:fit-content;bottom:20px;z-index:300;display:flex;align-items:center;gap:12px;max-width:min(92vw,520px);padding:12px 16px;border-radius:12px;background:var(--g);color:#fff;font-size:.9rem;box-shadow:0 14px 34px -10px rgba(0,0,0,.5);animation:ad-pop .2s ease-out}
.ad-toast.bad{background:#a62d1b}
.ad-toast button{border:0;background:none;color:inherit;cursor:pointer;display:grid}
.ad-spin.sm{width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,.4);border-top-color:#fff}
/* ── motion ── */
@keyframes ad-in{from{opacity:0;transform:translateY(14px)}}
@keyframes ad-fadein{from{opacity:0}}
@keyframes ad-row{from{opacity:0;transform:translateX(-10px)}}
@keyframes ad-slide{from{opacity:0;transform:translateX(-18px)}}
@keyframes ad-sheet{from{transform:translateY(100%)}}
@keyframes ad-modalbg{from{opacity:0}}
@keyframes ad-grow{from{transform:scaleY(0)}}
@keyframes ad-draw{from{stroke-dashoffset:1}}
@keyframes ad-zoomin{from{transform:scale(0);opacity:0}}
@keyframes ad-ripple{to{transform:scale(1);opacity:0}}
.ad-root{animation:ad-fadein .4s ease}
.ad-page{animation:ad-fadein .3s ease}
.ad-title{animation:ad-slide .35s cubic-bezier(.2,.8,.2,1)}
.ad-kpi,.ad-card,.ad-chips,.ad-live,.ad-toolbar,.ad-pagehead,.ad-tabs{animation:ad-in .5s cubic-bezier(.2,.8,.2,1) backwards}
.ad-kpi,.ad-card{transition:transform .2s ease,box-shadow .2s ease}
.ad-kpi:hover,.ad-card:hover{transform:translateY(-3px);box-shadow:0 14px 30px -18px rgba(12,59,46,.45)}
.ad-kpis .ad-kpi:nth-child(2),.ad-grid .ad-card:nth-child(2){animation-delay:.07s}
.ad-kpis .ad-kpi:nth-child(3),.ad-grid .ad-card:nth-child(3){animation-delay:.14s}
.ad-kpis .ad-kpi:nth-child(4),.ad-grid .ad-card:nth-child(4){animation-delay:.21s}
.ad-grid .ad-card:nth-child(5){animation-delay:.28s}
.ad-grid .ad-card:nth-child(6){animation-delay:.35s}
.ad-table tbody tr{animation:ad-row .35s ease backwards}
.ad-table tbody tr:nth-child(2){animation-delay:.04s}.ad-table tbody tr:nth-child(3){animation-delay:.08s}
.ad-table tbody tr:nth-child(4){animation-delay:.12s}.ad-table tbody tr:nth-child(5){animation-delay:.16s}
.ad-table tbody tr:nth-child(6){animation-delay:.2s}.ad-table tbody tr:nth-child(7){animation-delay:.24s}
.ad-table tbody tr:nth-child(8){animation-delay:.28s}.ad-table tbody tr:nth-child(9){animation-delay:.32s}
.ad-table tbody tr:nth-child(10){animation-delay:.36s}
.ad-side nav .ad-nav{animation:ad-slide .45s cubic-bezier(.2,.8,.2,1) backwards}
.ad-side nav .ad-nav:nth-child(2){animation-delay:.04s}.ad-side nav .ad-nav:nth-child(3){animation-delay:.08s}
.ad-side nav .ad-nav:nth-child(4){animation-delay:.12s}.ad-side nav .ad-nav:nth-child(5){animation-delay:.16s}
.ad-side nav .ad-nav:nth-child(6){animation-delay:.2s}.ad-side nav .ad-nav:nth-child(7){animation-delay:.24s}
.ad-side nav .ad-nav:nth-child(8){animation-delay:.28s}
.ad-nav:not(.out):hover{transform:translateX(4px)}
.ad-modal-bg{animation:ad-modalbg .2s ease}
.ad-feed li{transition:background .15s}
.ad-feed li:hover{background:#f4f8f5}
.ad-bar{transform-box:fill-box;transform-origin:50% 100%;animation:ad-grow .7s cubic-bezier(.2,.8,.2,1) backwards}
.ad-line{stroke-dasharray:1;stroke-dashoffset:0;animation:ad-draw 1.1s ease-out backwards}
.ad-area,.ad-fade{animation:ad-fadein .8s ease backwards}
.ad-zoom{transform-box:view-box;animation:ad-zoomin .8s cubic-bezier(.2,.8,.2,1) backwards}
.ad-btn,.ad-act,.ad-nav,.ad-chip,.ad-icon,.ad-tabs button{position:relative;overflow:hidden;transition:transform .15s ease,background .15s,box-shadow .2s,border-color .15s}
.ad-btn:not(:disabled):hover{box-shadow:0 8px 18px -8px rgba(12,59,46,.5);transform:translateY(-1px)}
.ad-act:hover,.ad-chip:hover{transform:translateY(-1px)}
.ad-btn:active,.ad-act:active,.ad-nav:active,.ad-chip:active,.ad-icon:active,.ad-tabs button:active{transform:scale(.94)}
.ad-ripple{position:absolute;border-radius:50%;pointer-events:none;background:currentColor;opacity:.28;transform:scale(0);animation:ad-ripple .6s ease-out forwards}
@media(prefers-reduced-motion:reduce){.ad-root *,.ad-root,.ad-boot *{animation:none!important;transition:none!important}}
`;