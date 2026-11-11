# UrugoLink — Rwanda property marketplace prototype

A responsive Next.js starter for a Rwanda-focused property marketplace. The included UI is a front-end prototype with sample data; it is not yet connected to a live database, authentication, messaging, maps, payments, or a property verification service.

## Included
- Rent / Buy search tabs
- Keyword, district, property type and budget filtering
- Responsive property cards and detail modal
- Save/favourite interaction (client state only)
- Landlord marketing section
- PostgreSQL Prisma schema for the next backend phase

## Requirements
- Node.js 18.17+
- npm
- PostgreSQL database for backend development

## Run locally
```bash
npm install
npm run dev
```
Open http://localhost:3000.

## Add the database
1. Create a PostgreSQL database named `urugolink`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`.
3. Install Prisma: `npm install prisma @prisma/client`
4. Run `npx prisma generate`
5. Run `npx prisma migrate dev --name init`

## Suggested implementation sequence
1. Authentication and role-based authorization (CUSTOMER, LANDLORD, ADMIN).
2. Property CRUD with landlord ownership checks.
3. Admin moderation: PENDING -> APPROVED before public display.
4. Cloud image upload and validation.
5. Search API with pagination, district, listing type, property type and price filters.
6. Inquiry and messaging endpoints with participant authorization.
7. Viewing bookings and notifications.
8. Rental / sale offers and contract records.
9. Payment provider integration only after legal, security and provider requirements are confirmed.
10. Audit logs, rate limiting, backups, monitoring and privacy policy.

## Important production notes
- Never store plain-text passwords. Use a maintained password hashing library (Argon2id or bcrypt).
- Enforce authorization on the server for every landlord/customer/admin operation.
- Validate all user input on the server and use parameterized database access through Prisma.
- Do not treat a listing as verified merely because a user selected a checkbox. Build an evidence-based admin verification process.
- Do not collect or store payment card details directly. Use a reputable payment provider and verify provider webhooks.
- The sample listing photos are remote Unsplash URLs and sample property data. Replace them with owner-authorized images and verified listing information before launch.
- This prototype is not a legal, title-verification, valuation, escrow or payment service.
