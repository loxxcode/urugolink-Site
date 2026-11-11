"use client";

import "./login.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
  type FormEvent, type KeyboardEvent, type ReactNode,
} from "react";
import {
  AlertCircle, ArrowLeft, ArrowRight, Briefcase, Building2, Check, CheckCircle2,
  Eye, EyeOff, Home, KeyRound, Loader2, Lock, Mail, MapPin, MessageCircle,
  Phone, Search, ShieldCheck, UserRound,
} from "lucide-react";
import { listings, formatPrice } from "./properties-data";

/* ───────────────────────── config & helpers ───────────────────────── */

const API = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const AUTH_KEY = "urugolink.auth";

type Tab = "login" | "register";
type Role = "tenant" | "landlord" | "agent";
type ApiUser = { id: string; email: string; phone: string; fullName: string; role: Role };
type AuthPayload = { user: ApiUser; tokens: { access: string; refresh: string; accessExpiresIn: string } };
type ApiResult =
  | { ok: true; data: AuthPayload }
  | { ok: false; status: number; error?: string; issues?: { path: string; message: string }[] };

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
const phoneOk = (v: string) => /^(?:\+?250|0)?7[2389]\d{7}$/.test(v.replace(/[\s-]/g, ""));

async function callAuth(path: "login" | "register", body: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(`${API}/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: json as AuthPayload };
    return { ok: false, status: res.status, error: json.error, issues: json.issues };
  } catch {
    return { ok: false, status: 0 };
  }
}

function persist(data: AuthPayload, remember: boolean) {
  try {
    localStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(AUTH_KEY);
    (remember ? localStorage : sessionStorage).setItem(AUTH_KEY, JSON.stringify(data));
  } catch { /* storage can be blocked; the user is still signed in for this visit */ }
}

/** Only allow same-site relative redirects. */
function safeNext(raw: string | null) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

function strength(pw: string) {
  const checks = {
    length: pw.length >= 8,
    mix: /[a-z]/i.test(pw) && /\d/.test(pw),
    extra: pw.length >= 12 || (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[^A-Za-z0-9]/.test(pw)),
  };
  const score = pw ? (checks.length ? 1 + Number(checks.mix) + Number(checks.extra) : 0) : 0;
  return { checks, score, label: ["Too short", "Weak", "Good", "Strong"][score] };
}

const ROLES: { id: Role; title: string; hint: string; icon: ReactNode }[] = [
  { id: "tenant", title: "Home seeker", hint: "Rent or buy a place", icon: <Search size={20} /> },
  { id: "landlord", title: "Property owner", hint: "List my property", icon: <KeyRound size={20} /> },
  { id: "agent", title: "Agent", hint: "Manage listings for owners", icon: <Briefcase size={20} /> },
];

const COPY: Record<Tab, { title: ReactNode; sub: string; heading: string; lead: string }> = {
  login: {
    title: <>Welcome back to <em>urugolink.</em></>,
    sub: "Log in to follow your viewing requests, offers and saved homes.",
    heading: "Pick up where you left off",
    lead: "Your saved homes and requests are right where you left them.",
  },
  register: {
    title: <>Make Rwanda feel a little more <em>like home.</em></>,
    sub: "Create a free account to save homes, request viewings and talk to owners.",
    heading: "Create your account",
    lead: "It takes about a minute. No payment needed.",
  },
};

/* ───────────────────────── small UI pieces ───────────────────────── */

function Field({
  label, error, hint, icon, children, optional,
}: { label: string; error?: string; hint?: string; icon?: ReactNode; children: ReactNode; optional?: boolean }) {
  return (
    <label className={`ul-field${error ? " has-error" : ""}`}>
      <span className="ul-label">{label}{optional && <i>optional</i>}</span>
      <span className="ul-control">
        {icon && <span className="ul-ico" aria-hidden="true">{icon}</span>}
        {children}
      </span>
      {hint && !error && <em className="ul-hint">{hint}</em>}
      {error && <small className="ul-err" role="alert"><AlertCircle size={14} /> {error}</small>}
    </label>
  );
}

function PasswordInput({
  value, onChange, autoComplete, placeholder, id,
}: { value: string; onChange: (v: string) => void; autoComplete: string; placeholder?: string; id?: string }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <>
      <input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        maxLength={72}
        onChange={(e) => onChange(e.target.value)}
        onKeyUp={(e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState("CapsLock"))}
        onBlur={() => setCaps(false)}
      />
      <button
        type="button"
        className="ul-eye"
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        onClick={() => setShow((s) => !s)}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
      {caps && <span className="ul-caps" role="status">Caps Lock is on</span>}
    </>
  );
}

/* ───────────────────────── visual panel ───────────────────────── */

function Visual({ tab }: { tab: Tab }) {
  const slides = useMemo(() => listings.slice(0, 4), []);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (slides.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => { if (!document.hidden) setI((n) => (n + 1) % slides.length); }, 5500);
    return () => clearInterval(t);
  }, [slides.length]);

  const cur = slides[i];
  const c = COPY[tab];

  return (
    <aside className="ul-visual" aria-label="Featured homes">
      {slides.map((p, n) => (
        <div key={p.id} className={`ul-slide${n === i ? " on" : ""}`} style={{ backgroundImage: `url("${p.image}")` }} aria-hidden="true" />
      ))}

      <div className="ul-v-top">
        <Link className="ul-brand" href="/" aria-label="UrugoLink home">
          <span className="ul-brand-mark"><Home size={20} /></span>
          <span>urugo<span className="ul-brand-light">link</span></span>
        </Link>
        <Link className="ul-back" href="/"><ArrowLeft size={16} /> <span>Back to homes</span></Link>
      </div>

      <div className="ul-v-mid">
        <h2 key={tab} className="ul-v-title">{c.title}</h2>
        <p className="ul-v-sub">{c.sub}</p>
        <ul className="ul-trust">
          <li><ShieldCheck size={16} /> Verified listings</li>
          <li><MessageCircle size={16} /> Direct owner contact</li>
          <li><MapPin size={16} /> Across Rwanda</li>
        </ul>
      </div>

      {cur && (
        <div className="ul-ticket" aria-live="off">
          <div className="ul-ticket-body" key={cur.id}>
            <small>{cur.mode === "Rent" ? "For rent" : "For sale"} · {cur.district}, {cur.province}</small>
            <b>{cur.title}</b>
            <span>{formatPrice(cur.price, cur.mode)}</span>
          </div>
          <div className="ul-dots" role="tablist" aria-label="Choose featured home">
            {slides.map((p, n) => (
              <button key={p.id} type="button" role="tab" aria-selected={n === i} aria-label={`Show ${p.title}`} className={n === i ? "on" : ""} onClick={() => setI(n)} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

/* ───────────────────────── forms ───────────────────────── */

type Errs = Record<string, string>;

function LoginForm({ onDone }: { onDone: (d: AuthPayload) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [errs, setErrs] = useState<Errs>({});
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v: Errs = {};
    if (!emailOk(email)) v.email = "Enter a valid email address.";
    if (!password) v.password = "Enter your password.";
    setErrs(v);
    setBanner("");
    if (Object.keys(v).length) return;

    setBusy(true);
    const r = await callAuth("login", { email: email.trim(), password });
    setBusy(false);
    if (r.ok) { persist(r.data, remember); onDone(r.data); return; }

    if (r.status === 401) setBanner("That email and password don't match. Check both and try again.");
    else if (r.status === 423) setBanner("Too many failed attempts. Your account is locked for 15 minutes.");
    else if (r.status === 403) setBanner("This account is not active. Contact UrugoLink support.");
    else if (r.status === 429) setBanner("Too many attempts. Wait a few minutes, then try again.");
    else if (r.status === 422) setErrs({ email: "Enter a valid email address." });
    else if (r.status === 0) setBanner(`Can't reach the server. Check your connection and that the API is running at ${API}.`);
    else setBanner("Something went wrong on our side. Try again in a moment.");
  }

  return (
    <form className="ul-form" onSubmit={submit} noValidate aria-describedby={banner ? "ul-login-banner" : undefined}>
      {banner && <div id="ul-login-banner" className="ul-banner" role="alert"><AlertCircle size={18} /> <span>{banner}</span></div>}

      <Field label="Email" error={errs.email} icon={<Mail size={18} />}>
        <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
          value={email} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
      </Field>

      <Field label="Password" error={errs.password} icon={<Lock size={18} />}>
        <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" placeholder="Your password" />
      </Field>

      <div className="ul-row">
        <label className="ul-check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span className="ul-box"><Check size={14} /></span>
          <span>Keep me logged in on this device</span>
        </label>
        <button type="button" className="ul-link" onClick={() => setForgot((f) => !f)} aria-expanded={forgot}>Forgot password?</button>
      </div>
      {forgot && <p className="ul-note" role="status">Password reset isn't available yet. Contact UrugoLink support and we'll help you get back in.</p>}

      <button className="ul-submit" type="submit" disabled={busy}>
        {busy ? <><Loader2 className="ul-spin" size={18} /> Logging in…</> : <>Log in <ArrowRight size={18} /></>}
      </button>
    </form>
  );
}

function RegisterForm({ onDone }: { onDone: (d: AuthPayload) => void }) {
  const [role, setRole] = useState<Role>("tenant");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errs, setErrs] = useState<Errs>({});
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);
  const s = strength(password);
  const roleId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v: Errs = {};
    if (fullName.trim().length < 2) v.fullName = "Enter your full name.";
    if (!phoneOk(phone)) v.phone = "Enter a valid Rwandan number, e.g. 078 123 4567.";
    if (!emailOk(email)) v.email = "Enter a valid email address.";
    if (password.length < 8) v.password = "Use at least 8 characters.";
    if (!agree) v.agree = "Accept the terms to create your account.";
    setErrs(v);
    setBanner("");
    if (Object.keys(v).length) return;

    setBusy(true);
    const r = await callAuth("register", {
      fullName: fullName.trim(), phone: phone.trim(), email: email.trim(), password, role, marketingOptIn: marketing,
    });
    setBusy(false);
    if (r.ok) { persist(r.data, true); onDone(r.data); return; }

    if (r.status === 409) {
      setErrs({ email: "An account with this email or phone number already exists." });
      setBanner("Already registered? Switch to Log in above.");
    } else if (r.status === 422 && r.issues?.length) {
      const m: Errs = {};
      const friendly: Record<string, string> = {
        email: "Enter a valid email address.",
        phone: "Enter a valid Rwandan number, e.g. 078 123 4567.",
        password: "Use between 8 and 72 characters.",
        fullName: "Enter your full name.",
      };
      r.issues.forEach((i) => { m[i.path] = friendly[i.path] ?? i.message; });
      setErrs(m);
    } else if (r.status === 429) setBanner("Too many attempts. Wait a few minutes, then try again.");
    else if (r.status === 0) setBanner(`Can't reach the server. Check your connection and that the API is running at ${API}.`);
    else setBanner("Something went wrong on our side. Try again in a moment.");
  }

  return (
    <form className="ul-form" onSubmit={submit} noValidate>
      {banner && <div className="ul-banner" role="alert"><AlertCircle size={18} /> <span>{banner}</span></div>}

      <fieldset className="ul-roles">
        <legend id={roleId}>I'm joining as</legend>
        <div role="radiogroup" aria-labelledby={roleId}>
          {ROLES.map((r) => (
            <label key={r.id} className={role === r.id ? "on" : ""}>
              <input type="radio" name="role" value={r.id} checked={role === r.id} onChange={() => setRole(r.id)} />
              <span className="ul-role-ico">{r.icon}</span>
              <b>{r.title}</b>
              <small>{r.hint}</small>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Full name" error={errs.fullName} icon={<UserRound size={18} />}>
        <input autoComplete="name" value={fullName} placeholder="Your full name" onChange={(e) => setFullName(e.target.value)} />
      </Field>

      <div className="ul-two">
        <Field label="Phone number" error={errs.phone} icon={<Phone size={18} />}>
          <input type="tel" inputMode="tel" autoComplete="tel" value={phone} placeholder="078 123 4567" onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Email" error={errs.email} icon={<Mail size={18} />}>
          <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>

      <Field label="Password" error={errs.password} icon={<Lock size={18} />}>
        <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 8 characters" />
      </Field>

      <div className="ul-meter" data-score={s.score} aria-live="polite">
        <div className="ul-bars" aria-hidden="true"><i /><i /><i /></div>
        <span>{password ? s.label : "Choose a password"}</span>
        <ul>
          <li className={s.checks.length ? "ok" : ""}><Check size={13} /> 8+ characters</li>
          <li className={s.checks.mix ? "ok" : ""}><Check size={13} /> Letters and numbers</li>
          <li className={s.checks.extra ? "ok" : ""}><Check size={13} /> 12+ chars or a symbol</li>
        </ul>
      </div>

      <label className={`ul-check${errs.agree ? " has-error" : ""}`}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span className="ul-box"><Check size={14} /></span>
        <span>I agree to the UrugoLink terms and privacy policy.</span>
      </label>
      {errs.agree && <small className="ul-err" role="alert"><AlertCircle size={14} /> {errs.agree}</small>}

      <label className="ul-check">
        <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
        <span className="ul-box"><Check size={14} /></span>
        <span>Send me new listings that match my searches.</span>
      </label>

      <button className="ul-submit" type="submit" disabled={busy}>
        {busy ? <><Loader2 className="ul-spin" size={18} /> Creating account…</> : <>Create account <ArrowRight size={18} /></>}
      </button>
    </form>
  );
}

function Success({ user, tab, nextPath }: { user: ApiUser; tab: Tab; nextPath: string }) {
  return (
    <div className="ul-success" role="status">
      <span className="ul-key"><KeyRound size={34} /></span>
      <h2>{tab === "register" ? "Your account is ready" : "You're in"}, {user.fullName.split(" ")[0]}.</h2>
      <p>{tab === "register" ? "Taking you to the homes we've lined up for you." : "Taking you back to your homes."}</p>
      <Link className="ul-submit" href={nextPath}>Continue now <ArrowRight size={18} /></Link>
      <span className="ul-ok-line"><CheckCircle2 size={16} /> Signed in as {user.email}</span>
    </div>
  );
}

/* ───────────────────────── page ───────────────────────── */

export default function Login() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("login");
  const [done, setDone] = useState<AuthPayload | null>(null);
  const [nextPath, setNextPath] = useState("/");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ login: null, register: null });

  /* read ?tab=register / #register and ?next=/path on first load */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("tab") === "register" || window.location.hash === "#register") setTab("register");
    setNextPath(safeNext(q.get("next")));
  }, []);

  const pick = useCallback((t: Tab, focus = false) => {
    setTab(t);
    try { window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${t}`); } catch { /* ignore */ }
    if (focus) tabRefs.current[t]?.focus();
  }, []);

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      pick(e.key === "ArrowRight" || e.key === "End" ? "register" : "login", true);
    }
  };

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => router.push(nextPath), 1800);
    return () => clearTimeout(t);
  }, [done, nextPath, router]);

  const c = COPY[tab];

  return (
    <main className="ul-auth" data-tab={tab}>
      <Visual tab={tab} />

      <section className="ul-main">
        <div className="ul-card">
          {done ? (
            <Success user={done.user} tab={tab} nextPath={nextPath} />
          ) : (
            <>
              <div className="ul-tabs" role="tablist" aria-label="Log in or create an account" onKeyDown={onTabKey}>
                <span className="ul-pill" aria-hidden="true" />
                {(["login", "register"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    ref={(el) => { tabRefs.current[t] = el; }}
                    id={`ul-tab-${t}`}
                    role="tab"
                    type="button"
                    aria-selected={tab === t}
                    aria-controls={`ul-panel-${t}`}
                    tabIndex={tab === t ? 0 : -1}
                    onClick={() => pick(t)}
                  >
                    {t === "login" ? "Log in" : "Create account"}
                  </button>
                ))}
              </div>

              <div key={tab} className="ul-panel" role="tabpanel" id={`ul-panel-${tab}`} aria-labelledby={`ul-tab-${tab}`}>
                <header className="ul-head">
                  <span className="ul-head-icon">{tab === "login" ? <KeyRound size={22} /> : <Building2 size={22} />}</span>
                  <div>
                    <h1>{c.heading}</h1>
                    <p>{c.lead}</p>
                  </div>
                </header>

                {tab === "login"
                  ? <LoginForm onDone={setDone} />
                  : <RegisterForm onDone={setDone} />}

                <p className="ul-switch">
                  {tab === "login" ? "New to UrugoLink?" : "Already have an account?"}{" "}
                  <button type="button" className="ul-link" onClick={() => pick(tab === "login" ? "register" : "login", true)}>
                    {tab === "login" ? "Create an account" : "Log in"}
                  </button>
                </p>
              </div>
            </>
          )}
        </div>
        <p className="ul-foot">© {new Date().getFullYear()} UrugoLink · Built for Rwanda <span aria-hidden="true">🇷🇼</span></p>
      </section>
    </main>
  );
}