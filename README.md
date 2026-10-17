# Codebase Explainer AI

> **Dissect, understand, trace, and audit any GitHub repository using Gemini AI and grounded code retrieval.**

Codebase Explainer AI is a full-stack developer tool designed to eliminate the ramp-up time required to understand unfamiliar software projects. By pasting any public GitHub repository URL, the engine ingests real repository data, parses dependencies, generates interactive architecture diagrams, visualizes execution flows, surfaces security flaws and code smells, and answers technical questions with exact source code citations.

---

## 🌟 Key Features

- **Real Repository Ingestion**: Fetches actual repository trees, commits, and source code files via the GitHub REST API with pagination, rate-limit handling, and file filtering.
- **Evidence-Grounded Explanations**: Answers to architectural and code questions cite actual file paths and line ranges (`[path/to/file:L10-L40]`). Zero fabricated files or fake explanations.
- **Interactive Architecture Visualizer**: Automatically maps frontend, backend, database, and API layers into interactive **Mermaid.js** diagrams with zoom, pan, and SVG export.
- **Request & Execution Flow Tracing**: Step-by-step lifecycle tracing showing how requests traverse from entry points (`index.ts`, `main.py`, `App.tsx`) through routes and internal services.
- **Security & Quality Audits**: Surfaces potential bugs, security vulnerabilities (SSRF, hardcoded secrets, injection vectors), code smells, and missing tests with severity tags and remediations.
- **Integrated Source Code Viewer**: Syntax-highlighted code viewer with line numbers and instant citation jump-links.
- **Dynamic Language & Framework Detection**: Autodetects TypeScript, JavaScript, Python, Go, Rust, React, Next.js, Express, FastAPI, Django, Flask, Docker, and more.
- **Safe Sandboxing & Filtering**: Automatically excludes binary assets, dependency directories (`node_modules`, `vendor`, `.venv`), build outputs, lockfiles, and redacts sensitive credentials.
- **Official Google Gen AI SDK Integration**: Configurable Gemini model (`gemini-2.5-flash`, `gemini-1.5-pro`) with streaming support and rule-based fallback if no API key is provided.

---

## 🛠 Technology Stack

### Frontend
- **Framework**: React 18 with TypeScript and Vite
- **Styling**: Tailwind CSS with sleek developer dark theme
- **Icons**: Lucide React
- **Diagrams**: Mermaid.js
- **Syntax Highlighting**: Prism.js
- **Routing**: React Router DOM 6
- **State Management**: TanStack Query (React Query)
- **Testing**: Vitest & React Testing Library with jsdom

### Backend
- **Runtime**: Node.js 26 / TypeScript
- **Server**: Express.js with Helmet security headers & CORS
- **Rate Limiting**: `express-rate-limit`
- **Validation**: Zod (strict request & schema validation)
- **AI Engine**: Official `@google/generative-ai` SDK
- **Retrieval Engine**: In-memory BM25 / TF-IDF token indexer & chunker
- **Testing**: Vitest & Supertest for REST API testing

---

## 🚀 Quick Start & Setup

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **npm**: v9.0.0 or higher
- **Gemini API Key**: (Optional for AI generation; free from [Google AI Studio](https://aistudio.google.com/app/apikey))

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/shubhammundkar/apexhackathon.git
cd apexhackathon

# Install dependencies across all workspaces (root, shared, backend, frontend)
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Edit `.env` with your settings:
```ini
# Server Port
PORT=3001
HOST=0.0.0.0
NODE_ENV=development

# Gemini AI API Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash

# Optional: GitHub Personal Access Token (Increases rate limit from 60 req/hr to 5,000 req/hr)
GITHUB_TOKEN=

# Ingestion Limits
MAX_REPO_FILES=500
MAX_FILE_SIZE_BYTES=300000
MAX_TOTAL_REPO_BYTES=25000000
CHUNK_SIZE_LINES=120
CHUNK_OVERLAP_LINES=20
```
> **Note:** If `GEMINI_API_KEY` is not provided in `.env`, users can still input their key securely in the UI **Settings modal** (stored only in their browser session), or use the rule-based static analyzer.

### 3. Build Shared Package
```bash
npm run build --workspace=shared
```

### 4. Start Development Servers
You can run both backend and frontend concurrently or independently:

**Terminal 1 (Backend API):**
```bash
npm run dev:backend
# Starts Express server on http://localhost:3001
```

**Terminal 2 (Frontend Client):**
```bash
npm run dev:frontend
# Starts Vite dev server on http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser!

---

## 🧪 Testing & Verification

The test suite includes 24 automated tests covering unit logic, integration tests, file filtering, regex security, and a live verification test against the public GitHub API:

```bash
# Run all tests across backend and frontend
npm test

# Run backend tests only
npm run test:backend

# Run frontend tests only
npm run test:frontend

# Run live GitHub repository ingestion verification test
npm run test --workspace=backend -- tests/liveVerification.test.ts

# Run TypeScript typechecks across all packages
npm run typecheck
```

---

## 📡 REST API Documentation

### Health & Diagnostics
- `GET /api/health`
  - Returns server status, timestamp, and sanitized configuration summary (never exposes secrets or keys).

### Ingestion & Analysis
- `POST /api/repositories/analyze`
  - **Body**: `{ "url": "https://github.com/owner/repo", "apiKey"?: string, "branch"?: string, "model"?: string }`
  - Initiates asynchronous background ingestion and indexing.
  - Returns: `{ "jobId": "...", "repositoryId": "owner/repo" }` (HTTP 202 Accepted).

- `GET /api/jobs/:jobId`
  - Returns live progress percentage (0-100%), stage name, files indexed, and warnings.

- `POST /api/jobs/:jobId/cancel`
  - Cancels an in-flight ingestion job immediately.

### Repository Content & Analysis
- `GET /api/repositories/:owner/:repo`
  - Returns metadata, stars, language stats, and file counts.

- `GET /api/repositories/:owner/:repo/files`
  - Returns the hierarchical recursive file tree.

- `GET /api/repositories/:owner/:repo/files/content?path=...`
  - Returns source file content, detected language, line count, and parsed exports/imports/functions.

- `GET /api/repositories/:owner/:repo/analysis`
  - Returns full structured analysis (Overview, Mermaid diagram, Execution Flows, Findings, Dependencies).

### Grounded AI Q&A
- `POST /api/repositories/:owner/:repo/questions`
  - **Body**: `{ "question": "...", "filePath"?: string, "apiKey"?: string }`
  - Retrieves top BM25 code chunks and queries Gemini.
  - Returns: `{ "question": "...", "answer": "...", "citations": [{ "filePath": "...", "startLine": 10, "endLine": 35, "snippet": "..." }] }`

---

## 🛡 Security & Design Principles

1. **Grounded Citations**: The AI is instructed strictly with retrieved code chunks and instructed never to invent non-existent APIs or files. Every response cites real file locations.
2. **SSRF Defense**: Accepts only `github.com` URLs; blocks external SSRF targets and path traversal attempts (`../`).
3. **Secret Redaction**: Source files are scanned and common secret patterns (Google AI keys, AWS keys, GitHub tokens, RSA private keys) are redacted to `[REDACTED_SECRET]` before storage or context indexing.
4. **Zero Key Leakage**: Server API keys are never returned in client responses, logs, or diagnostic payloads.
5. **Rate Limiting & Bounded Concurrency**: Express rate limiter prevents API abuse, and file ingestion uses bounded concurrency queues (6 parallel requests) to avoid overwhelming networks.

---

## 📄 License
MIT