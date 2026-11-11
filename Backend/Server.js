/**
 * UrugoLink API — Testing server uribeshya ukayica nukuntu yandaje nicaye turabipfa
 */

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const { nanoid } = require("nanoid");
const { z } = require("zod");
const pinoHttp = require("pino-http");
const path = require("path");
const fs = require("fs");

/* ─────────────── config ─────────────── */
const {
  MONGODB_URI = "mongodb://127.0.0.1:27017/urugoLink",
  JWT_SECRET: ENV_JWT_SECRET,
  JWT_REFRESH_SECRET: ENV_JWT_REFRESH_SECRET,
  PORT = 4000,
  NODE_ENV = "development",
  CORS_ORIGINS = "http://localhost:3000",
  RATE_LIMIT_WINDOW_MS = 60_000,
  RATE_LIMIT_MAX = 120,
} = process.env;

const missingSecrets = [
  !ENV_JWT_SECRET && "JWT_SECRET",
  !ENV_JWT_REFRESH_SECRET && "JWT_REFRESH_SECRET",
].filter(Boolean);

if (missingSecrets.length && NODE_ENV === "production") {
  console.error(`FATAL: ${missingSecrets.join(" and ")} required in production.`);
  process.exit(1);
}
if (missingSecrets.length) {
  console.warn(
    `[config] ${missingSecrets.join(", ")} not set - using temporary random secret(s). ` +
      `Add them to .env to persist sessions across restarts.`
  );
}
const JWT_SECRET = ENV_JWT_SECRET || require("crypto").randomBytes(48).toString("hex");
const JWT_REFRESH_SECRET = ENV_JWT_REFRESH_SECRET || require("crypto").randomBytes(48).toString("hex");

/* izi ni constants ntuzihindure */
const RW_PHONE = /^\+2507[2389]\d{7}$/;
const RW_PHONE_LOCAL = /^(?:\+?250|0)?7[2389]\d{7}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REF = (prefix) => `${prefix}-${nanoid(8).toUpperCase()}`;
const TRACKING_TOKEN = () => nanoid(24);
const ACCESS_TTL = "15m";
const REFRESH_TTL_DAYS = 30;
function normalizePhone(raw) {
  if (typeof raw !== "string") return "";
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("2507")) return `+${digits}`;
  if (digits.startsWith("07")) return `+250${digits.slice(1)}`;
  if (digits.startsWith("7")) return `+250${digits}`;
  return raw;
}

/* ─────────────── mongo models ─────────────── */
const { Schema, model, Types } = mongoose;
function ensureIndex(collection, keys, options) {
  return collection.createIndex(keys, options).catch((e) => {
    if (e && (e.code === 85 || e.code === 86)) {
      console.warn(`[db] index on ${collection.collectionName} already exists (${e.codeName}) - keeping existing`);
    } else {
      console.error(`[db] index error on ${collection.collectionName}:`, e.message);
    }
  });
}

const baseOpts = { timestamps: true, versionKey: false };

/** Counters for sequential ref numbers */
const Counter = model("Counter", new Schema({ _id: String, seq: { type: Number, default: 0 } }, baseOpts));

async function nextSeq(name) {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc.seq;
}

const User = model(
  "User",
  new Schema(
    {
      email: { type: String, required: true, lowercase: true, trim: true },
      phone: { type: String, required: true },
      passwordHash: { type: String, required: true },
      fullName: { type: String, required: true },
      role: { type: String, enum: ["tenant", "landlord", "agent", "admin"], default: "tenant" },
      status: { type: String, enum: ["active", "suspended", "deactivated"], default: "active" },
      avatarUrl: String,
      locale: { type: String, enum: ["en", "rw", "fr"], default: "en" },
      emailVerifiedAt: Date,
      phoneVerifiedAt: Date,
      lastLoginAt: Date,
      failedLoginCount: { type: Number, default: 0 },
      lockedUntil: Date,
      marketingOptIn: Boolean,
      providerProfile: {
        agencyId: Types.ObjectId,
        displayName: String,
        bio: String,
        publicPhone: String,
        whatsappPhone: String,
        licenseNumber: String,
        // no default: a default would create an empty providerProfile on every user, which the DB validator rejects
        verificationStatus: { type: String, enum: ["unverified", "pending", "verified", "rejected"] },
        verifiedAt: Date,
        verifiedBy: Types.ObjectId,
        avgResponseMinutes: Number,
      },
      deletedAt: Date,
    },
    baseOpts
  )
);
ensureIndex(User.collection, { email: 1 }, { unique: true });
ensureIndex(User.collection, { phone: 1 }, { unique: true });

const AuthSession = model(
  "AuthSession",
  new Schema(
    {
      userId: { type: Types.ObjectId, required: true, index: true },
      refreshTokenHash: { type: String, required: true, unique: true },
      userAgent: String,
      ip: String,
      lastUsedAt: Date,
      expiresAt: { type: Date, required: true },
      revokedAt: Date,
    },
    { timestamps: { createdAt: true, updatedAt: false } }
  )
);
ensureIndex(AuthSession.collection, { expiresAt: 1 }, { expireAfterSeconds: 0 });

const Property = model(
  "Property",
  new Schema(
    {
      ref: { type: String, required: true, unique: true },
      refNumber: { type: Number, required: true },
      slug: { type: String, required: true, unique: true },
      ownerId: { type: Types.ObjectId, required: true },
      ownerRole: { type: String, enum: ["landlord", "agent", "admin"], default: "landlord" },
      ownerName: String,
      agentId: Types.ObjectId,
      agencyId: Types.ObjectId,
      title: { type: String, required: true },
      description: String,
      mode: { type: String, enum: ["rent", "sale"], required: true },
      propertyType: {
        type: String,
        enum: ["house", "apartment", "villa", "townhouse", "studio", "land", "commercial"],
        required: true,
      },
      status: {
        type: String,
        enum: ["draft", "pending_review", "published", "rented", "sold", "archived", "rejected"],
        default: "draft",
      },
      priceRwf: { type: Number, required: true },
      depositMonths: Number,
      minLeaseMonths: Number,
      bedrooms: { type: Number, default: 0 },
      bathrooms: { type: Number, default: 0 },
      areaSqm: Number,
      plotSqm: Number,
      yearBuilt: Number,
      parkingSpaces: { type: Number, default: 0 },
      furnishing: { type: String, enum: ["furnished", "semi_furnished", "unfurnished"], default: "unfurnished" },
      availableFrom: Date,
      location: {
        districtId: String,
        district: String,
        province: String,
        neighbourhood: String,
        addressLine: String,
        // no defaults: a default would store an empty point ({coordinates: []}), which the database validator rejects
        point: { type: { type: String, enum: ["Point"] }, coordinates: { type: [Number], default: undefined } },
        hideExactLocation: Boolean,
      },
      amenities: [{ slug: String, label: String, icon: String }],
      nearby: [{ label: String, travelMinutes: Number, travelMode: { type: String, enum: ["walk", "drive"] } }],
      images: [
        {
          _id: { type: Types.ObjectId, default: () => new Types.ObjectId() },
          kind: { type: String, enum: ["photo", "floor_plan"], default: "photo" },
          storageKey: String,
          url: String,
          thumbUrl: String,
          cardUrl: String,
          width: Number,
          height: Number,
          sizeBytes: Number,
          mimeType: String,
          caption: String,
          altText: String,
          room: String,
          sortOrder: { type: Number, default: 0 },
          uploadedBy: Types.ObjectId,
          createdAt: { type: Date, default: Date.now },
        },
      ],
      coverImageId: Types.ObjectId,
      coverSetBy: Types.ObjectId,
      coverSetAt: Date,
      coverAuto: { type: Boolean, default: true },
      isFeatured: { type: Boolean, default: false },
      featuredUntil: Date,
      isVerified: { type: Boolean, default: false },
      verifiedAt: Date,
      verifiedBy: Types.ObjectId,
      customTag: String,
      reviewedBy: Types.ObjectId,
      reviewedAt: Date,
      rejectionReason: String,
      publishedAt: Date,
      expiresAt: Date,
      stats: {
        saves: { type: Number, default: 0 },
        viewsTotal: { type: Number, default: 0 },
        viewingRequests: { type: Number, default: 0 },
        rentRequests: { type: Number, default: 0 },
        offers: { type: Number, default: 0 },
      },
      deletedAt: Date,
    },
    baseOpts
  )
);
ensureIndex(Property.collection, { mode: 1, "location.districtId": 1, priceRwf: 1 }, { partialFilterExpression: { status: "published" } });
ensureIndex(Property.collection, { ownerId: 1, status: 1 });
ensureIndex(Property.collection, { agentId: 1, status: 1 });
ensureIndex(Property.collection, { status: 1, createdAt: -1 });
ensureIndex(Property.collection, { "location.point": "2dsphere" });
ensureIndex(Property.collection, 
  { title: "text", description: "text", "location.district": "text", "location.neighbourhood": "text" },
  { weights: { title: 5, "location.district": 3, "location.neighbourhood": 3, description: 1 }, default_language: "none" }
);

const RentRequest = model(
  "RentRequest",
  new Schema(
    {
      ref: { type: String, required: true, unique: true },
      propertyId: { type: Types.ObjectId, required: true },
      property: {
        title: String,
        slug: String,
        ref: String,
        mode: String,
        ownerId: Types.ObjectId,
        agentId: Types.ObjectId,
        coverUrl: String,
      },
      userId: Types.ObjectId,
      guest: { name: String, phone: String, email: String },
      trackingToken: { type: String, required: true },
      message: String,
      handledBy: Types.ObjectId,
      linkedAt: Date,
      desiredMoveIn: { type: Date, required: true },
      leaseMonths: { type: Number, required: true },
      occupants: { type: Number, required: true },
      occupation: String,
      pricing: {
        monthlyRentRwf: Number,
        depositRwf: Number,
        platformFeeRwf: Number,
        totalDueRwf: Number,
      },
      status: { type: String, enum: ["pending", "approved", "declined", "cancelled", "expired"], default: "pending" },
      decidedAt: Date,
      declineReason: String,
      expiresAt: Date,
      cancelledAt: Date,
    },
    baseOpts
  )
);
ensureIndex(RentRequest.collection, { propertyId: 1, status: 1 });
ensureIndex(RentRequest.collection, { userId: 1, createdAt: -1 }, { partialFilterExpression: { userId: { $exists: true } } });
ensureIndex(RentRequest.collection, { "guest.phone": 1 }, { partialFilterExpression: { "guest.phone": { $exists: true } } });
ensureIndex(RentRequest.collection, 
  { propertyId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: "pending", userId: { $exists: true } } }
);
ensureIndex(RentRequest.collection, 
  { propertyId: 1, "guest.phone": 1 },
  { unique: true, partialFilterExpression: { status: "pending", "guest.phone": { $exists: true } } }
);

const Offer = model(
  "Offer",
  new Schema(
    {
      ref: { type: String, required: true, unique: true },
      propertyId: { type: Types.ObjectId, required: true },
      property: {
        title: String,
        slug: String,
        ref: String,
        mode: String,
        ownerId: Types.ObjectId,
        agentId: Types.ObjectId,
        coverUrl: String,
      },
      userId: Types.ObjectId,
      guest: { name: String, phone: String, email: String },
      trackingToken: { type: String, required: true },
      message: String,
      handledBy: Types.ObjectId,
      linkedAt: Date,
      offerRwf: { type: Number, required: true },
      askingPriceRwf: { type: Number, required: true },
      paymentMethod: { type: String, enum: ["bank_transfer", "mortgage", "instalments"], required: true },
      status: {
        type: String,
        enum: ["pending", "accepted", "declined", "countered", "withdrawn", "expired"],
        default: "pending",
      },
      counterOfferRwf: Number,
      decidedAt: Date,
      declineReason: String,
      expiresAt: Date,
    },
    baseOpts
  )
);
ensureIndex(Offer.collection, { propertyId: 1, status: 1 });
ensureIndex(Offer.collection, { userId: 1, createdAt: -1 }, { partialFilterExpression: { userId: { $exists: true } } });
ensureIndex(Offer.collection, { "guest.phone": 1 }, { partialFilterExpression: { "guest.phone": { $exists: true } } });
ensureIndex(Offer.collection, { "property.ownerId": 1, status: 1 });

const ViewingBooking = model(
  "ViewingBooking",
  new Schema(
    {
      ref: { type: String, required: true, unique: true },
      propertyId: { type: Types.ObjectId, required: true },
      property: {
        title: String,
        slug: String,
        ref: String,
        mode: String,
        ownerId: Types.ObjectId,
        agentId: Types.ObjectId,
        coverUrl: String,
      },
      userId: Types.ObjectId,
      guest: { name: String, phone: String, email: String },
      trackingToken: { type: String, required: true },
      message: String,
      handledBy: Types.ObjectId,
      linkedAt: Date,
      scheduledAt: { type: Date, required: true },
      durationMinutes: { type: Number, default: 30 },
      visitors: { type: Number, default: 1 },
      status: {
        type: String,
        enum: ["requested", "confirmed", "declined", "cancelled", "completed", "no_show"],
        default: "requested",
      },
      respondedAt: Date,
      declineReason: String,
      cancelledBy: Types.ObjectId,
      cancelledAt: Date,
      completedAt: Date,
    },
    baseOpts
  )
);
ensureIndex(ViewingBooking.collection, { propertyId: 1, scheduledAt: 1 });
ensureIndex(ViewingBooking.collection, 
  { propertyId: 1, scheduledAt: 1 },
  { unique: true, partialFilterExpression: { status: "confirmed" } }
);
ensureIndex(ViewingBooking.collection, 
  { propertyId: 1, userId: 1, scheduledAt: 1 },
  { unique: true, partialFilterExpression: { status: "requested", userId: { $exists: true } } }
);

const Lease = model(
  "Lease",
  new Schema(
    {
      ref: { type: String, required: true, unique: true },
      rentRequestId: { type: Types.ObjectId },
      propertyId: { type: Types.ObjectId, required: true },
      tenantId: { type: Types.ObjectId, required: true },
      landlordId: { type: Types.ObjectId, required: true },
      startDate: Date,
      endDate: Date,
      monthlyRentRwf: Number,
      depositRwf: Number,
      paymentDay: Number,
      status: { type: String, enum: ["draft", "active", "ended", "terminated"], default: "draft" },
      documentUrl: String,
      signedByTenantAt: Date,
      signedByLandlordAt: Date,
      terminatedReason: String,
      installments: [
        {
          dueDate: Date,
          amountRwf: Number,
          status: { type: String, enum: ["upcoming", "due", "paid", "overdue", "waived"] },
          paymentId: Types.ObjectId,
          paidAt: Date,
        },
      ],
    },
    baseOpts
  )
);
ensureIndex(Lease.collection, { propertyId: 1 }, { unique: true, name: "ux_one_active_lease", partialFilterExpression: { status: "active" } });

const Payment = model(
  "Payment",
  new Schema(
    {
      payerId: { type: Types.ObjectId, required: true },
      rentRequestId: Types.ObjectId,
      leaseId: Types.ObjectId,
      offerId: Types.ObjectId,
      purpose: {
        type: String,
        enum: ["security_deposit", "rent", "platform_fee", "sale_deposit"],
        required: true,
      },
      amountRwf: { type: Number, required: true },
      currency: { type: String, enum: ["RWF"], default: "RWF" },
      method: { type: String, enum: ["mtn_momo", "airtel_money", "card", "bank_transfer", "cash"], required: true },
      status: { type: String, enum: ["pending", "succeeded", "failed", "refunded"], default: "pending" },
      provider: String,
      providerReference: String,
      payerPhone: String,
      failureReason: String,
      paidAt: Date,
      refundedAt: Date,
      metadata: Object,
    },
    baseOpts
  )
);
ensureIndex(Payment.collection, 
  { provider: 1, providerReference: 1 },
  { unique: true, partialFilterExpression: { providerReference: { $exists: true } } }
);

const SavedProperty = model(
  "SavedProperty",
  new Schema(
    { userId: Types.ObjectId, propertyId: Types.ObjectId, createdAt: { type: Date, default: Date.now } },
    { versionKey: false }
  )
);
ensureIndex(SavedProperty.collection, { userId: 1, propertyId: 1 }, { unique: true });

const PropertyView = model(
  "PropertyView",
  new Schema({
    propertyId: Types.ObjectId,
    userId: Types.ObjectId,
    sessionKey: String,
    referrer: String,
    viewedAt: { type: Date, default: Date.now },
  })
);
ensureIndex(PropertyView.collection, { viewedAt: 1 }, { expireAfterSeconds: 34560000 });

const PropertyReport = model(
  "PropertyReport",
  new Schema(
    {
      propertyId: Types.ObjectId,
      reporterId: Types.ObjectId,
      reason: String,
      details: String,
      status: { type: String, enum: ["open", "reviewing", "resolved", "dismissed"], default: "open" },
      resolvedBy: Types.ObjectId,
      resolvedAt: Date,
    },
    baseOpts
  )
);

const Location = model(
  "Location",
  new Schema(
    {
      _id: String,
      name: String,
      province: String,
      neighbourhoods: [{ name: String, lat: Number, lon: Number }],
    },
    { versionKey: false }
  )
);

const Agency = model(
  "Agency",
  new Schema(
    {
      name: String,
      slug: { type: String, unique: true },
      logoUrl: String,
      description: String,
      phone: String,
      email: String,
      website: String,
      districtId: String,
      verifiedAt: Date,
    },
    baseOpts
  )
);

const ProviderApplication = model(
  "ProviderApplication",
  new Schema(
    {
      userId: Types.ObjectId,
      requestedRole: { type: String, enum: ["landlord", "agent"] },
      displayName: String,
      message: String,
      status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
      reviewedBy: Types.ObjectId,
      reviewedAt: Date,
      reviewNote: String,
    },
    baseOpts
  )
);

const Notification = model(
  "Notification",
  new Schema(
    {
      userId: Types.ObjectId,
      type: { type: String, enum: ["viewing", "rent_request", "offer", "lease", "payment", "message", "listing", "system"] },
      title: String,
      body: String,
      data: Object,
      readAt: Date,
    },
    { timestamps: { createdAt: true, updatedAt: false } }
  )
);
ensureIndex(Notification.collection, { createdAt: 1 }, { expireAfterSeconds: 15552000 });

const AuthToken = model(
  "AuthToken",
  new Schema(
    {
      userId: Types.ObjectId,
      purpose: { type: String, enum: ["verify_email", "verify_phone", "reset_password"] },
      tokenHash: { type: String, unique: true },
      expiresAt: Date,
      usedAt: Date,
    },
    { timestamps: { createdAt: true, updatedAt: false } }
  )
);
ensureIndex(AuthToken.collection, { expiresAt: 1 }, { expireAfterSeconds: 0 });
function signAccess(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}
function signRefresh(user) {
  return jwt.sign({ sub: String(user._id), typ: "refresh" }, JWT_REFRESH_SECRET, { expiresIn: `${REFRESH_TTL_DAYS}d` });
}
function hashRefresh(token) {
  return require("crypto").createHash("sha256").update(token).digest("hex");
}

async function issueTokens(user, req) {
  const access = signAccess(user);
  const refresh = signRefresh(user);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 864e5);
  await AuthSession.create({
    userId: user._id,
    refreshTokenHash: hashRefresh(refresh),
    userAgent: (req.headers["user-agent"] || "").slice(0, 300),
    ip: req.ip,
    expiresAt,
    lastUsedAt: new Date(),
  });
  return { access, refresh, accessExpiresIn: ACCESS_TTL };
}
async function optionalAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer ")) return next();
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    const user = await User.findById(payload.sub).lean();
    if (user && user.status === "active") req.user = user;
  } catch (_) {
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "authentication_required" });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "authentication_required" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}
const zodError = (zErr) => zErr.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
const validate = (schema) => (req, res, next) => {
  const r = schema.safeParse(req.body);
  if (!r.success) return res.status(422).json({ error: "validation_failed", issues: zodError(r.error) });
  req.body = r.data;
  next();
};

const contactSchema = z.object({
  name: z.string().trim().min(2, "min 2 chars").max(120),
  phone: z.string().trim().refine((v) => RW_PHONE_LOCAL.test(v.replace(/[\s-]/g, "")), "invalid Rwandan phone"),
  email: z.string().trim().email().optional().or(z.literal("")),
});
function normalizeContact(c) {
  return { ...c, phone: normalizePhone(c.phone), email: c.email || undefined };
}
async function notify(userId, type, title, body, data = {}) {
  if (!userId) return;
  try {
    await Notification.create({ userId, type, title, body, data });
  } catch (e) {
    console.warn("[notify] could not save notification", type, e.message);
  }
}
const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || CORS_ORIGINS.split(",").map((s) => s.trim()).includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
/* uploaded property photos. Mounted before the rate limiter so a page full of images never hits the API limit. */
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOAD_DIR, {
  maxAge: "30d", immutable: true, index: false, dotfiles: "deny",
  setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
}));
app.use(rateLimit({ windowMs: Number(RATE_LIMIT_WINDOW_MS), max: Number(RATE_LIMIT_MAX), standardHeaders: true }));
app.use(pinoHttp({ level: NODE_ENV === "production" ? "info" : "debug" }));
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, standardHeaders: true });
app.get("/health", async (_req, res) => {
  const ok = mongoose.connection.readyState === 1;
  res.status(ok ? 200 : 503).json({ ok, db: ok ? "up" : "down", uptime: process.uptime(), version: "1.0.0" });
});

app.get("/api", (_req, res) => res.json({ name: "UrugoLink API", version: "1.0.0", build: "uploads-1", uploads: true }));
const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().refine((v) => RW_PHONE_LOCAL.test(v.replace(/[\s-]/g, "")), "invalid Rwandan phone"),
  password: z.string().min(8).max(72),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(["tenant", "landlord", "agent"]).default("tenant"),
  locale: z.enum(["en", "rw", "fr"]).default("en"),
  marketingOptIn: z.boolean().optional(),
});

app.post("/api/auth/register", authLimiter, validate(registerSchema), async (req, res, next) => {
  try {
    const { email, phone, password, fullName, role, locale, marketingOptIn } = req.body;
    const normalized = normalizePhone(phone);
    if (await User.exists({ $or: [{ email }, { phone: normalized }] })) {
      return res.status(409).json({ error: "already_exists", message: "Email or phone already registered." });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email,
      phone: normalized,
      passwordHash,
      fullName,
      role,
      locale,
      marketingOptIn: !!marketingOptIn,
    });
    const tokens = await issueTokens(user, req);
    res.status(201).json({ user: safeUser(user), tokens });
  } catch (e) {
    next(e);
  }
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
});

app.post("/api/auth/login", authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: "invalid_credentials" });
    if (user.lockedUntil && user.lockedUntil > new Date()) return res.status(423).json({ error: "locked" });
    if (user.status !== "active") return res.status(403).json({ error: "account_" + user.status });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const failed = (user.failedLoginCount || 0) + 1;
      const update = { failedLoginCount: failed };
      if (failed >= 10) update.lockedUntil = new Date(Date.now() + 15 * 60_000);
      await User.updateOne({ _id: user._id }, { $set: update });
      return res.status(401).json({ error: "invalid_credentials" });
    }
    user.failedLoginCount = 0;
    user.lastLoginAt = new Date();
    user.lockedUntil = undefined;
    await user.save();
    const tokens = await issueTokens(user, req);
    res.json({ user: safeUser(user), tokens });
  } catch (e) {
    next(e);
  }
});

app.post("/api/auth/refresh", authLimiter, async (req, res, next) => {
  try {
    const { refresh } = req.body || {};
    if (!refresh) return res.status(422).json({ error: "refresh_required" });
    let payload;
    try {
      payload = jwt.verify(refresh, JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ error: "invalid_refresh" });
    }
    const hash = hashRefresh(refresh);
    const session = await AuthSession.findOne({ refreshTokenHash: hash, revokedAt: null });
    if (!session || session.expiresAt < new Date()) return res.status(401).json({ error: "session_expired" });
    const user = await User.findById(payload.sub);
    if (!user || user.status !== "active") return res.status(401).json({ error: "user_unavailable" });
    // rotate
    session.revokedAt = new Date();
    await session.save();
    const tokens = await issueTokens(user, req);
    res.json({ user: safeUser(user), tokens });
  } catch (e) {
    next(e);
  }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const { refresh } = req.body || {};
    if (refresh) await AuthSession.updateOne({ refreshTokenHash: hashRefresh(refresh) }, { $set: { revokedAt: new Date() } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.get("/api/auth/me", optionalAuth, requireAuth, (req, res) => res.json({ user: safeUser(req.user) }));

function safeUser(u) {
  return {
    id: String(u._id),
    email: u.email,
    phone: u.phone,
    fullName: u.fullName,
    role: u.role,
    status: u.status,
    locale: u.locale,
    avatarUrl: u.avatarUrl,
    providerProfile: u.providerProfile,
    createdAt: u.createdAt,
  };
}

app.get("/api/locations", async (req, res, next) => {
  try {
    const { province } = req.query;
    const q = province ? { province } : {};
    const rows = await Location.find(q).sort({ name: 1 }).lean();
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});
app.get("/api/properties", optionalAuth, async (req, res, next) => {
  try {
    const {
      mode = "rent",
      q = "",
      district,
      type,
      minPrice,
      maxPrice,
      page = 1,
      limit = 12,
      sort = "-publishedAt",
      featured,
    } = req.query;

    const filter = { status: "published", deletedAt: { $exists: false } };
    if (mode === "rent" || mode === "sale") filter.mode = mode;
    if (district) filter["location.district"] = district;
    if (type) filter.propertyType = type;
    if (featured === "true") filter.isFeatured = true;
    if (minPrice || maxPrice) {
      filter.priceRwf = {};
      if (minPrice) filter.priceRwf.$gte = Number(minPrice);
      if (maxPrice) filter.priceRwf.$lte = Number(maxPrice);
    }
    if (q) filter.$text = { $search: q };

    const skip = (Math.max(1, Number(page)) - 1) * Math.min(50, Math.max(1, Number(limit)));
    const lim = Math.min(50, Math.max(1, Number(limit)));

    const [items, total] = await Promise.all([
      Property.find(filter).sort(sort).skip(skip).limit(lim).lean(),
      Property.countDocuments(filter),
    ]);

    res.json({
      data: items.map(publicCard),
      pagination: { page: Number(page), limit: lim, total, pages: Math.ceil(total / lim) },
    });
  } catch (e) {
    next(e);
  }
});
app.get("/api/properties/:key", optionalAuth, async (req, res, next) => {
  try {
    const { key } = req.params;
    const or = [{ slug: key }, { ref: key }];
    if (Types.ObjectId.isValid(key)) or.push({ _id: key });
    const prop = await Property.findOne({ $or: or, deletedAt: { $exists: false } }).lean();
    if (!prop) return res.status(404).json({ error: "not_found" });

    if (prop.status !== "published" && !req.user) return res.status(404).json({ error: "not_found" });
    if (prop.status !== "published" && req.user && String(req.user._id) !== String(prop.ownerId) && req.user.role !== "admin") {
      return res.status(404).json({ error: "not_found" });
    }
    Property.updateOne({ _id: prop._id }, { $inc: { "stats.viewsTotal": 1 } }).catch(() => {});
    PropertyView.create({
      propertyId: prop._id,
      userId: req.user?._id,
      sessionKey: req.get("x-session-key"),
      referrer: req.get("referer"),
    }).catch(() => {});

    const detail = publicDetail(prop);
    if (prop.status === "published") {
      // contact details for the Call / WhatsApp buttons. Set HIDE_OWNER_PHONE=true to only ever show a number the owner chose to make public.
      const owner = await User.findById(prop.ownerId).select("phone providerProfile").lean();
      const pp = owner?.providerProfile || {};
      const fallback = process.env.HIDE_OWNER_PHONE === "true" ? undefined : owner?.phone;
      detail.ownerPhone = pp.publicPhone || fallback;
      detail.ownerWhatsapp = pp.whatsappPhone || detail.ownerPhone;
      detail.ownerVerified = pp.verificationStatus === "verified";
      detail.ownerResponseMinutes = pp.avgResponseMinutes;
    }
    res.json({ data: detail });
  } catch (e) {
    next(e);
  }
});
app.get("/api/properties/:id/similar", async (req, res, next) => {
  try {
    const prop = await Property.findById(req.params.id).lean();
    if (!prop) return res.status(404).json({ error: "not_found" });
    const rows = await Property.find({
      _id: { $ne: prop._id },
      status: "published",
      mode: prop.mode,
      "location.district": prop.location?.district,
    })
      .sort("-publishedAt")
      .limit(6)
      .lean();
    res.json({ data: rows.map(publicCard) });
  } catch (e) {
    next(e);
  }
});
/* confirmed viewing slots, so the booking calendar can grey them out */
const VIEWING_SLOTS = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"]; // Kigali time
app.get("/api/properties/:id/availability", async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) return res.status(422).json({ error: "invalid_id" });
    const rows = await ViewingBooking.find({
      propertyId: req.params.id,
      status: "confirmed",
      scheduledAt: { $gte: new Date(), $lte: new Date(Date.now() + 61 * 864e5) },
    }).select("scheduledAt").lean();
    res.json({ data: { timezone: "Africa/Kigali", slotMinutes: 30, slots: VIEWING_SLOTS, booked: rows.map((r) => r.scheduledAt.toISOString()) } });
  } catch (e) {
    next(e);
  }
});
const createPropertySchema = z.object({
  title: z.string().trim().min(10).max(160),
  description: z.string().min(20).max(5000),
  mode: z.enum(["rent", "sale"]),
  propertyType: z.enum(["house", "apartment", "villa", "townhouse", "studio", "land", "commercial"]),
  priceRwf: z.number().int().positive(),
  depositMonths: z.number().int().min(0).max(12).optional(),
  minLeaseMonths: z.number().int().min(1).max(60).optional(),
  bedrooms: z.number().int().min(0).max(30),
  bathrooms: z.number().int().min(0).max(30),
  areaSqm: z.number().positive().optional(),
  parkingSpaces: z.number().int().min(0).max(100).optional(),
  furnishing: z.enum(["furnished", "semi_furnished", "unfurnished"]).default("unfurnished"),
  availableFrom: z.coerce.date().optional(),
  location: z.object({
    districtId: z.string(),
    district: z.string(),
    province: z.string(),
    neighbourhood: z.string().optional(),
    addressLine: z.string().optional(),
    point: z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number(), z.number()]) }).optional(),
    hideExactLocation: z.boolean().optional(),
  }),
  amenities: z.array(z.object({ slug: z.string(), label: z.string(), icon: z.string().optional() })).default([]),
  nearby: z.array(z.object({ label: z.string(), travelMinutes: z.number().int().min(1).max(600), travelMode: z.enum(["walk", "drive"]) })).default([]),
  images: z.array(z.object({
    url: z.string().url(),
    cardUrl: z.string().url().optional(),
    thumbUrl: z.string().url().optional(),
    altText: z.string().optional(),
    sortOrder: z.number().int().min(0).default(0),
    kind: z.enum(["photo", "floor_plan"]).default("photo"),
  })).max(40).default([]),
});

app.post("/api/properties", optionalAuth, requireRole("landlord", "agent", "admin"), validate(createPropertySchema), async (req, res, next) => {
  try {
    const b = req.body;
    if (b.mode === "rent" && (b.depositMonths == null || b.minLeaseMonths == null)) {
      return res.status(422).json({ error: "validation_failed", issues: [{ path: "depositMonths", message: "required for rent" }] });
    }
    if (b.mode === "sale" && (b.depositMonths != null || b.minLeaseMonths != null)) {
      return res.status(422).json({ error: "validation_failed", issues: [{ path: "depositMonths", message: "must be omitted for sale" }] });
    }

    const seq = await nextSeq("properties");
    const refNumber = seq;
    const ref = `UL-${String(refNumber).padStart(4, "0")}`;

    const slugBase = b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    let slug = `${slugBase}-${refNumber}`;
    while (await Property.exists({ slug })) slug = `${slugBase}-${refNumber}-${nanoid(4)}`;

    const images = b.images.map((img) => ({
      _id: new Types.ObjectId(),
      ...img,
      createdAt: new Date(),
      uploadedBy: req.user._id,
    }));

    const cover = images.find((i) => i.kind === "photo");

    const doc = await Property.create({
      ...b,
      ref,
      refNumber,
      slug,
      ownerId: req.user._id,
      ownerRole: req.user.role,
      ownerName: req.user.providerProfile?.displayName || req.user.fullName,
      images,
      coverImageId: cover?._id,
      coverAuto: true,
      status: "pending_review",
      stats: { saves: 0, viewsTotal: 0, viewingRequests: 0, rentRequests: 0, offers: 0 },
    });
    res.status(201).json({ data: publicDetail(doc.toObject()) });
  } catch (e) {
    next(e);
  }
});
const updatePropertySchema = createPropertySchema.partial().extend({
  status: z.enum(["draft", "pending_review", "published", "rented", "sold", "archived"]).optional(),
});

app.patch("/api/properties/:id", optionalAuth, requireAuth, validate(updatePropertySchema), async (req, res, next) => {
  try {
    const prop = await Property.findById(req.params.id);
    if (!prop) return res.status(404).json({ error: "not_found" });
    const owner = String(prop.ownerId) === String(req.user._id);
    if (!owner && req.user.role !== "admin") return res.status(403).json({ error: "forbidden" });

    const updates = { ...req.body };
    delete updates.ownerId;

    if (updates.status === "published" && req.user.role !== "admin") {
      updates.status = "pending_review";
    }
    if (updates.status === "published" && req.user.role === "admin") {
      updates.publishedAt = new Date();
      updates.reviewedBy = req.user._id;
      updates.reviewedAt = new Date();
    }
    if (updates.images) {
      updates.images = updates.images.map((img) => ({ _id: new Types.ObjectId(), kind: "photo", sortOrder: 0, createdAt: new Date(), ...img }));
    }
    Object.assign(prop, updates);
    prop.updatedAt = new Date();
    await prop.save();
    res.json({ data: publicDetail(prop.toObject()) });
  } catch (e) {
    next(e);
  }
});
app.post("/api/properties/:id/review", optionalAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const { decision, rejectionReason } = req.body || {};
    if (!["approve", "reject"].includes(decision)) return res.status(422).json({ error: "decision must be approve|reject" });
    const prop = await Property.findById(req.params.id);
    if (!prop) return res.status(404).json({ error: "not_found" });
    if (decision === "approve") {
      if (!prop.coverImageId) return res.status(422).json({ error: "cover_image_required" });
      prop.status = "published";
      prop.publishedAt = new Date();
      prop.reviewedBy = req.user._id;
      prop.reviewedAt = new Date();
    } else {
      prop.status = "rejected";
      prop.rejectionReason = rejectionReason || "Not compliant";
      prop.reviewedBy = req.user._id;
      prop.reviewedAt = new Date();
    }
    await prop.save();
    notify(prop.ownerId, "listing", decision === "approve" ? "Listing approved" : "Listing rejected",
      decision === "approve" ? `${prop.title} is now live.` : `${prop.title} was rejected: ${prop.rejectionReason}`, { propertyId: prop._id });
    res.json({ ok: true, status: prop.status });
  } catch (e) {
    next(e);
  }
});
app.get("/api/me/properties", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const rows = await Property.find({ ownerId: req.user._id, deletedAt: { $exists: false } }).sort("-createdAt").lean();
    res.json({ data: rows.map(publicDetail) });
  } catch (e) {
    next(e);
  }
});

/* saved properties washyize muri Page.tsx */
app.get("/api/saved-properties", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const rows = await SavedProperty.find({ userId: req.user._id }).sort("-createdAt").lean();
    const props = await Property.find({ _id: { $in: rows.map((r) => r.propertyId) } }).lean();
    res.json({ data: props.map(publicCard) });
  } catch (e) {
    next(e);
  }
});

app.post("/api/saved-properties/:propertyId", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.propertyId)) return res.status(422).json({ error: "invalid_id" });
    const exists = await SavedProperty.findOne({ userId: req.user._id, propertyId: req.params.propertyId });
    if (exists) return res.json({ ok: true, saved: true });
    await SavedProperty.create({ userId: req.user._id, propertyId: req.params.propertyId });
    await Property.updateOne({ _id: req.params.propertyId }, { $inc: { "stats.saves": 1 } });
    res.json({ ok: true, saved: true });
  } catch (e) {
    next(e);
  }
});

app.delete("/api/saved-properties/:propertyId", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const del = await SavedProperty.deleteOne({ userId: req.user._id, propertyId: req.params.propertyId });
    if (del.deletedCount) await Property.updateOne({ _id: req.params.propertyId }, { $inc: { "stats.saves": -1 } });
    res.json({ ok: true, saved: false });
  } catch (e) {
    next(e);
  }
});
app.post("/api/properties/:id/report", optionalAuth, async (req, res, next) => {
  try {
    const { reason, details } = req.body || {};
    if (!["scam", "wrong_info", "already_taken", "inappropriate", "duplicate", "other"].includes(reason)) {
      return res.status(422).json({ error: "invalid_reason" });
    }
    await PropertyReport.create({ propertyId: req.params.id, reporterId: req.user?._id, reason, details });
    res.status(201).json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/*Izi ni Requests za Rents */

const guestOrUser = z
  .object({ guest: contactSchema.optional() })
  .refine(() => true); 

const rentSchema = z.object({
  propertyId: z.string(),
  desiredMoveIn: z.coerce.date(),
  leaseMonths: z.number().int().min(1).max(60),
  occupants: z.number().int().min(1).max(20),
  occupation: z.string().max(120).optional(),
  message: z.string().max(2000).optional(),
  guest: contactSchema.optional(),
});

app.post("/api/rent-requests", optionalAuth, validate(rentSchema), async (req, res, next) => {
  try {
    const b = req.body;
    if (!req.user && !b.guest) return res.status(422).json({ error: "guest_or_auth_required" });
    if (b.desiredMoveIn < startOfToday()) return res.status(422).json({ error: "move_in_in_past" });

    const prop = await Property.findOne({ _id: b.propertyId, status: "published" }).lean();
    if (!prop) return res.status(404).json({ error: "property_not_available" });
    if (prop.mode !== "rent") return res.status(422).json({ error: "not_a_rental" });
    if (isOwnListing(req, prop)) return res.status(422).json({ error: "own_listing" });
    if (prop.minLeaseMonths && b.leaseMonths < prop.minLeaseMonths) {
      return res.status(422).json({ error: "lease_below_minimum", minLeaseMonths: prop.minLeaseMonths });
    }
    if (prop.availableFrom) {
      const from = new Date(prop.availableFrom);
      from.setUTCHours(0, 0, 0, 0);
      if (b.desiredMoveIn < from) return res.status(422).json({ error: "move_in_before_available", availableFrom: from });
    }

    const monthly = prop.priceRwf;
    const deposit = monthly * (prop.depositMonths ?? 0);
    const fee = Math.round(monthly * 0.03);
    const total = monthly + deposit + fee;
    const dedupe = req.user
      ? { propertyId: prop._id, status: "pending", userId: req.user._id }
      : { propertyId: prop._id, status: "pending", "guest.phone": normalizePhone(b.guest.phone) };
    if (await RentRequest.exists(dedupe)) {
      return res.status(409).json({ error: "duplicate_pending_request" });
    }

    const ref = REF("RR");
    const trackingToken = TRACKING_TOKEN();
    const doc = await RentRequest.create({
      ref,
      propertyId: prop._id,
      property: {
        title: prop.title,
        slug: prop.slug,
        ref: prop.ref,
        mode: prop.mode,
        ownerId: prop.ownerId,
        agentId: prop.agentId,
        coverUrl: coverUrl(prop),
      },
      userId: req.user?._id,
      guest: !req.user && b.guest ? normalizeContact(b.guest) : undefined,
      trackingToken,
      message: b.message,
      desiredMoveIn: b.desiredMoveIn,
      leaseMonths: b.leaseMonths,
      occupants: b.occupants,
      occupation: b.occupation,
      pricing: { monthlyRentRwf: monthly, depositRwf: deposit, platformFeeRwf: fee, totalDueRwf: total },
      status: "pending",
      expiresAt: new Date(Date.now() + 14 * 864e5),
    });

    await Property.updateOne({ _id: prop._id }, { $inc: { "stats.rentRequests": 1 } });
    notify(prop.ownerId, "rent_request", "New rental request", `${b.guest?.name || req.user.fullName} requested ${prop.title}`, { rentRequestId: doc._id });
    res.status(201).json({
      data: { ref, id: doc._id, status: doc.status, trackingToken: req.user ? undefined : trackingToken },
    });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "duplicate_pending_request" });
    next(e);
  }
});


app.post("/api/rent-requests/:id/decision", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const { decision, reason } = req.body || {};
    if (!["approve", "decline"].includes(decision)) return res.status(422).json({ error: "decision must be approve|decline" });
    const rr = await RentRequest.findById(req.params.id);
    if (!rr) return res.status(404).json({ error: "not_found" });
    if (rr.status !== "pending") return res.status(409).json({ error: "not_pending" });

    const prop = await Property.findById(rr.propertyId);
    if (!prop) return res.status(404).json({ error: "property_missing" });
    if (String(prop.ownerId) !== String(req.user._id) && req.user.role !== "admin") return res.status(403).json({ error: "forbidden" });

    if (decision === "approve") {
      if (!rr.userId) return res.status(422).json({ error: "guest_requests_require_registration" });
      
      await RentRequest.updateMany(
        { propertyId: rr.propertyId, status: "pending", _id: { $ne: rr._id } },
        { $set: { status: "declined", declineReason: "Property leased to another tenant", decidedAt: new Date() } }
      );
      rr.status = "approved";
      rr.decidedAt = new Date();
      rr.linkedAt = new Date();
      await rr.save();
      const ref = REF("LS");
      const startDate = rr.desiredMoveIn;
      const endDate = new Date(startDate.getTime() + rr.leaseMonths * 30 * 864e5);
      const lease = await Lease.create({
        ref,
        rentRequestId: rr._id,
        propertyId: rr.propertyId,
        tenantId: rr.userId,
        landlordId: prop.ownerId,
        startDate,
        endDate,
        monthlyRentRwf: rr.pricing.monthlyRentRwf,
        depositRwf: rr.pricing.depositRwf,
        paymentDay: Math.min(28, Math.max(1, startDate.getUTCDate())),
        status: "draft",
        installments: [],
      });
      notify(rr.userId, "rent_request", "Rental request approved", `Your request for ${prop.title} was approved. Sign the lease to proceed.`, { leaseId: lease._id });
    } else {
      rr.status = "declined";
      rr.declineReason = reason || "Not available";
      rr.decidedAt = new Date();
      await rr.save();
      notify(rr.userId, "rent_request", "Rental request declined", `Your request for ${prop.title} was declined.`, { rentRequestId: rr._id });
    }
    res.json({ ok: true, status: rr.status });
  } catch (e) {
    next(e);
  }
});
app.get("/api/rent-requests/track/:ref", async (req, res, next) => {
  try {
    const { token } = req.query;
    const rr = await RentRequest.findOne({ ref: req.params.ref }).lean();
    if (!rr) return res.status(404).json({ error: "not_found" });
    if (rr.guest && rr.trackingToken !== token) return res.status(403).json({ error: "invalid_token" });
    res.json({ data: publicRentRequest(rr) });
  } catch (e) {
    next(e);
  }
});

app.get("/api/me/rent-requests", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const props = await Property.find({ ownerId: req.user._id }).select("_id").lean();
    const ids = props.map((p) => p._id);
    const rows = await RentRequest.find({ propertyId: { $in: ids } }).sort("-createdAt").limit(200).lean();
    res.json({ data: rows.map(publicRentRequest) });
  } catch (e) {
    next(e);
  }
});
app.get("/api/me/my-rent-requests", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const rows = await RentRequest.find({ userId: req.user._id }).sort("-createdAt").lean();
    res.json({ data: rows.map(publicRentRequest) });
  } catch (e) {
    next(e);
  }
});


const offerSchema = z.object({
  propertyId: z.string(),
  offerRwf: z.number().int().positive(),
  paymentMethod: z.enum(["bank_transfer", "mortgage", "instalments"]),
  message: z.string().max(2000).optional(),
  guest: contactSchema.optional(),
});

app.post("/api/offers", optionalAuth, validate(offerSchema), async (req, res, next) => {
  try {
    const b = req.body;
    if (!req.user && !b.guest) return res.status(422).json({ error: "guest_or_auth_required" });

    const prop = await Property.findOne({ _id: b.propertyId, status: "published" }).lean();
    if (!prop) return res.status(404).json({ error: "property_not_available" });
    if (prop.mode !== "sale") return res.status(422).json({ error: "not_for_sale" });
    if (isOwnListing(req, prop)) return res.status(422).json({ error: "own_listing" });
    const openOffer = req.user
      ? { propertyId: prop._id, status: "pending", userId: req.user._id }
      : { propertyId: prop._id, status: "pending", "guest.phone": normalizePhone(b.guest.phone) };
    if (await Offer.exists(openOffer)) return res.status(409).json({ error: "duplicate_pending_offer" });

    const ref = REF("OF");
    const trackingToken = TRACKING_TOKEN();
    const doc = await Offer.create({
      ref,
      propertyId: prop._id,
      property: {
        title: prop.title,
        slug: prop.slug,
        ref: prop.ref,
        mode: prop.mode,
        ownerId: prop.ownerId,
        agentId: prop.agentId,
        coverUrl: coverUrl(prop),
      },
      userId: req.user?._id,
      guest: !req.user && b.guest ? normalizeContact(b.guest) : undefined,
      trackingToken,
      offerRwf: b.offerRwf,
      askingPriceRwf: prop.priceRwf,
      paymentMethod: b.paymentMethod,
      message: b.message,
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 864e5),
    });
    await Property.updateOne({ _id: prop._id }, { $inc: { "stats.offers": 1 } });
    notify(prop.ownerId, "offer", "New offer received", `Offer of RWF ${b.offerRwf.toLocaleString()} for ${prop.title}`, { offerId: doc._id });
    res.status(201).json({ data: { ref, id: doc._id, status: doc.status, trackingToken: req.user ? undefined : trackingToken } });
  } catch (e) {
    next(e);
  }
});

app.post("/api/offers/:id/decision", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const { decision, reason, counterOfferRwf } = req.body || {};
    if (!["accept", "decline", "counter", "withdraw"].includes(decision)) return res.status(422).json({ error: "invalid_decision" });
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ error: "not_found" });
    if (offer.status !== "pending") return res.status(409).json({ error: "not_pending" });

    const prop = await Property.findById(offer.propertyId);
    if (!prop) return res.status(404).json({ error: "property_missing" });

    const isOwner = String(prop.ownerId) === String(req.user._id);
    if (decision === "withdraw") {
      if (!isOwner && String(offer.userId) !== String(req.user._id)) return res.status(403).json({ error: "forbidden" });
      offer.status = "withdrawn";
    } else {
      if (!isOwner && req.user.role !== "admin") return res.status(403).json({ error: "forbidden" });
      if (decision === "accept") {
        offer.status = "accepted";
        prop.status = "sold";
        prop.publishedAt = prop.publishedAt || new Date();
        await prop.save();
        await Offer.updateMany({ propertyId: prop._id, _id: { $ne: offer._id }, status: "pending" }, { $set: { status: "declined", declineReason: "Another offer accepted" } });
      } else if (decision === "decline") {
        offer.status = "declined";
        offer.declineReason = reason || "Not accepted";
      } else {
        if (!counterOfferRwf || counterOfferRwf <= 0) return res.status(422).json({ error: "counter_offer_required" });
        offer.status = "countered";
        offer.counterOfferRwf = counterOfferRwf;
      }
    }
    offer.decidedAt = new Date();
    await offer.save();
    if (offer.userId) notify(offer.userId, "offer", `Offer ${offer.status}`, `${prop.title} – your offer is now ${offer.status}.`, { offerId: offer._id });
    res.json({ ok: true, status: offer.status });
  } catch (e) {
    next(e);
  }
});

app.get("/api/offers/track/:ref", async (req, res, next) => {
  try {
    const { token } = req.query;
    const o = await Offer.findOne({ ref: req.params.ref }).lean();
    if (!o) return res.status(404).json({ error: "not_found" });
    if (o.guest && o.trackingToken !== token) return res.status(403).json({ error: "invalid_token" });
    res.json({ data: publicOffer(o) });
  } catch (e) {
    next(e);
  }
});


const viewSchema = z.object({
  propertyId: z.string(),
  scheduledAt: z.coerce.date(),
  durationMinutes: z.number().int().min(10).max(240).default(30),
  visitors: z.number().int().min(1).max(10).default(1),
  message: z.string().max(2000).optional(),
  guest: contactSchema.optional(),
});

app.post("/api/viewing-bookings", optionalAuth, validate(viewSchema), async (req, res, next) => {
  try {
    const b = req.body;
    if (!req.user && !b.guest) return res.status(422).json({ error: "guest_or_auth_required" });
    if (b.scheduledAt < new Date(Date.now() - 60_000)) return res.status(422).json({ error: "scheduled_in_past" });
    if (b.scheduledAt > new Date(Date.now() + 60 * 864e5)) return res.status(422).json({ error: "viewing_too_far" });

    const prop = await Property.findOne({ _id: b.propertyId, status: "published" }).lean();
    if (!prop) return res.status(404).json({ error: "property_not_available" });

    if (isOwnListing(req, prop)) return res.status(422).json({ error: "own_listing" });
    if (await ViewingBooking.exists({ propertyId: prop._id, scheduledAt: b.scheduledAt, status: "confirmed" })) {
      return res.status(409).json({ error: "slot_taken" });
    }
    if (!req.user && (await ViewingBooking.exists({ propertyId: prop._id, scheduledAt: b.scheduledAt, status: "requested", "guest.phone": normalizePhone(b.guest.phone) }))) {
      return res.status(409).json({ error: "slot_already_requested" });
    }
    const ref = REF("VB");
    const trackingToken = TRACKING_TOKEN();
    const doc = await ViewingBooking.create({
      ref,
      propertyId: prop._id,
      property: {
        title: prop.title,
        slug: prop.slug,
        ref: prop.ref,
        mode: prop.mode,
        ownerId: prop.ownerId,
        agentId: prop.agentId,
        coverUrl: coverUrl(prop),
      },
      userId: req.user?._id,
      guest: !req.user && b.guest ? normalizeContact(b.guest) : undefined,
      trackingToken,
      scheduledAt: b.scheduledAt,
      durationMinutes: b.durationMinutes,
      visitors: b.visitors,
      message: b.message,
      status: "requested",
    });
    await Property.updateOne({ _id: prop._id }, { $inc: { "stats.viewingRequests": 1 } });
    notify(prop.ownerId, "viewing", "Viewing requested", `${b.guest?.name || req.user.fullName} requested a viewing for ${prop.title}`, { bookingId: doc._id });
    res.status(201).json({ data: { ref, id: doc._id, status: "requested", trackingToken: req.user ? undefined : trackingToken } });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "slot_already_requested" });
    next(e);
  }
});

app.post("/api/viewing-bookings/:id/decision", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const { decision, reason } = req.body || {};
    if (!["confirm", "decline", "cancel", "complete", "no_show"].includes(decision)) return res.status(422).json({ error: "invalid_decision" });
    const vb = await ViewingBooking.findById(req.params.id);
    if (!vb) return res.status(404).json({ error: "not_found" });
    const prop = await Property.findById(vb.propertyId);
    if (!prop) return res.status(404).json({ error: "property_missing" });
    const isOwner = String(prop.ownerId) === String(req.user._id) || (prop.agentId && String(prop.agentId) === String(req.user._id));
    const isRequester = vb.userId && String(vb.userId) === String(req.user._id);

    if (decision === "cancel") {
      if (!isOwner && !isRequester) return res.status(403).json({ error: "forbidden" });
      vb.status = "cancelled";
      vb.cancelledBy = req.user._id;
      vb.cancelledAt = new Date();
    } else {
      if (!isOwner && req.user.role !== "admin") return res.status(403).json({ error: "forbidden" });
      if (decision === "confirm") {
        vb.status = "confirmed";
        vb.respondedAt = new Date();
      } else if (decision === "decline") {
        vb.status = "declined";
        vb.declineReason = reason;
        vb.respondedAt = new Date();
      } else if (decision === "complete") {
        vb.status = "completed";
        vb.completedAt = new Date();
      } else if (decision === "no_show") {
        vb.status = "no_show";
      }
    }
    await vb.save();
    if (vb.userId) notify(vb.userId, "viewing", `Viewing ${vb.status}`, `${prop.title} – viewing is ${vb.status}.`, { bookingId: vb._id });
    res.json({ ok: true, status: vb.status });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "slot_taken" });
    next(e);
  }
});

app.get("/api/me/viewing-bookings", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const props = await Property.find({ $or: [{ ownerId: req.user._id }, { agentId: req.user._id }] }).select("_id").lean();
    const rows = await ViewingBooking.find({
      $or: [{ propertyId: { $in: props.map((p) => p._id) } }, { userId: req.user._id }],
    }).sort("-scheduledAt").limit(200).lean();
    res.json({ data: rows.map(publicBooking) });
  } catch (e) {
    next(e);
  }
});
/* ───────────── requester self-service ─────────────
 * Look up, cancel or withdraw a request with the tracking code (guests) or while logged in as the requester. */
function ownsRequest(req, doc, token) {
  if (req.user && doc.userId && String(doc.userId) === String(req.user._id)) return true;
  return !!(doc.guest && typeof token === "string" && token && doc.trackingToken === token);
}
async function requesterAction(Model, req, res, { from, to, stamp, notifyType, title, body }) {
  const doc = await Model.findOne({ ref: String(req.params.ref) });
  if (!doc) return res.status(404).json({ error: "not_found" });
  if (!ownsRequest(req, doc, (req.body || {}).token)) return res.status(403).json({ error: "invalid_token" });
  if (!from.includes(doc.status)) return res.status(409).json({ error: "not_cancellable", status: doc.status });
  doc.status = to;
  doc[stamp] = new Date();
  if (stamp !== "decidedAt" && doc.schema.path("decidedAt")) doc.decidedAt = new Date();
  if (req.user && doc.schema.path("cancelledBy")) doc.cancelledBy = req.user._id;
  await doc.save();
  const who = doc.guest?.name || req.user?.fullName || "The requester";
  notify(doc.property?.ownerId, notifyType, title, `${who} ${body} ${doc.property?.title || "your listing"}.`, { ref: doc.ref });
  res.json({ ok: true, status: doc.status });
}
app.get("/api/viewing-bookings/track/:ref", optionalAuth, async (req, res, next) => {
  try {
    const v = await ViewingBooking.findOne({ ref: String(req.params.ref) }).lean();
    if (!v) return res.status(404).json({ error: "not_found" });
    if (!ownsRequest(req, v, req.query.token)) return res.status(403).json({ error: "invalid_token" });
    res.json({ data: publicBooking(v) });
  } catch (e) {
    next(e);
  }
});
app.post("/api/viewing-bookings/track/:ref/cancel", optionalAuth, (req, res, next) =>
  requesterAction(ViewingBooking, req, res, { from: ["requested", "confirmed"], to: "cancelled", stamp: "cancelledAt", notifyType: "viewing", title: "Viewing cancelled", body: "cancelled their viewing of" }).catch(next));
app.post("/api/rent-requests/track/:ref/cancel", optionalAuth, (req, res, next) =>
  requesterAction(RentRequest, req, res, { from: ["pending"], to: "cancelled", stamp: "cancelledAt", notifyType: "rent_request", title: "Rental request cancelled", body: "cancelled their request for" }).catch(next));
app.post("/api/offers/track/:ref/withdraw", optionalAuth, (req, res, next) =>
  requesterAction(Offer, req, res, { from: ["pending"], to: "withdrawn", stamp: "decidedAt", notifyType: "offer", title: "Offer withdrawn", body: "withdrew their offer on" }).catch(next));

app.get("/api/leases", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const q = req.user.role === "admin" ? {} : { $or: [{ tenantId: req.user._id }, { landlordId: req.user._id }] };
    const rows = await Lease.find(q).sort("-createdAt").lean();
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

app.get("/api/leases/:id", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const l = await Lease.findById(req.params.id).lean();
    if (!l) return res.status(404).json({ error: "not_found" });
    const member = [l.tenantId, l.landlordId].map(String).includes(String(req.user._id)) || req.user.role === "admin";
    if (!member) return res.status(403).json({ error: "forbidden" });
    res.json({ data: l });
  } catch (e) {
    next(e);
  }
});

app.post("/api/leases/:id/sign", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const l = await Lease.findById(req.params.id);
    if (!l) return res.status(404).json({ error: "not_found" });
    const now = new Date();
    if (String(l.tenantId) === String(req.user._id)) l.signedByTenantAt = now;
    else if (String(l.landlordId) === String(req.user._id)) l.signedByLandlordAt = now;
    else return res.status(403).json({ error: "forbidden" });

    if (l.status === "draft" && l.signedByTenantAt && l.signedByLandlordAt) {
      const inst = [];
      let d = new Date(l.startDate);
      const day = l.paymentDay;
      while (d <= l.endDate) {
        const due = new Date(d);
        due.setUTCDate(day);
        inst.push({ dueDate: due, amountRwf: l.monthlyRentRwf, status: "upcoming" });
        d = new Date(d.getTime() + 30 * 864e5);
      }
      l.installments = inst;
      l.status = "active";
    }
    await l.save();
    res.json({ data: l });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "active_lease_exists" });
    next(e);
  }
});
app.get("/api/payments", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const q = req.user.role === "admin" ? {} : { payerId: req.user._id };
    const rows = await Payment.find(q).sort("-createdAt").limit(200).lean();
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

const paymentIntentSchema = z.object({
  purpose: z.enum(["security_deposit", "rent", "platform_fee", "sale_deposit"]),
  amountRwf: z.number().int().positive(),
  method: z.enum(["mtn_momo", "airtel_money", "card", "bank_transfer", "cash"]),
  rentRequestId: z.string().optional(),
  leaseId: z.string().optional(),
  offerId: z.string().optional(),
  payerPhone: z.string().optional(),
});
app.post("/api/payments/intent", optionalAuth, requireAuth, validate(paymentIntentSchema), async (req, res, next) => {
  try {
    const b = req.body;
    const links = [b.rentRequestId, b.leaseId, b.offerId].filter(Boolean);
    if (links.length !== 1) return res.status(422).json({ error: "exactly_one_link_required" });

    if (b.rentRequestId) {
      const rr = await RentRequest.findById(b.rentRequestId).lean();
      if (!rr) return res.status(404).json({ error: "rent_request_missing" });
      if (String(rr.userId) !== String(req.user._id)) return res.status(403).json({ error: "forbidden" });
    }
    if (b.leaseId) {
      const l = await Lease.findById(b.leaseId).lean();
      if (!l) return res.status(404).json({ error: "lease_missing" });
      if (![l.tenantId, l.landlordId].map(String).includes(String(req.user._id))) return res.status(403).json({ error: "forbidden" });
    }
    if (b.offerId) {
      const o = await Offer.findById(b.offerId).lean();
      if (!o) return res.status(404).json({ error: "offer_missing" });
      if (String(o.userId) !== String(req.user._id)) return res.status(403).json({ error: "forbidden" });
    }

    const payerPhone = b.payerPhone ? normalizePhone(b.payerPhone) : undefined;
    const p = await Payment.create({
      payerId: req.user._id,
      rentRequestId: b.rentRequestId,
      leaseId: b.leaseId,
      offerId: b.offerId,
      purpose: b.purpose,
      amountRwf: b.amountRwf,
      currency: "RWF",
      method: b.method,
      status: "pending",
      payerPhone,
    });
    res.status(201).json({ data: p });
  } catch (e) {
    next(e);
  }
});
app.post("/api/payments/:id/settle", async (req, res, next) => {
  try {
    if (req.get("x-provider-secret") !== process.env.PAYMENT_WEBHOOK_SECRET) return res.status(401).json({ error: "unauthorized" });
    const { status, providerReference, provider, failureReason } = req.body || {};
    if (!["succeeded", "failed", "refunded"].includes(status)) return res.status(422).json({ error: "invalid_status" });
    const p = await Payment.findById(req.params.id);
    if (!p) return res.status(404).json({ error: "not_found" });
    if (p.status !== "pending") return res.status(409).json({ error: "already_settled" });

    p.status = status;
    p.provider = provider;
    p.providerReference = providerReference;
    p.failureReason = failureReason;
    if (status === "succeeded") p.paidAt = new Date();
    if (status === "refunded") p.refundedAt = new Date();
    await p.save();

    if (status === "succeeded" && p.leaseId) {
      const l = await Lease.findById(p.leaseId);
      if (l) {
        const due = l.installments.find((i) => i.status !== "paid" && i.dueDate <= new Date(Date.now() + 5 * 864e5));
        if (due) {
          due.status = "paid";
          due.paymentId = p._id;
          due.paidAt = new Date();
          await l.save();
        }
      }
    }
    notify(p.payerId, "payment", `Payment ${status}`, `Your payment of RWF ${p.amountRwf.toLocaleString()} is ${status}.`, { paymentId: p._id });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "provider_reference_exists" });
    next(e);
  }
});

const providerAppSchema = z.object({
  requestedRole: z.enum(["landlord", "agent"]),
  displayName: z.string().trim().min(2).max(120),
  message: z.string().max(2000).optional(),
});

app.post("/api/provider-applications", optionalAuth, requireAuth, validate(providerAppSchema), async (req, res, next) => {
  try {
    const exists = await ProviderApplication.exists({ userId: req.user._id, status: "pending" });
    if (exists) return res.status(409).json({ error: "pending_application_exists" });
    const doc = await ProviderApplication.create({ userId: req.user._id, ...req.body });
    res.status(201).json({ data: { id: doc._id, status: doc.status } });
  } catch (e) {
    next(e);
  }
});

app.post("/api/provider-applications/:id/review", optionalAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const { decision, note } = req.body || {};
    if (!["approve", "reject"].includes(decision)) return res.status(422).json({ error: "invalid_decision" });
    const appDoc = await ProviderApplication.findById(req.params.id);
    if (!appDoc || appDoc.status !== "pending") return res.status(404).json({ error: "not_found_or_processed" });
    appDoc.status = decision === "approve" ? "approved" : "rejected";
    appDoc.reviewedBy = req.user._id;
    appDoc.reviewedAt = new Date();
    appDoc.reviewNote = note;
    await appDoc.save();
    if (decision === "approve") {
      const u = await User.findById(appDoc.userId);
      if (u) {
        u.role = appDoc.requestedRole;
        u.providerProfile = {
          ...(u.providerProfile || {}),
          displayName: appDoc.displayName,
          verificationStatus: "verified",
          verifiedAt: new Date(),
          verifiedBy: req.user._id,
        };
        await u.save();
      }
    }
    notify(appDoc.userId, "system", `Provider application ${appDoc.status}`, `Your application to become a ${appDoc.requestedRole} was ${appDoc.status}.`, {});
    res.json({ ok: true, status: appDoc.status });
  } catch (e) {
    next(e);
  }
});
app.get("/api/agencies", async (req, res, next) => {
  try {
    const rows = await Agency.find({}).sort({ name: 1 }).lean();
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

app.get("/api/notifications", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const rows = await Notification.find({ userId: req.user._id }).sort("-createdAt").limit(100).lean();
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

app.post("/api/notifications/:id/read", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    await Notification.updateOne({ _id: req.params.id, userId: req.user._id }, { $set: { readAt: new Date() } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.get("/api/admin/counters", optionalAuth, requireRole("admin"), async (_req, res, next) => {
  try {
    const rows = await Counter.find({}).lean();
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});


/* ═══════════════════════════════════════════════════════════
 *  ADMIN API  —  everything under /api/admin/*
 *  Every route here requires a logged-in user whose role is "admin".
 *  Every change is written to the audit log (GET /api/admin/audit-logs).
 *  ═══════════════════════════════════════════════════════════ */
const USER_ROLES = ["tenant", "landlord", "agent", "admin"];
const USER_STATUSES = ["active", "suspended", "deactivated"];
const PROPERTY_STATUSES = ["draft", "pending_review", "published", "rented", "sold", "archived", "rejected"];

const AuditLog = model(
  "AuditLog",
  new Schema(
    {
      adminId: { type: Types.ObjectId, required: true },
      adminName: String,
      action: { type: String, required: true },
      targetType: String,
      targetId: Types.ObjectId,
      summary: String,
      meta: Object,
      ip: String,
    },
    { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
  )
);
ensureIndex(AuditLog.collection, { createdAt: -1 });
ensureIndex(AuditLog.collection, { targetType: 1, targetId: 1, createdAt: -1 });

async function audit(req, action, targetType, targetId, summary, meta = {}) {
  try {
    await AuditLog.create({ adminId: req.user._id, adminName: req.user.fullName, action, targetType, targetId, summary, meta, ip: req.ip });
  } catch (e) {
    console.warn("[audit] could not write log", action, e.message);
  }
}

/* ---- small helpers ---- */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); // async errors -> error handler
const qstr = (v) => (typeof v === "string" ? v.trim().slice(0, 100) : undefined); // ignores ?x[$ne]=1 style objects
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const enumOr = (v, list) => (list.includes(v) ? v : undefined);
const oid = (v) => (typeof v === "string" && Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : undefined);
const rx = (q) => new RegExp(esc(q), "i");

function paging(req, def = 20) {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || def));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  return { page, limit, skip: (page - 1) * limit };
}
const pageMeta = (p, total) => ({ page: p.page, limit: p.limit, total, pages: Math.ceil(total / p.limit) });
function sortBy(req, allowed, fallback) {
  const raw = qstr(req.query.sort) || fallback;
  return allowed.includes(raw.replace(/^-/, "")) ? raw : fallback;
}
/** paginated list with whitelisted sorting */
async function listDocs(Model, filter, req, { sortable, defSort = "-createdAt", select, map } = {}) {
  const pg = paging(req);
  let q = Model.find(filter);
  if (select) q = q.select(select);
  const [rows, total] = await Promise.all([
    q.sort(sortBy(req, sortable || ["createdAt"], defSort)).skip(pg.skip).limit(pg.limit).lean(),
    Model.countDocuments(filter),
  ]);
  return { data: map ? rows.map(map) : rows, pagination: pageMeta(pg, total) };
}
const countBy = (Model, field, match = {}) =>
  Model.aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]).then((rows) =>
    Object.fromEntries(rows.map((r) => [r._id ?? "unknown", r.n]))
  );

const userLite = (u) => u && { id: String(u._id), fullName: u.fullName, email: u.email, phone: u.phone, role: u.role, status: u.status };
async function liteUsers(ids) {
  const clean = [...new Set(ids.filter(Boolean).map(String))];
  if (!clean.length) return new Map();
  const rows = await User.find({ _id: { $in: clean } }).select("fullName email phone role status").lean();
  return new Map(rows.map((u) => [String(u._id), userLite(u)]));
}
const adminUser = (u) => ({
  id: String(u._id),
  email: u.email,
  phone: u.phone,
  fullName: u.fullName,
  role: u.role,
  status: u.status,
  locale: u.locale,
  avatarUrl: u.avatarUrl,
  providerProfile: u.providerProfile,
  emailVerifiedAt: u.emailVerifiedAt,
  phoneVerifiedAt: u.phoneVerifiedAt,
  lastLoginAt: u.lastLoginAt,
  failedLoginCount: u.failedLoginCount || 0,
  lockedUntil: u.lockedUntil,
  deletedAt: u.deletedAt,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});
const withoutToken = (doc) => {
  const { trackingToken, ...rest } = doc; // guests' tracking token is a secret: never sent to the admin UI
  return rest;
};
const adminProperty = (p) => ({
  ...publicCard(p),
  status: p.status,
  ownerId: String(p.ownerId),
  ownerRole: p.ownerRole,
  isVerified: !!p.isVerified,
  rejectionReason: p.rejectionReason,
  reviewedAt: p.reviewedAt,
  deletedAt: p.deletedAt,
  stats: p.stats,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

const revokeAllSessions = (userId) => AuthSession.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
const otherActiveAdmins = (user) =>
  User.countDocuments({ role: "admin", status: "active", deletedAt: { $exists: false }, _id: { $ne: user._id } });
const isSelf = (req, id) => String(req.user._id) === String(id);
async function archiveUserListings(userId) {
  const r = await Property.updateMany({ ownerId: userId, status: { $in: ["published", "pending_review"] } }, { $set: { status: "archived" } });
  return r.modifiedCount || 0;
}

const admin = express.Router();
admin.use(optionalAuth, requireRole("admin"));
admin.param("id", (_req, res, next, id) => (Types.ObjectId.isValid(id) ? next() : res.status(422).json({ error: "invalid_id" })));

/* ───────────── dashboard & activity ───────────── */
admin.get("/stats", h(async (_req, res) => {
  const live = { deletedAt: { $exists: false } };
  const since = (days) => ({ createdAt: { $gte: new Date(Date.now() - days * 864e5) } });
  const [usersByRole, usersByStatus, properties, rentRequests, viewings, offers, leases, payments, revenue, openReports, pendingApps, new7, new30] =
    await Promise.all([
      countBy(User, "role", live),
      countBy(User, "status", live),
      countBy(Property, "status", live),
      countBy(RentRequest, "status"),
      countBy(ViewingBooking, "status"),
      countBy(Offer, "status"),
      countBy(Lease, "status"),
      countBy(Payment, "status"),
      Payment.aggregate([{ $match: { status: "succeeded" } }, { $group: { _id: "$purpose", totalRwf: { $sum: "$amountRwf" }, count: { $sum: 1 } } }]),
      PropertyReport.countDocuments({ status: { $in: ["open", "reviewing"] } }),
      ProviderApplication.countDocuments({ status: "pending" }),
      User.countDocuments({ ...live, ...since(7) }),
      User.countDocuments({ ...live, ...since(30) }),
    ]);
  res.json({
    data: {
      attention: {
        propertiesPendingReview: properties.pending_review ?? 0,
        providerApplicationsPending: pendingApps,
        openReports,
        rentRequestsPending: rentRequests.pending ?? 0,
        viewingsRequested: viewings.requested ?? 0,
        offersPending: offers.pending ?? 0,
      },
      users: { byRole: usersByRole, byStatus: usersByStatus, new7d: new7, new30d: new30 },
      properties: { byStatus: properties },
      rentRequests: { byStatus: rentRequests },
      viewings: { byStatus: viewings },
      offers: { byStatus: offers },
      leases: { byStatus: leases },
      payments: { byStatus: payments, revenueByPurpose: revenue.map((r) => ({ purpose: r._id, totalRwf: r.totalRwf, count: r.count })) },
    },
  });
}));

/** one merged, newest-first feed of what is happening on the platform */
admin.get("/activity", h(async (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const recent = (Model, sel) => Model.find({}).sort("-createdAt").limit(limit).select(sel).lean();
  const [users, props, rrs, vbs, offs, pays, reps, apps] = await Promise.all([
    recent(User, "fullName role status createdAt"),
    recent(Property, "title ref status ownerName createdAt"),
    recent(RentRequest, "ref property.title status createdAt"),
    recent(ViewingBooking, "ref property.title status scheduledAt createdAt"),
    recent(Offer, "ref property.title status offerRwf createdAt"),
    recent(Payment, "purpose amountRwf status createdAt"),
    recent(PropertyReport, "reason propertyId status createdAt"),
    recent(ProviderApplication, "displayName requestedRole status createdAt"),
  ]);
  const feed = [
    ...users.map((u) => ({ type: "user", id: String(u._id), title: `${u.fullName} joined as ${u.role}`, status: u.status, at: u.createdAt })),
    ...props.map((p) => ({ type: "property", id: String(p._id), title: `${p.ref}: ${p.title} (by ${p.ownerName || "unknown"})`, status: p.status, at: p.createdAt })),
    ...rrs.map((r) => ({ type: "rent_request", id: String(r._id), title: `${r.ref} for ${r.property?.title}`, status: r.status, at: r.createdAt })),
    ...vbs.map((v) => ({ type: "viewing", id: String(v._id), title: `${v.ref} for ${v.property?.title}`, status: v.status, at: v.createdAt })),
    ...offs.map((o) => ({ type: "offer", id: String(o._id), title: `${o.ref}: RWF ${Number(o.offerRwf).toLocaleString("en-US")} for ${o.property?.title}`, status: o.status, at: o.createdAt })),
    ...pays.map((p) => ({ type: "payment", id: String(p._id), title: `${p.purpose}: RWF ${Number(p.amountRwf).toLocaleString("en-US")}`, status: p.status, at: p.createdAt })),
    ...reps.map((r) => ({ type: "report", id: String(r._id), title: `Listing reported: ${r.reason}`, status: r.status, at: r.createdAt })),
    ...apps.map((a) => ({ type: "provider_application", id: String(a._id), title: `${a.displayName} applied to be ${a.requestedRole}`, status: a.status, at: a.createdAt })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limit);
  res.json({ data: feed });
}));

admin.get("/audit-logs", h(async (req, res) => {
  const f = {};
  const action = qstr(req.query.action);
  if (action) f.action = action;
  const targetType = qstr(req.query.targetType);
  if (targetType) f.targetType = targetType;
  if (oid(req.query.adminId)) f.adminId = oid(req.query.adminId);
  if (oid(req.query.targetId)) f.targetId = oid(req.query.targetId);
  res.json(await listDocs(AuditLog, f, req, { sortable: ["createdAt"] }));
}));

/* ───────────── users ───────────── */
admin.get("/users", h(async (req, res) => {
  const f = {};
  const role = enumOr(qstr(req.query.role), USER_ROLES);
  if (role) f.role = role;
  const status = enumOr(qstr(req.query.status), USER_STATUSES);
  if (status) f.status = status;
  if (req.query.includeDeleted !== "true") f.deletedAt = { $exists: false };
  const q = qstr(req.query.q);
  if (q) f.$or = [{ email: rx(q) }, { phone: rx(q) }, { fullName: rx(q) }];
  res.json(await listDocs(User, f, req, { sortable: ["createdAt", "lastLoginAt", "fullName", "email"], select: "-passwordHash", map: adminUser }));
}));

const adminCreateUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().refine((v) => RW_PHONE_LOCAL.test(v.replace(/[\s-]/g, "")), "invalid Rwandan phone"),
  password: z.string().min(8).max(72),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(USER_ROLES).default("tenant"),
  locale: z.enum(["en", "rw", "fr"]).default("en"),
});
/** the only way to create another admin account */
admin.post("/users", validate(adminCreateUserSchema), h(async (req, res) => {
  const { email, phone, password, fullName, role, locale } = req.body;
  const normalized = normalizePhone(phone);
  if (await User.exists({ $or: [{ email }, { phone: normalized }] })) {
    return res.status(409).json({ error: "already_exists", message: "Email or phone already registered." });
  }
  const user = await User.create({ email, phone: normalized, passwordHash: await bcrypt.hash(password, 12), fullName, role, locale });
  await audit(req, "user.create", "user", user._id, `Created ${role} account ${email}`, { role });
  res.status(201).json({ data: adminUser(user.toObject()) });
}));

admin.get("/users/:id", h(async (req, res) => {
  const u = await User.findById(req.params.id).select("-passwordHash").lean();
  if (!u) return res.status(404).json({ error: "not_found" });
  const [properties, rentRequests, viewings, offers, leases, payments, activeSessions] = await Promise.all([
    Property.countDocuments({ ownerId: u._id, deletedAt: { $exists: false } }),
    RentRequest.countDocuments({ userId: u._id }),
    ViewingBooking.countDocuments({ userId: u._id }),
    Offer.countDocuments({ userId: u._id }),
    Lease.countDocuments({ $or: [{ tenantId: u._id }, { landlordId: u._id }] }),
    Payment.countDocuments({ payerId: u._id }),
    AuthSession.countDocuments({ userId: u._id, revokedAt: null, expiresAt: { $gt: new Date() } }),
  ]);
  res.json({ data: { ...adminUser(u), counts: { properties, rentRequests, viewings, offers, leases, payments, activeSessions } } });
}));

const adminUpdateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().refine((v) => RW_PHONE_LOCAL.test(v.replace(/[\s-]/g, "")), "invalid Rwandan phone").optional(),
  role: z.enum(USER_ROLES).optional(),
  locale: z.enum(["en", "rw", "fr"]).optional(),
});
admin.patch("/users/:id", validate(adminUpdateUserSchema), h(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "not_found" });
  const b = req.body;
  const before = { role: user.role, email: user.email, phone: user.phone, fullName: user.fullName };

  if (b.role && b.role !== user.role) {
    if (isSelf(req, user._id)) return res.status(409).json({ error: "cannot_change_own_role" });
    if (user.role === "admin" && user.status === "active" && !(await otherActiveAdmins(user))) return res.status(409).json({ error: "last_admin" });
  }
  const phone = b.phone ? normalizePhone(b.phone) : undefined;
  const clash = [];
  if (b.email && b.email !== user.email) clash.push({ email: b.email });
  if (phone && phone !== user.phone) clash.push({ phone });
  if (clash.length && (await User.exists({ _id: { $ne: user._id }, $or: clash }))) return res.status(409).json({ error: "already_exists" });

  if (b.fullName) user.fullName = b.fullName;
  if (b.email) user.email = b.email;
  if (phone) user.phone = phone;
  if (b.role) user.role = b.role;
  if (b.locale) user.locale = b.locale;
  await user.save();
  if (b.role && b.role !== before.role) await revokeAllSessions(user._id); // old tokens still carry the old role
  await audit(req, "user.update", "user", user._id, `Updated ${user.email}`, { before, after: b });
  res.json({ data: adminUser(user.toObject()) });
}));

async function changeUserStatus(req, res, status, action) {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "not_found" });
  if (isSelf(req, user._id)) return res.status(409).json({ error: "cannot_target_self" });
  if (user.role === "admin" && user.status === "active" && !(await otherActiveAdmins(user))) return res.status(409).json({ error: "last_admin" });
  const { reason } = req.body || {};
  const archive = (req.body || {}).archiveListings ?? status === "deactivated";
  await User.updateOne({ _id: user._id }, { $set: { status } });
  await revokeAllSessions(user._id); // logs them out everywhere right away
  const archivedListings = archive ? await archiveUserListings(user._id) : 0;
  await audit(req, action, "user", user._id, `${action} ${user.email}`, { reason, archivedListings });
  res.json({ ok: true, status, archivedListings });
}
admin.post("/users/:id/suspend", h((req, res) => changeUserStatus(req, res, "suspended", "user.suspend")));
admin.post("/users/:id/deactivate", h((req, res) => changeUserStatus(req, res, "deactivated", "user.deactivate")));

admin.post("/users/:id/reactivate", h(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "not_found" });
  await User.updateOne(
    { _id: user._id },
    { $set: { status: "active", failedLoginCount: 0 }, $unset: { deletedAt: "", lockedUntil: "" } }
  );
  await audit(req, "user.reactivate", "user", user._id, `Reactivated ${user.email}`);
  res.json({ ok: true, status: "active" });
}));

admin.post("/users/:id/unlock", h(async (req, res) => {
  const r = await User.updateOne({ _id: req.params.id }, { $set: { failedLoginCount: 0 }, $unset: { lockedUntil: "" } });
  if (!r.matchedCount) return res.status(404).json({ error: "not_found" });
  await audit(req, "user.unlock", "user", req.params.id, "Cleared login lock");
  res.json({ ok: true });
}));

admin.post("/users/:id/revoke-sessions", h(async (req, res) => {
  if (!(await User.exists({ _id: req.params.id }))) return res.status(404).json({ error: "not_found" });
  const r = await revokeAllSessions(req.params.id);
  await audit(req, "user.revoke_sessions", "user", req.params.id, "Forced logout on all devices", { revoked: r.modifiedCount });
  res.json({ ok: true, revoked: r.modifiedCount || 0 });
}));

admin.post("/users/:id/reset-password", validate(z.object({ password: z.string().min(8).max(72) })), h(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "not_found" });
  await User.updateOne(
    { _id: user._id },
    { $set: { passwordHash: await bcrypt.hash(req.body.password, 12), failedLoginCount: 0 }, $unset: { lockedUntil: "" } }
  );
  await revokeAllSessions(user._id);
  notify(user._id, "system", "Password changed", "An administrator reset your password. Log in with the new password you were given.", {});
  await audit(req, "user.reset_password", "user", user._id, `Reset password for ${user.email}`);
  res.json({ ok: true });
}));

/** soft delete by default (keeps history, blocks login); ?permanent=true only for users with no linked records */
admin.delete("/users/:id", h(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "not_found" });
  if (isSelf(req, user._id)) return res.status(409).json({ error: "cannot_target_self" });
  if (user.role === "admin" && user.status === "active" && !(await otherActiveAdmins(user))) return res.status(409).json({ error: "last_admin" });

  if (req.query.permanent === "true") {
    const [properties, rentRequests, offers, viewings, leases, payments] = await Promise.all([
      Property.countDocuments({ ownerId: user._id }),
      RentRequest.countDocuments({ userId: user._id }),
      Offer.countDocuments({ userId: user._id }),
      ViewingBooking.countDocuments({ userId: user._id }),
      Lease.countDocuments({ $or: [{ tenantId: user._id }, { landlordId: user._id }] }),
      Payment.countDocuments({ payerId: user._id }),
    ]);
    const linked = { properties, rentRequests, offers, viewings, leases, payments };
    if (Object.values(linked).some(Boolean)) return res.status(409).json({ error: "has_linked_records", linked });
    await Promise.all([
      AuthSession.deleteMany({ userId: user._id }),
      Notification.deleteMany({ userId: user._id }),
      SavedProperty.deleteMany({ userId: user._id }),
      ProviderApplication.deleteMany({ userId: user._id }),
      AuthToken.deleteMany({ userId: user._id }),
    ]);
    await User.deleteOne({ _id: user._id });
    await audit(req, "user.delete_permanent", "user", user._id, `Permanently deleted ${user.email}`);
    return res.json({ ok: true, permanent: true });
  }

  await User.updateOne({ _id: user._id }, { $set: { status: "deactivated", deletedAt: new Date() } });
  await revokeAllSessions(user._id);
  const archivedListings = (req.body || {}).archiveListings === false ? 0 : await archiveUserListings(user._id);
  await audit(req, "user.delete", "user", user._id, `Deleted ${user.email}`, { archivedListings, reason: (req.body || {}).reason });
  res.json({ ok: true, permanent: false, archivedListings });
}));

/* ───────────── provider applications (become landlord / agent) ───────────── */
admin.get("/provider-applications", h(async (req, res) => {
  const f = {};
  const status = enumOr(qstr(req.query.status), ["pending", "approved", "rejected"]);
  if (status) f.status = status;
  const out = await listDocs(ProviderApplication, f, req, { sortable: ["createdAt", "reviewedAt"] });
  const users = await liteUsers(out.data.map((a) => a.userId));
  out.data = out.data.map((a) => ({ ...a, user: users.get(String(a.userId)) || null }));
  res.json(out);
}));

admin.get("/provider-applications/:id", h(async (req, res) => {
  const a = await ProviderApplication.findById(req.params.id).lean();
  if (!a) return res.status(404).json({ error: "not_found" });
  const users = await liteUsers([a.userId]);
  res.json({ data: { ...a, user: users.get(String(a.userId)) || null } });
}));

admin.post("/provider-applications/:id/review", h(async (req, res) => {
  const { decision, note } = req.body || {};
  if (!["approve", "reject"].includes(decision)) return res.status(422).json({ error: "decision must be approve|reject" });
  const appDoc = await ProviderApplication.findById(req.params.id);
  if (!appDoc || appDoc.status !== "pending") return res.status(404).json({ error: "not_found_or_processed" });
  appDoc.status = decision === "approve" ? "approved" : "rejected";
  appDoc.reviewedBy = req.user._id;
  appDoc.reviewedAt = new Date();
  appDoc.reviewNote = note;
  await appDoc.save();
  if (decision === "approve") {
    const u = await User.findById(appDoc.userId);
    if (u && u.role !== "admin") {
      u.role = appDoc.requestedRole;
      u.providerProfile = {
        ...(u.providerProfile || {}),
        displayName: appDoc.displayName,
        verificationStatus: "verified",
        verifiedAt: new Date(),
        verifiedBy: req.user._id,
      };
      await u.save();
      await revokeAllSessions(u._id); // they log in again and get a token with the new role
    }
  }
  notify(appDoc.userId, "system", `Provider application ${appDoc.status}`, `Your application to become a ${appDoc.requestedRole} was ${appDoc.status}.${note ? ` ${note}` : ""}`, {});
  await audit(req, `provider_application.${decision}`, "provider_application", appDoc._id, `${decision}d application for ${appDoc.displayName}`, { note });
  res.json({ ok: true, status: appDoc.status });
}));

/* ───────────── properties / listings ───────────── */
admin.get("/properties", h(async (req, res) => {
  const f = {};
  const status = enumOr(qstr(req.query.status), PROPERTY_STATUSES);
  if (status) f.status = status;
  const mode = enumOr(qstr(req.query.mode), ["rent", "sale"]);
  if (mode) f.mode = mode;
  if (oid(req.query.ownerId)) f.ownerId = oid(req.query.ownerId);
  if (qstr(req.query.district)) f["location.district"] = qstr(req.query.district);
  if (req.query.includeDeleted !== "true") f.deletedAt = { $exists: false };
  const q = qstr(req.query.q);
  if (q) f.$or = [{ title: rx(q) }, { ref: rx(q) }, { ownerName: rx(q) }];
  res.json(await listDocs(Property, f, req, { sortable: ["createdAt", "updatedAt", "publishedAt", "priceRwf", "title"], map: adminProperty }));
}));

admin.get("/properties/:id", h(async (req, res) => {
  const p = await Property.findById(req.params.id).lean();
  if (!p) return res.status(404).json({ error: "not_found" });
  const owners = await liteUsers([p.ownerId, p.reviewedBy]);
  const [reports, rentRequests, viewings, offers] = await Promise.all([
    PropertyReport.countDocuments({ propertyId: p._id }),
    RentRequest.countDocuments({ propertyId: p._id }),
    ViewingBooking.countDocuments({ propertyId: p._id }),
    Offer.countDocuments({ propertyId: p._id }),
  ]);
  res.json({
    data: {
      ...publicDetail(p),
      ...adminProperty(p),
      owner: owners.get(String(p.ownerId)) || null,
      reviewedBy: owners.get(String(p.reviewedBy)) || null,
      counts: { reports, rentRequests, viewings, offers },
    },
  });
}));

/** approve or reject a listing that is waiting for review */
admin.post("/properties/:id/review", h(async (req, res) => {
  const { decision, rejectionReason } = req.body || {};
  if (!["approve", "reject"].includes(decision)) return res.status(422).json({ error: "decision must be approve|reject" });
  const prop = await Property.findById(req.params.id);
  if (!prop || prop.deletedAt) return res.status(404).json({ error: "not_found" });
  if (decision === "approve") {
    if (!prop.coverImageId) return res.status(422).json({ error: "cover_image_required" });
    prop.status = "published";
    prop.publishedAt = new Date();
    prop.rejectionReason = undefined;
  } else {
    prop.status = "rejected";
    prop.rejectionReason = rejectionReason || "Not compliant";
  }
  prop.reviewedBy = req.user._id;
  prop.reviewedAt = new Date();
  await prop.save();
  notify(prop.ownerId, "listing", decision === "approve" ? "Listing approved" : "Listing rejected",
    decision === "approve" ? `${prop.title} is now live.` : `${prop.title} was rejected: ${prop.rejectionReason}`, { propertyId: prop._id });
  await audit(req, `property.${decision}`, "property", prop._id, `${decision}d ${prop.ref}`, { rejectionReason: prop.rejectionReason });
  res.json({ ok: true, status: prop.status });
}));

admin.patch("/properties/:id/status", validate(z.object({ status: z.enum(PROPERTY_STATUSES), reason: z.string().max(500).optional() })), h(async (req, res) => {
  const prop = await Property.findById(req.params.id);
  if (!prop || prop.deletedAt) return res.status(404).json({ error: "not_found" });
  const { status, reason } = req.body;
  if (status === "published" && !prop.coverImageId) return res.status(422).json({ error: "cover_image_required" });
  const from = prop.status;
  prop.status = status;
  if (status === "published") prop.publishedAt = prop.publishedAt || new Date();
  if (status === "rejected") prop.rejectionReason = reason || "Not compliant";
  prop.reviewedBy = req.user._id;
  prop.reviewedAt = new Date();
  await prop.save();
  notify(prop.ownerId, "listing", `Listing ${status}`, `${prop.title} is now ${status.replace("_", " ")}.${reason ? ` ${reason}` : ""}`, { propertyId: prop._id });
  await audit(req, "property.status", "property", prop._id, `${prop.ref}: ${from} -> ${status}`, { reason });
  res.json({ ok: true, status });
}));

const flagsSchema = z.object({
  isFeatured: z.boolean().optional(),
  featuredUntil: z.coerce.date().nullable().optional(),
  isVerified: z.boolean().optional(),
  customTag: z.string().trim().max(40).nullable().optional(),
});
admin.patch("/properties/:id/flags", validate(flagsSchema), h(async (req, res) => {
  const prop = await Property.findById(req.params.id);
  if (!prop || prop.deletedAt) return res.status(404).json({ error: "not_found" });
  const b = req.body;
  if (b.isFeatured !== undefined) prop.isFeatured = b.isFeatured;
  if (b.featuredUntil !== undefined) prop.featuredUntil = b.featuredUntil || undefined;
  if (b.customTag !== undefined) prop.customTag = b.customTag || undefined;
  if (b.isVerified !== undefined) {
    prop.isVerified = b.isVerified;
    prop.verifiedAt = b.isVerified ? new Date() : undefined;
    prop.verifiedBy = b.isVerified ? req.user._id : undefined;
  }
  await prop.save();
  await audit(req, "property.flags", "property", prop._id, `Updated badges on ${prop.ref}`, b);
  res.json({ data: adminProperty(prop.toObject()) });
}));

/** soft delete: hides the listing and closes everything still open on it */
admin.delete("/properties/:id", h(async (req, res) => {
  const prop = await Property.findById(req.params.id);
  if (!prop || prop.deletedAt) return res.status(404).json({ error: "not_found" });
  const reason = (req.body || {}).reason || "Listing removed by an administrator";
  await Property.updateOne({ _id: prop._id }, { $set: { deletedAt: new Date(), status: "archived" } });
  const now = new Date();
  const [rr, of, vb] = await Promise.all([
    RentRequest.updateMany({ propertyId: prop._id, status: "pending" }, { $set: { status: "cancelled", cancelledAt: now, declineReason: reason } }),
    Offer.updateMany({ propertyId: prop._id, status: "pending" }, { $set: { status: "declined", decidedAt: now, declineReason: reason } }),
    ViewingBooking.updateMany({ propertyId: prop._id, status: { $in: ["requested", "confirmed"] } }, { $set: { status: "cancelled", cancelledAt: now, cancelledBy: req.user._id, declineReason: reason } }),
  ]);
  notify(prop.ownerId, "listing", "Listing removed", `${prop.title} was removed by an administrator. ${reason}`, { propertyId: prop._id });
  await audit(req, "property.delete", "property", prop._id, `Deleted ${prop.ref}`, { reason, closed: { rentRequests: rr.modifiedCount, offers: of.modifiedCount, viewings: vb.modifiedCount } });
  res.json({ ok: true, closed: { rentRequests: rr.modifiedCount || 0, offers: of.modifiedCount || 0, viewings: vb.modifiedCount || 0 } });
}));

admin.post("/properties/:id/restore", h(async (req, res) => {
  const prop = await Property.findById(req.params.id);
  if (!prop || !prop.deletedAt) return res.status(404).json({ error: "not_found_or_not_deleted" });
  await Property.updateOne({ _id: prop._id }, { $set: { status: "draft" }, $unset: { deletedAt: "" } }); // owner re-submits it for review
  await audit(req, "property.restore", "property", prop._id, `Restored ${prop.ref} as draft`);
  res.json({ ok: true, status: "draft" });
}));

/* ───────────── listing reports ───────────── */
admin.get("/reports", h(async (req, res) => {
  const f = {};
  const status = enumOr(qstr(req.query.status), ["open", "reviewing", "resolved", "dismissed"]);
  if (status) f.status = status;
  if (oid(req.query.propertyId)) f.propertyId = oid(req.query.propertyId);
  const out = await listDocs(PropertyReport, f, req, { sortable: ["createdAt", "resolvedAt"] });
  const props = await Property.find({ _id: { $in: out.data.map((r) => r.propertyId).filter(Boolean) } }).select("title ref slug status").lean();
  const byId = new Map(props.map((p) => [String(p._id), { id: String(p._id), title: p.title, ref: p.ref, slug: p.slug, status: p.status }]));
  const reporters = await liteUsers(out.data.map((r) => r.reporterId));
  out.data = out.data.map((r) => ({ ...r, property: byId.get(String(r.propertyId)) || null, reporter: reporters.get(String(r.reporterId)) || null }));
  res.json(out);
}));

admin.patch("/reports/:id", validate(z.object({ status: z.enum(["reviewing", "resolved", "dismissed"]), archiveProperty: z.boolean().optional() })), h(async (req, res) => {
  const rep = await PropertyReport.findById(req.params.id);
  if (!rep) return res.status(404).json({ error: "not_found" });
  rep.status = req.body.status;
  if (req.body.status !== "reviewing") {
    rep.resolvedBy = req.user._id;
    rep.resolvedAt = new Date();
  }
  await rep.save();
  let archived = false;
  if (req.body.archiveProperty && rep.propertyId) {
    const r = await Property.updateOne({ _id: rep.propertyId, status: { $in: ["published", "pending_review"] } }, { $set: { status: "archived" } });
    archived = r.modifiedCount > 0;
  }
  await audit(req, `report.${rep.status}`, "report", rep._id, `Report marked ${rep.status}`, { archivedProperty: archived });
  res.json({ ok: true, status: rep.status, archivedProperty: archived });
}));

/* ───────────── rent requests ───────────── */
admin.get("/rent-requests", h(async (req, res) => {
  const f = {};
  const status = enumOr(qstr(req.query.status), ["pending", "approved", "declined", "cancelled", "expired"]);
  if (status) f.status = status;
  if (oid(req.query.propertyId)) f.propertyId = oid(req.query.propertyId);
  if (oid(req.query.userId)) f.userId = oid(req.query.userId);
  const q = qstr(req.query.q);
  if (q) f.$or = [{ ref: rx(q) }, { "property.title": rx(q) }, { "guest.name": rx(q) }, { "guest.phone": rx(q) }];
  const out = await listDocs(RentRequest, f, req, { sortable: ["createdAt", "desiredMoveIn", "decidedAt"] });
  const users = await liteUsers(out.data.map((r) => r.userId));
  out.data = out.data.map((r) => ({ ...withoutToken(r), requester: users.get(String(r.userId)) || null }));
  res.json(out);
}));

admin.get("/rent-requests/:id", h(async (req, res) => {
  const r = await RentRequest.findById(req.params.id).lean();
  if (!r) return res.status(404).json({ error: "not_found" });
  const users = await liteUsers([r.userId, r.property?.ownerId]);
  const lease = await Lease.findOne({ rentRequestId: r._id }).select("ref status startDate endDate").lean();
  res.json({ data: { ...withoutToken(r), requester: users.get(String(r.userId)) || null, owner: users.get(String(r.property?.ownerId)) || null, lease } });
}));

admin.post("/rent-requests/:id/decision", h(async (req, res) => {
  const { decision, reason } = req.body || {};
  if (!["approve", "decline", "cancel"].includes(decision)) return res.status(422).json({ error: "decision must be approve|decline|cancel" });
  const rr = await RentRequest.findById(req.params.id);
  if (!rr) return res.status(404).json({ error: "not_found" });
  if (rr.status !== "pending") return res.status(409).json({ error: "not_pending" });
  const prop = await Property.findById(rr.propertyId);
  if (!prop) return res.status(404).json({ error: "property_missing" });

  let leaseId;
  if (decision === "approve") {
    if (!rr.userId) return res.status(422).json({ error: "guest_requests_require_registration" });
    if (await Lease.exists({ propertyId: rr.propertyId, status: "active" })) return res.status(409).json({ error: "active_lease_exists" });
    await RentRequest.updateMany(
      { propertyId: rr.propertyId, status: "pending", _id: { $ne: rr._id } },
      { $set: { status: "declined", declineReason: "Property leased to another tenant", decidedAt: new Date() } }
    );
    rr.status = "approved";
    rr.decidedAt = new Date();
    rr.linkedAt = new Date();
    rr.handledBy = req.user._id;
    await rr.save();
    const startDate = rr.desiredMoveIn;
    const lease = await Lease.create({
      ref: REF("LS"),
      rentRequestId: rr._id,
      propertyId: rr.propertyId,
      tenantId: rr.userId,
      landlordId: prop.ownerId,
      startDate,
      endDate: new Date(startDate.getTime() + rr.leaseMonths * 30 * 864e5),
      monthlyRentRwf: rr.pricing.monthlyRentRwf,
      depositRwf: rr.pricing.depositRwf,
      paymentDay: Math.min(28, Math.max(1, startDate.getUTCDate())),
      status: "draft",
      installments: [],
    });
    leaseId = lease._id;
    notify(rr.userId, "rent_request", "Rental request approved", `Your request for ${prop.title} was approved. Sign the lease to proceed.`, { leaseId });
  } else {
    rr.status = decision === "decline" ? "declined" : "cancelled";
    if (decision === "decline") rr.declineReason = reason || "Not available";
    else rr.cancelledAt = new Date();
    rr.decidedAt = new Date();
    rr.handledBy = req.user._id;
    await rr.save();
    notify(rr.userId, "rent_request", `Rental request ${rr.status}`, `Your request for ${prop.title} was ${rr.status}.${reason ? ` ${reason}` : ""}`, { rentRequestId: rr._id });
  }
  await audit(req, `rent_request.${decision}`, "rent_request", rr._id, `${rr.ref} ${rr.status}`, { reason, leaseId });
  res.json({ ok: true, status: rr.status, leaseId });
}));

/* ───────────── viewing bookings ───────────── */
admin.get("/viewing-bookings", h(async (req, res) => {
  const f = {};
  const status = enumOr(qstr(req.query.status), ["requested", "confirmed", "declined", "cancelled", "completed", "no_show"]);
  if (status) f.status = status;
  if (oid(req.query.propertyId)) f.propertyId = oid(req.query.propertyId);
  if (oid(req.query.userId)) f.userId = oid(req.query.userId);
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  if ((from && !isNaN(from)) || (to && !isNaN(to))) {
    f.scheduledAt = {};
    if (from && !isNaN(from)) f.scheduledAt.$gte = from;
    if (to && !isNaN(to)) f.scheduledAt.$lte = to;
  }
  const q = qstr(req.query.q);
  if (q) f.$or = [{ ref: rx(q) }, { "property.title": rx(q) }, { "guest.name": rx(q) }, { "guest.phone": rx(q) }];
  const out = await listDocs(ViewingBooking, f, req, { sortable: ["createdAt", "scheduledAt"], defSort: "-scheduledAt" });
  const users = await liteUsers(out.data.map((v) => v.userId));
  out.data = out.data.map((v) => ({ ...withoutToken(v), requester: users.get(String(v.userId)) || null }));
  res.json(out);
}));

admin.get("/viewing-bookings/:id", h(async (req, res) => {
  const v = await ViewingBooking.findById(req.params.id).lean();
  if (!v) return res.status(404).json({ error: "not_found" });
  const users = await liteUsers([v.userId, v.property?.ownerId]);
  res.json({ data: { ...withoutToken(v), requester: users.get(String(v.userId)) || null, owner: users.get(String(v.property?.ownerId)) || null } });
}));

const VIEWING_FLOW = {
  confirm: { to: "confirmed", from: ["requested"] },
  decline: { to: "declined", from: ["requested"] },
  cancel: { to: "cancelled", from: ["requested", "confirmed"] },
  complete: { to: "completed", from: ["confirmed"] },
  no_show: { to: "no_show", from: ["confirmed"] },
};
admin.post("/viewing-bookings/:id/decision", h(async (req, res) => {
  const { decision, reason } = req.body || {};
  const step = VIEWING_FLOW[decision];
  if (!step) return res.status(422).json({ error: "decision must be confirm|decline|cancel|complete|no_show" });
  const vb = await ViewingBooking.findById(req.params.id);
  if (!vb) return res.status(404).json({ error: "not_found" });
  if (!step.from.includes(vb.status)) return res.status(409).json({ error: "invalid_transition", from: vb.status });
  vb.status = step.to;
  vb.handledBy = req.user._id;
  if (decision === "confirm" || decision === "decline") vb.respondedAt = new Date();
  if (decision === "decline") vb.declineReason = reason;
  if (decision === "cancel") {
    vb.cancelledBy = req.user._id;
    vb.cancelledAt = new Date();
    if (reason) vb.declineReason = reason;
  }
  if (decision === "complete") vb.completedAt = new Date();
  try {
    await vb.save();
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "slot_taken" }); // another viewing is already confirmed at that time
    throw e;
  }
  if (vb.userId) notify(vb.userId, "viewing", `Viewing ${vb.status}`, `${vb.property?.title} – viewing is ${vb.status.replace("_", " ")}.${reason ? ` ${reason}` : ""}`, { bookingId: vb._id });
  await audit(req, `viewing.${decision}`, "viewing_booking", vb._id, `${vb.ref} ${vb.status}`, { reason });
  res.json({ ok: true, status: vb.status });
}));

/* ───────────── offers (sales) ───────────── */
admin.get("/offers", h(async (req, res) => {
  const f = {};
  const status = enumOr(qstr(req.query.status), ["pending", "accepted", "declined", "countered", "withdrawn", "expired"]);
  if (status) f.status = status;
  if (oid(req.query.propertyId)) f.propertyId = oid(req.query.propertyId);
  if (oid(req.query.userId)) f.userId = oid(req.query.userId);
  const q = qstr(req.query.q);
  if (q) f.$or = [{ ref: rx(q) }, { "property.title": rx(q) }, { "guest.name": rx(q) }, { "guest.phone": rx(q) }];
  const out = await listDocs(Offer, f, req, { sortable: ["createdAt", "offerRwf", "decidedAt"] });
  const users = await liteUsers(out.data.map((o) => o.userId));
  out.data = out.data.map((o) => ({ ...withoutToken(o), requester: users.get(String(o.userId)) || null }));
  res.json(out);
}));

admin.get("/offers/:id", h(async (req, res) => {
  const o = await Offer.findById(req.params.id).lean();
  if (!o) return res.status(404).json({ error: "not_found" });
  const users = await liteUsers([o.userId, o.property?.ownerId]);
  res.json({ data: { ...withoutToken(o), requester: users.get(String(o.userId)) || null, owner: users.get(String(o.property?.ownerId)) || null } });
}));

admin.post("/offers/:id/decision", h(async (req, res) => {
  const { decision, reason, counterOfferRwf } = req.body || {};
  if (!["accept", "decline", "counter", "withdraw"].includes(decision)) return res.status(422).json({ error: "decision must be accept|decline|counter|withdraw" });
  const offer = await Offer.findById(req.params.id);
  if (!offer) return res.status(404).json({ error: "not_found" });
  if (offer.status !== "pending") return res.status(409).json({ error: "not_pending" });
  const prop = await Property.findById(offer.propertyId);
  if (!prop) return res.status(404).json({ error: "property_missing" });

  if (decision === "accept") {
    offer.status = "accepted";
    await Property.updateOne({ _id: prop._id }, { $set: { status: "sold" } });
    await Offer.updateMany({ propertyId: prop._id, _id: { $ne: offer._id }, status: "pending" }, { $set: { status: "declined", declineReason: "Another offer accepted", decidedAt: new Date() } });
  } else if (decision === "decline") {
    offer.status = "declined";
    offer.declineReason = reason || "Not accepted";
  } else if (decision === "withdraw") {
    offer.status = "withdrawn";
  } else {
    if (!Number.isFinite(counterOfferRwf) || counterOfferRwf <= 0) return res.status(422).json({ error: "counter_offer_required" });
    offer.status = "countered";
    offer.counterOfferRwf = counterOfferRwf;
  }
  offer.decidedAt = new Date();
  offer.handledBy = req.user._id;
  await offer.save();
  if (offer.userId) notify(offer.userId, "offer", `Offer ${offer.status}`, `${prop.title} – your offer is now ${offer.status}.`, { offerId: offer._id });
  await audit(req, `offer.${decision}`, "offer", offer._id, `${offer.ref} ${offer.status}`, { reason, counterOfferRwf });
  res.json({ ok: true, status: offer.status });
}));

/* ───────────── leases ───────────── */
admin.get("/leases", h(async (req, res) => {
  const f = {};
  const status = enumOr(qstr(req.query.status), ["draft", "active", "ended", "terminated"]);
  if (status) f.status = status;
  for (const k of ["propertyId", "tenantId", "landlordId"]) if (oid(req.query[k])) f[k] = oid(req.query[k]);
  const q = qstr(req.query.q);
  if (q) f.ref = rx(q);
  const out = await listDocs(Lease, f, req, { sortable: ["createdAt", "startDate", "endDate"] });
  const users = await liteUsers(out.data.flatMap((l) => [l.tenantId, l.landlordId]));
  out.data = out.data.map((l) => ({ ...l, tenant: users.get(String(l.tenantId)) || null, landlord: users.get(String(l.landlordId)) || null }));
  res.json(out);
}));

admin.get("/leases/:id", h(async (req, res) => {
  const l = await Lease.findById(req.params.id).lean();
  if (!l) return res.status(404).json({ error: "not_found" });
  const users = await liteUsers([l.tenantId, l.landlordId]);
  const prop = await Property.findById(l.propertyId).select("title ref slug status").lean();
  res.json({ data: { ...l, tenant: users.get(String(l.tenantId)) || null, landlord: users.get(String(l.landlordId)) || null, property: prop } });
}));

admin.post("/leases/:id/terminate", validate(z.object({ reason: z.string().trim().min(3).max(500) })), h(async (req, res) => {
  const l = await Lease.findById(req.params.id);
  if (!l) return res.status(404).json({ error: "not_found" });
  if (!["draft", "active"].includes(l.status)) return res.status(409).json({ error: "not_terminable", status: l.status });
  l.status = "terminated";
  l.terminatedReason = req.body.reason;
  await l.save();
  for (const uid of [l.tenantId, l.landlordId]) notify(uid, "lease", "Lease terminated", `Lease ${l.ref} was terminated by an administrator: ${req.body.reason}`, { leaseId: l._id });
  await audit(req, "lease.terminate", "lease", l._id, `Terminated ${l.ref}`, { reason: req.body.reason });
  res.json({ ok: true, status: l.status });
}));

/* ───────────── payments ───────────── */
admin.get("/payments", h(async (req, res) => {
  const f = {};
  const status = enumOr(qstr(req.query.status), ["pending", "succeeded", "failed", "refunded"]);
  if (status) f.status = status;
  const purpose = enumOr(qstr(req.query.purpose), ["security_deposit", "rent", "platform_fee", "sale_deposit"]);
  if (purpose) f.purpose = purpose;
  const method = enumOr(qstr(req.query.method), ["mtn_momo", "airtel_money", "card", "bank_transfer", "cash"]);
  if (method) f.method = method;
  for (const k of ["payerId", "leaseId", "offerId", "rentRequestId"]) if (oid(req.query[k])) f[k] = oid(req.query[k]);
  const out = await listDocs(Payment, f, req, { sortable: ["createdAt", "paidAt", "amountRwf"] });
  const users = await liteUsers(out.data.map((p) => p.payerId));
  out.data = out.data.map((p) => ({ ...p, payer: users.get(String(p.payerId)) || null }));
  res.json(out);
}));

admin.get("/payments/:id", h(async (req, res) => {
  const p = await Payment.findById(req.params.id).lean();
  if (!p) return res.status(404).json({ error: "not_found" });
  const users = await liteUsers([p.payerId]);
  res.json({ data: { ...p, payer: users.get(String(p.payerId)) || null } });
}));

/** manual correction: pending -> failed, succeeded -> refunded. This records the status only; it does not move money. */
admin.post("/payments/:id/status", validate(z.object({ status: z.enum(["failed", "refunded"]), reason: z.string().trim().max(500).optional() })), h(async (req, res) => {
  const p = await Payment.findById(req.params.id);
  if (!p) return res.status(404).json({ error: "not_found" });
  const { status, reason } = req.body;
  const allowed = (status === "failed" && p.status === "pending") || (status === "refunded" && p.status === "succeeded");
  if (!allowed) return res.status(409).json({ error: "invalid_transition", from: p.status, to: status });
  p.status = status;
  if (status === "failed") p.failureReason = reason || "Marked failed by an administrator";
  if (status === "refunded") p.refundedAt = new Date();
  await p.save();
  notify(p.payerId, "payment", `Payment ${status}`, `Your payment of RWF ${p.amountRwf.toLocaleString("en-US")} is ${status}.${reason ? ` ${reason}` : ""}`, { paymentId: p._id });
  await audit(req, `payment.${status}`, "payment", p._id, `Payment ${status}`, { reason, amountRwf: p.amountRwf });
  res.json({ ok: true, status: p.status });
}));

/* ───────────── announcements (notifications to many users) ───────────── */
const broadcastSchema = z.object({
  audience: z.enum(["all", "tenant", "landlord", "agent", "admin", "users"]),
  userIds: z.array(z.string()).max(1000).optional(),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(2).max(1000),
});
admin.post("/notifications", validate(broadcastSchema), h(async (req, res) => {
  const { audience, userIds, title, body } = req.body;
  const filter = { status: "active", deletedAt: { $exists: false } };
  if (audience === "users") {
    const ids = (userIds || []).filter((i) => Types.ObjectId.isValid(i));
    if (!ids.length) return res.status(422).json({ error: "userIds_required" });
    filter._id = { $in: ids };
  } else if (audience !== "all") {
    filter.role = audience;
  }
  const users = await User.find(filter).select("_id").limit(10000).lean();
  if (!users.length) return res.status(404).json({ error: "no_recipients" });
  await Notification.insertMany(users.map((u) => ({ userId: u._id, type: "system", title, body, data: { announcement: true } })));
  await audit(req, "notification.broadcast", "notification", undefined, `Sent "${title}" to ${users.length} user(s)`, { audience, recipients: users.length });
  res.status(201).json({ ok: true, recipients: users.length });
}));

/* ───────────── agencies ───────────── */
const agencySchema = z.object({
  name: z.string().trim().min(2).max(120),
  logoUrl: z.string().url().optional(),
  description: z.string().max(2000).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().optional(),
  website: z.string().url().optional(),
  districtId: z.string().optional(),
  verified: z.boolean().optional(),
});
admin.post("/agencies", validate(agencySchema), h(async (req, res) => {
  const { verified, ...rest } = req.body;
  const base = rest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "agency";
  let slug = base;
  while (await Agency.exists({ slug })) slug = `${base}-${nanoid(4).toLowerCase()}`;
  const doc = await Agency.create({ ...rest, slug, verifiedAt: verified ? new Date() : undefined });
  await audit(req, "agency.create", "agency", doc._id, `Created agency ${doc.name}`);
  res.status(201).json({ data: doc });
}));

admin.patch("/agencies/:id", validate(agencySchema.partial()), h(async (req, res) => {
  const agency = await Agency.findById(req.params.id);
  if (!agency) return res.status(404).json({ error: "not_found" });
  const { verified, ...rest } = req.body;
  Object.assign(agency, rest);
  if (verified !== undefined) agency.verifiedAt = verified ? agency.verifiedAt || new Date() : undefined;
  await agency.save();
  await audit(req, "agency.update", "agency", agency._id, `Updated agency ${agency.name}`, req.body);
  res.json({ data: agency });
}));

admin.delete("/agencies/:id", h(async (req, res) => {
  const agency = await Agency.findById(req.params.id);
  if (!agency) return res.status(404).json({ error: "not_found" });
  await Property.updateMany({ agencyId: agency._id }, { $unset: { agencyId: "" } });
  await Agency.deleteOne({ _id: agency._id });
  await audit(req, "agency.delete", "agency", agency._id, `Deleted agency ${agency.name}`);
  res.json({ ok: true });
}));

/* ───────────── delete records (hard delete) ─────────────
 * Used by the admin dashboard's Delete buttons. Records that other data depends on are protected:
 * anything with payments attached is refused, and so is a lease that is still active. */
async function hardDelete(req, res, Model, auditAction, targetType, guards = async () => null) {
  const doc = await Model.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: "not_found" });
  const blocked = await guards(doc);
  if (blocked) return res.status(409).json({ error: blocked });
  await Model.deleteOne({ _id: doc._id });
  await audit(req, auditAction, targetType, doc._id, `Deleted ${doc.ref}`, { status: doc.status });
  res.json({ ok: true });
}
admin.delete("/viewing-bookings/:id", h((req, res) => hardDelete(req, res, ViewingBooking, "viewing.delete", "viewing_booking")));
admin.delete("/offers/:id", h((req, res) =>
  hardDelete(req, res, Offer, "offer.delete", "offer", async (o) => ((await Payment.exists({ offerId: o._id })) ? "has_payments" : null))));
admin.delete("/rent-requests/:id", h((req, res) =>
  hardDelete(req, res, RentRequest, "rent_request.delete", "rent_request", async (r) => {
    if (await Lease.exists({ rentRequestId: r._id })) return "has_lease";
    if (await Payment.exists({ rentRequestId: r._id })) return "has_payments";
    return null;
  })));
admin.delete("/leases/:id", h((req, res) =>
  hardDelete(req, res, Lease, "lease.delete", "lease", async (l) => {
    if (l.status === "active") return "lease_active";
    if (await Payment.exists({ leaseId: l._id })) return "has_payments";
    return null;
  })));

/* ───────────── image upload (admin) ─────────────
 * The browser sends the raw image bytes with Content-Type image/jpeg|png|webp (max 8 MB).
 * The file type is checked from the file's own bytes, not from its name, and the file is saved under a random name. */
const UPLOAD_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}
admin.post("/uploads", express.raw({ type: Object.keys(UPLOAD_TYPES), limit: "8mb" }), h(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ error: "unsupported_image" });
  const kind = sniffImage(req.body);
  if (!kind) return res.status(422).json({ error: "invalid_image" });
  const name = `${Date.now()}-${nanoid(12)}.${UPLOAD_TYPES[kind]}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), req.body);
  const base = (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  res.status(201).json({ url: `${base}/uploads/${name}`, name, bytes: req.body.length });
}));

app.use("/api/admin", admin);

function coverUrl(prop) {
  const img = prop.images?.find((i) => String(i._id) === String(prop.coverImageId)) || prop.images?.[0];
  return img?.cardUrl || img?.url || "";
}

function publicCard(p) {
  return {
    id: String(p._id),
    ref: p.ref,
    slug: p.slug,
    title: p.title,
    mode: p.mode,
    propertyType: p.propertyType,
    priceRwf: p.priceRwf,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    areaSqm: p.areaSqm,
    district: p.location?.district,
    province: p.location?.province,
    neighbourhood: p.location?.neighbourhood,
    coverUrl: coverUrl(p),
    coverAlt: p.title,
    tag: p.isFeatured ? "Featured" : p.isVerified ? "Verified" : null,
    ownerName: p.ownerName,
    publishedAt: p.publishedAt,
    isFeatured: p.isFeatured,
    stats: { saves: p.stats?.saves ?? 0 },
  };
}

function publicDetail(p) {
  return {
    ...publicCard(p),
    description: p.description ? String(p.description).split(/\n{2,}/).filter(Boolean) : [],
    depositMonths: p.depositMonths,
    minLeaseMonths: p.minLeaseMonths,
    availableFrom: p.availableFrom,
    furnishing: p.furnishing,
    yearBuilt: p.yearBuilt,
    parkingSpaces: p.parkingSpaces,
    amenities: (p.amenities || []).map((a) => a.label),
    nearby: (p.nearby || []).map((n) => ({ label: n.label, distance: `${n.travelMinutes} min ${n.travelMode}` })),
    gallery: (p.images || []).filter((i) => i.kind === "photo").map((i) => i.cardUrl || i.url),
    image: coverUrl(p),
    location: publicLocation(p),
    floorPlans: (p.images || []).filter((i) => i.kind === "floor_plan").map((i) => i.url),
    ownerId: String(p.ownerId),
    status: p.status,
  };
}

/** listings with hideExactLocation get their pin rounded to a ~1 km grid and flagged, so the exact spot is never sent to visitors */
function publicLocation(p) {
  const pt = p.location?.point;
  const hide = !!p.location?.hideExactLocation;
  if (!pt?.coordinates?.length) return { point: undefined, approximate: hide };
  if (!hide) return { point: pt, approximate: false };
  const round = (n) => Math.round(n * 100) / 100;
  return { point: { type: "Point", coordinates: pt.coordinates.map(round) }, approximate: true };
}

function isOwnListing(req, prop) {
  return !!req.user && (String(prop.ownerId) === String(req.user._id) || (prop.agentId && String(prop.agentId) === String(req.user._id)));
}

function publicRentRequest(rr) {
  return {
    id: String(rr._id),
    ref: rr.ref,
    status: rr.status,
    property: rr.property,
    desiredMoveIn: rr.desiredMoveIn,
    leaseMonths: rr.leaseMonths,
    occupants: rr.occupants,
    pricing: rr.pricing,
    createdAt: rr.createdAt,
    decidedAt: rr.decidedAt,
    declineReason: rr.declineReason,
  };
}

function publicOffer(o) {
  return {
    id: String(o._id),
    ref: o.ref,
    status: o.status,
    property: o.property,
    offerRwf: o.offerRwf,
    askingPriceRwf: o.askingPriceRwf,
    counterOfferRwf: o.counterOfferRwf,
    paymentMethod: o.paymentMethod,
    createdAt: o.createdAt,
    decidedAt: o.decidedAt,
    declineReason: o.declineReason,
  };
}

function publicBooking(v) {
  return {
    id: String(v._id),
    ref: v.ref,
    status: v.status,
    property: v.property,
    scheduledAt: v.scheduledAt,
    durationMinutes: v.durationMinutes,
    visitors: v.visitors,
    createdAt: v.createdAt,
    decidedAt: v.respondedAt || v.cancelledAt || v.completedAt,
    declineReason: v.declineReason,
  };
}

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}


app.use((_req, res) => res.status(404).json({ error: "not_found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  req.log?.error?.({ err }, "unhandled_error");
  if (err.name === "ValidationError") return res.status(422).json({ error: "validation_failed", message: err.message });
  if (err.name === "CastError") return res.status(422).json({ error: "invalid_id" });
  if (err.code === 121 || /failed validation/i.test(err.message || "")) {
    // MongoDB collection validator rejected the document: expose which rule failed (dev only)
    console.error("[db] document failed validation:", JSON.stringify(err.errInfo?.details ?? err.message, null, 2));
    return res.status(500).json({
      error: "document_validation_failed",
      ...(NODE_ENV !== "production" && { detail: "Document failed validation", rules: err.errInfo?.details }),
    });
  }
  if (err.type === "entity.too.large") return res.status(413).json({ error: "file_too_large" });
  if (err.code === 11000) return res.status(409).json({ error: "duplicate_key", keyValue: err.keyValue });
  if (err.name === "JsonWebTokenError") return res.status(401).json({ error: "invalid_token" });
  if (err.message === "Not allowed by CORS") return res.status(403).json({ error: "cors" });
  res.status(500).json({ error: "internal_error", ...(NODE_ENV !== "production" && { detail: err.message, rules: err.errInfo?.details }) });
});

/* ═══════════════════════════════════════════════════════════
 *  START
 *  ═══════════════════════════════════════════════════════════ */
async function start() {
  await mongoose.connect(MONGODB_URI, { autoIndex: NODE_ENV !== "production" });
  console.log("[boot] Server.js build: uploads-1 (admin image uploads + delete routes)");
  console.log(`[db] connected ${MONGODB_URI.replace(/\/\/[^@]+@/, "//***@")}`);
  const server = app.listen(PORT, () => console.log(`[http] listening on :${PORT} (${NODE_ENV})`));

  const shutdown = async (signal) => {
    console.log(`[shutdown] ${signal}`);
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (require.main === module) {
  start().catch((e) => {
    console.error("Failed to start:", e);
    process.exit(1);
  });
}

module.exports = { app, start };