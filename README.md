<div align="center">

# Doc Intelligence

**AI-powered document intelligence with RAG — upload documents, ask questions, get cited answers.**

[![Live App](https://img.shields.io/badge/Live_App-View_Now-6366f1?style=for-the-badge&logo=vercel)](https://documentintelligenceplatform.vercel.app)

[*https://documentintelligenceplatform.vercel.app*](https://documentintelligenceplatform.vercel.app)

</div>

---

## Overview

Doc Intelligence is a full-stack application that lets you upload documents, chunk and embed them, and query them via a RAG (Retrieval-Augmented Generation) pipeline. It includes workspace and team management, role-based access, and optional Hugging Face or Groq backends for embeddings and LLM.

**Stack:** .NET 9 (API), Next.js 16 (web), PostgreSQL + pgvector, Redis, Supabase Storage, Hugging Face / Groq.

---

## Screenshots

<div align="center">

<img src="assets/signin.png" alt="Doc Intelligence – Sign in screen" width="800" />

<br/><br/>

<img src="assets/chat.png" alt="Doc Intelligence – Chat over documents" width="800" />

<br/><br/>

<img src="assets/fillchat.png" alt="Doc Intelligence – Filled chat conversation" width="800" />

<br/><br/>

<img src="assets/admin.png" alt="Doc Intelligence – Admin analytics dashboard" width="800" />

</div>

---

## Features

- **Document upload & ingestion** — PDF/document upload, chunking, and vector embeddings
- **RAG chat** — Ask questions over your documents with source citations
- **Workspaces** — Organize documents by workspace; multi-tenant support
- **Team & roles** — Invite members, Owner / Admin / Member roles, invite codes
- **Admin dashboard** — Usage stats, questions per day, document counts
- **Rate limiting** — Per-user upload limits (e.g. 3/min, 20/hr, 50/day) when Redis is configured

---

## Prerequisites

- **.NET 9 SDK** — [Download](https://dotnet.microsoft.com/download)
- **Node.js 20+** and npm — [Download](https://nodejs.org/)
- **PostgreSQL** with **pgvector** (e.g. Supabase, local Postgres)
- **Redis** (optional; for rate limiting; e.g. Upstash)
- **Supabase** account (storage bucket for documents)
- **Hugging Face** and/or **Groq** API keys (embeddings and LLM)

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/Asjadfaroq/document-intelligence-platform.git
cd document-intelligence-platform
```

### 2. Configure environment variables

Create a `.env` file in the **repository root** (same level as the solution file). Both the API and the Next.js app use this file for local development.

See **[Environment variables](#environment-variables)** below for the full list and how to obtain each value.

### 3. Run the backend

```bash
# From repository root — load .env and run API
set -a && source .env && set +a   # Linux/macOS
# Or on Windows (PowerShell): Get-Content .env | ForEach-Object { ... }

cd DocumentIntelligence.Api
dotnet run
```

The API runs at **http://localhost:5224** (or the port shown in the console).

### 4. Run the frontend

```bash
# From repository root
cd document-intelligence-web
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

### 5. Apply database migrations (first time)

From the repository root:

```bash
cd DocumentIntelligence.Api
dotnet ef database update --project ../DocumentIntelligence.Infrastructure
```

(Requires `dotnet-ef` tool and connection string in `.env`.)

---

## Environment variables

Use these in your root `.env` file. **Do not commit real secrets.** Use placeholders and fill them with your own values.

### Frontend (Next.js)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_BASE_URL` | Yes | Backend API base URL. Local: `http://localhost:5224`. Production: your deployed API URL (e.g. `https://your-api.onrender.com`). |

### Backend — Database & cache

| Variable | Required | Description |
|----------|----------|-------------|
| `ConnectionStrings__Default` | Yes | PostgreSQL connection string. Must support **pgvector**. Example shape: `Host=...;Port=5432;Database=...;Username=...;Password=...;Ssl Mode=Require;` (Supabase or any Postgres + pgvector). |
| `ConnectionStrings__Redis` | No | Redis connection URL (e.g. Upstash). If omitted, rate limiting is disabled. |

### Backend — Authentication (JWT)

| Variable | Required | Description |
|----------|----------|-------------|
| `Jwt__Secret` | Yes | Secret key for signing JWT tokens. Use a long, random string (e.g. 64+ chars). |
| `Jwt__AccessTokenExpirationMinutes` | No | Access token lifetime in minutes (default e.g. 15). |
| `Jwt__RefreshTokenExpirationDays` | No | Refresh token lifetime in days (default e.g. 7). |
| `Jwt__ClockSkewSeconds` | No | Clock skew for token validation (default e.g. 30). |

### Backend — Supabase (storage)

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Your Supabase project URL (e.g. `https://xxxx.supabase.co`). |
| `SUPABASE_ANON_KEY` | Yes | Supabase anonymous (public) key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-side only; keep secret). |
| `SUPABASE_BUCKET` | Yes | Storage bucket name used for uploaded documents (e.g. `documents`). |

### Backend — Embeddings & LLM

| Variable | Required | Description |
|----------|----------|-------------|
| `EMBEDDING_PROVIDER` | Yes | Embedding provider: `huggingface`. |
| `LLM_PROVIDER` | Yes | LLM provider: `huggingface` or `groq`. |
| `HUGGINGFACE_API_KEY` | Yes (if using Hugging Face) | Hugging Face API token. |
| `HUGGINGFACE_EMBEDDING_MODEL` | Yes | Model id (e.g. `sentence-transformers/all-MiniLM-L6-v2`). |
| `EMBEDDING_DIMENSION` | Yes | Embedding size (e.g. `384` for MiniLM-L6). |
| `HUGGINGFACE_LLM_MODEL` | If LLM = huggingface | Hugging Face LLM model id. |
| `GROQ_API_KEY` | If LLM = groq | Groq API key. |
| `GROQ_MODEL` | If LLM = groq | Groq model name (e.g. `llama-3.3-70b-versatile`). |

### Backend — Production (CORS)

For production, allow your frontend origin so the browser can call the API:

| Variable | Required (production) | Description |
|----------|------------------------|-------------|
| `CORS__AllowedOrigins__0` | Yes | First allowed origin (e.g. `https://documentintelligenceplatform.vercel.app`). Add more as `CORS__AllowedOrigins__1`, etc. if needed. |

### Example `.env` template (no real values)

```env
# Frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:5224

# Database & cache
ConnectionStrings__Default="Host=YOUR_HOST;Port=5432;Database=YOUR_DB;Username=YOUR_USER;Password=YOUR_PASSWORD;Ssl Mode=Require;Trust Server Certificate=true;"
ConnectionStrings__Redis=redis://default:YOUR_REDIS_PASSWORD@YOUR_REDIS_HOST:6379

# JWT
Jwt__Secret=YOUR_LONG_RANDOM_JWT_SECRET
Jwt__AccessTokenExpirationMinutes=15
Jwt__RefreshTokenExpirationDays=7
Jwt__ClockSkewSeconds=30

# Supabase
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_BUCKET=documents
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Embeddings & LLM
EMBEDDING_PROVIDER=huggingface
LLM_PROVIDER=groq
HUGGINGFACE_API_KEY=your_hf_token
HUGGINGFACE_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384
GROQ_API_KEY=your_groq_key
GROQ_MODEL=llama-3.3-70b-versatile
```

---

## Project structure

```
├── DocumentIntelligence.Api/          # ASP.NET Core API
├── DocumentIntelligence.Application/ # CQRS, handlers, interfaces
├── DocumentIntelligence.Domain/       # Entities, domain logic
├── DocumentIntelligence.Infrastructure/ # EF Core, LLM clients, Redis, Supabase
├── document-intelligence-web/        # Next.js frontend
├── .env                               # Local env (create from template; do not commit)
├── Dockerfile                         # Docker build for API (e.g. Render)
└── README.md
```

---

## Deployment

- **Frontend:** Connect the repo to [Vercel](https://vercel.com); set `NEXT_PUBLIC_API_BASE_URL` to your API URL.
- **Backend:** Build with the included `Dockerfile` (e.g. [Render](https://render.com) as a Web Service). Configure the same environment variables in the host’s dashboard (no `.env` in production). Set `CORS__AllowedOrigins__0` to your Vercel (or frontend) URL.

---

## License

This project is provided as-is for learning and portfolio use.

---

<div align="center">

**Developed by [Asjad Farooq](https://linkedin.com/in/asjadfarooqconnect)**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-Asjad_Farooq-0a66c2?style=flat-square&logo=linkedin)](https://linkedin.com/in/asjadfarooqconnect)  
[![GitHub](https://img.shields.io/badge/GitHub-Asjadfaroq-24292e?style=flat-square&logo=github)](https://github.com/Asjadfaroq)

</div>
