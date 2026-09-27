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
