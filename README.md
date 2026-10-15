# Fastify TypeScript Backend

A production-ready Fastify backend starter built with TypeScript, structured for scalability, type safety, and high performance.

## 🚀 Features

- **Runtime & Language**: Node.js + TypeScript
- **Framework**: [Fastify](https://fastify.dev/) v5
- **ORM & Database**: [TypeORM](https://typeorm.io/) + PostgreSQL (with connection pooling)
- **Validation & Env**: [Zod](https://zod.dev/) + [dotenv](https://github.com/motdotla/dotenv)
- **Security**: `@fastify/helmet` & `@fastify/cors`
- **Error Handling**: `@fastify/sensible`
- **Request Logging**: `morgan` (with customizable formats like `dev`, `combined`, etc.)
- **Development**: `nodemon` watcher with `tsx` execution
- **Production Build**: `tsc` emitting clean ESM to `dist/`

---

## 📁 Project Structure

```
backend-fast/
├── src/
│   ├── config/
│   │   └── env.ts           # Type-safe environment variables with Zod
│   ├── database/
│   │   ├── data-source.ts   # TypeORM DataSource instance
│   │   └── entities/
│   │       └── user.entity.ts # User entity model
│   ├── plugins/
│   │   ├── sensible.ts      # HTTP error helpers
│   │   ├── cors.ts          # CORS configuration
│   │   ├── morgan.ts        # Morgan HTTP request logger
│   │   └── typeorm.ts       # TypeORM Fastify plugin
│   ├── routes/
│   │   ├── health/
│   │   │   └── index.ts     # Health checks (/health, /health/db)
│   │   ├── api/
│   │   │   └── v1/
│   │   │       └── index.ts # API v1 routes (/users, /db-time, /hello)
│   │   └── root.ts          # Route aggregator
│   ├── app.ts               # App factory (registers plugins & routes)
│   └── server.ts            # Server entry point with graceful shutdown
├── .env.local               # Local development environment variables
├── .env.prod                # Production environment variables
├── .env.example             # Example environment template
├── .gitignore
├── nodemon.json             # Nodemon watcher configuration
├── tsconfig.json
└── package.json
```

---

## 🛠 Getting Started

### 1. Installation

```bash
npm install
```

### 2. Environment Configuration

- **Development (`.env.local`)**:
  ```env
  DB_HOST=localhost
  DB_PORT=5432
  DB_USER=rithikgoyal
  DB_PASSWORD=
  DB_NAME=fastify_db_dev
  DB_SSL=false
  DB_SYNC=true
  DB_LOG=true
  ```

- **Production (`.env.prod`)**:
  ```env
  DATABASE_URL=postgresql://user:password@host:5432/dbname
  DB_SSL=false
  DB_SYNC=false
  DB_LOG=false
  ```

### 3. Development Server

Start the development server with Nodemon (loads `.env.local`):

```bash
npm run dev
# or
npm run dev:local
```

### 4. Build & Production Run

```bash
# Build TypeScript
npm run build

# Start production server (loads .env.prod)
npm run start:prod
```

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Service overview & status |
| `GET` | `/health` | Health status and DB connectivity check |
| `GET` | `/health/db` | Detailed database metadata & version |
| `GET` | `/api/v1/db-time` | Query server time via TypeORM |
| `GET` | `/api/v1/users` | List all users from database |
| `POST` | `/api/v1/users` | Create a new user (`name`, `email`) |
| `GET` | `/api/v1/hello?name=...` | Sample GET greeting endpoint |
| `POST` | `/api/v1/echo` | Sample POST endpoint echoing JSON payload |


---

## 🔐 Authentication

Users sign in with a **phone number** (code by SMS or WhatsApp), an **email** (code by email), or **Google / Apple / Facebook**. Everything is configured at runtime from the admin panel, with no redeploy needed.

### Admin panel

1. Create an admin: `npm run admin:create -- --username zeus --password 'at-least-10-chars'` (run it again to reset a password).
2. Open `http://localhost:3000/admin` and sign in.

From the panel you can turn each login method on or off, and set the OTP policy (length, expiry, attempts, resend cooldown, hourly cap). You also enter the SSO client IDs and the delivery provider credentials there, add fixed-code **test accounts** for App Store / Play Store review, and send test messages. Provider secrets are encrypted in the database (`CONFIG_ENCRYPTION_KEY`) and are never returned by the API. Set `ADMIN_PANEL_ENABLED=false` to turn the panel and its API off.

**Environment variables.** Every setting has an **Env** button that reads it from a server environment variable instead of a saved value, e.g. `AUTH_DELIVERY_TWILIO_AUTH_TOKEN=…`. Secrets read this way never reach the database. Names must start with `AUTH_`, so the panel can't expose unrelated server secrets such as `JWT_SECRET`. Booleans accept `true/false/1/0`; lists such as client IDs are comma-separated. If a variable is missing or invalid, the saved value is used and the status check says why. Environment changes are picked up within 15 seconds; a restart is only needed to change the process environment itself.

**Status.** The Overview shows whether each login method works, and if not, why: a missing field, a missing env variable, a Console-only provider, or credentials the provider rejects. **Run live check** contacts SMTP, Twilio, the WhatsApp Cloud API, Facebook and Google/Apple's key servers (`GET /api/admin/settings/auth/status?live=true`). Google and Apple don't let servers validate client IDs, so test a real sign-in for those.

| Channel | Providers |
|---|---|
| Email | Console (log only), SMTP (works with SES, SendGrid, Postmark, Gmail…) |
| SMS | Console, Twilio |
| WhatsApp | Console, Twilio (Content SID template), Meta WhatsApp Cloud API (authentication template) |

Outside production every code is `DEFAULT_OTP` and is returned as `data.otp`. In production codes are random, stored as an HMAC, and never returned.

### App flow

1. `GET /api/v1/auth/config`: which methods are on, phone channels, OTP length, and the public Google/Apple/Facebook IDs. Build the login screen from this.
2. Sign in with either:
   - **OTP**: `POST /auth/send-otp` with `{ phoneNumber, channel?: "sms" | "whatsapp" }` or `{ email }`, then `POST /auth/verify-otp` with the same identifier and `otp`.
   - **SSO**: sign in with the provider's native SDK, then `POST /auth/sso/:provider` (`google`, `apple`, `facebook`) with `{ idToken }`. For Facebook classic login, send `{ accessToken }`. Optional: `nonce` (raw), and `name` (Apple only shares it on first sign-in).
3. Both return either `isNewUser: false` with `user` + `tokens`, or `isNewUser: true` with a `tempToken`, a `suggestedUsername` and, after SSO, a `prefill` of `{ name, email }`.
4. New users finish with `POST /auth/complete-profile` with `{ tempToken, name, age, username?, email? }`.

**Account linking:** a Google/Apple sign-in whose *verified* email matches a user's *verified* email signs into that user (this can be switched off). Facebook emails are never trusted for linking. An email-OTP login never opens an account whose email was typed in but not verified.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/auth/config` | public |
| `POST` | `/api/v1/auth/send-otp` | 10/min per IP; cooldown and hourly cap per identifier |
| `POST` | `/api/v1/auth/verify-otp` | 20/min per IP; code burns after `maxAttempts` wrong guesses |
| `POST` | `/api/v1/auth/sso/:provider` | 20/min per IP |
| `POST` | `/api/v1/auth/complete-profile` | |
| `POST` | `/api/v1/auth/refresh-token`, `/logout` · `GET` `/me`, `/activity` | logout revokes the access token immediately |
| `POST` | `/api/admin/auth/login` | admin token (separate from user tokens) |
| `GET` / `PUT` | `/api/admin/settings/auth` | secrets: `""` keeps, `null` clears; `envRefs: { "<setting path>": "AUTH_…" }` |
| `GET` | `/api/admin/settings/auth/status` | per-method health; `?live=true` contacts providers |
| `POST` | `/api/admin/settings/auth/test-delivery` | `{ channel, to }` |
| `GET` | `/api/admin/overview` | user and delivery counts |

**Production database:** with `DB_SYNC=false`, apply the schema changes yourself: `users."phoneNumber"` becomes nullable, plus a new `users."emailVerified"` column and the `verification_codes`, `auth_identities`, `app_settings` and `admin_users` tables. The old `otps` table is no longer used.

---

## 🖼 Albums, S3 Image Uploads & Sharing

Users collect images into **albums**, add **friends** by username, and share albums via **public links**. Image bytes go straight from the app to S3 using presigned POSTs, so they never pass through this server. Images are served through CloudFront.

### Upload flow (swipe to select)

The app shows gallery images one at a time. Swipe **right** to select an image and swipe **left** to skip it. Only the selected images are sent, in the order they were picked.

1. `POST /api/v1/albums/:albumId/uploads` with `{ "files": [{ "fileName", "contentType", "sizeBytes" }] }`. The response has one `{ imageId, upload: { url, fields } }` per file.
2. For each file, `POST` a `multipart/form-data` body to `upload.url`: every entry of `upload.fields` first, then the image as `file` (last). S3 enforces the key, content type and size limit.
3. `POST /api/v1/albums/:albumId/uploads/complete` with `{ "imageIds": [...] }`. The server checks S3 and returns `uploaded` and `failed` lists. Failed images can be retried while their upload URL is still valid.

Allowed types: JPEG, PNG, WebP, HEIC/HEIF, GIF and AVIF. The defaults are 20 MB per image and 50 images per batch (`UPLOAD_MAX_BYTES`, `UPLOAD_MAX_FILES`).

### Endpoints (all require `Authorization: Bearer <accessToken>` except `/shared`)

| Method | Path | Who |
|---|---|---|
| POST / GET | `/api/v1/albums` | any user (create / list owned and shared albums) |
| GET / PATCH / DELETE | `/api/v1/albums/:albumId` | viewer / editor / owner |
| POST | `/api/v1/albums/:albumId/uploads` and `/uploads/complete` | editor |
| PUT | `/api/v1/albums/:albumId/images/order` with `{ imageIds }` (the full new order) | editor |
| DELETE | `/api/v1/albums/:albumId/images/:imageId` | editor |
| GET / POST | `/api/v1/albums/:albumId/members` with `{ username, role: "viewer" \| "editor" }` | viewer / owner |
| PATCH / DELETE | `/api/v1/albums/:albumId/members/:userId` | owner (members can remove themselves to leave) |
| POST / GET | `/api/v1/albums/:albumId/share-links` with optional `{ expiresInHours }` | editor |
| DELETE | `/api/v1/albums/:albumId/share-links/:linkId` | editor |
| GET | `/api/v1/shared/:token` | **public**, no login |

### AWS setup

- **S3 bucket**: keep it private (Block Public Access on). If a *web* client will upload, add a CORS rule that allows `POST` from your origin. Native apps don't need CORS.
- **CloudFront**: use the bucket as the origin with Origin Access Control, and set `CDN_BASE_URL` to the distribution URL.
- **Signed CDN URLs (optional)**: create a CloudFront key group, enable *Restrict viewer access* on the distribution, and set `CLOUDFRONT_KEY_PAIR_ID` and `CLOUDFRONT_PRIVATE_KEY`. Image URLs then expire after `CDN_URL_TTL_SECONDS`. Without this, image URLs are unguessable but permanent.
- **IAM**: the server needs `s3:PutObject`, `s3:GetObject` (for HeadObject) and `s3:DeleteObject` on `arn:aws:s3:::<bucket>/albums/*`.
