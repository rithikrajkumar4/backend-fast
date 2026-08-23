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

