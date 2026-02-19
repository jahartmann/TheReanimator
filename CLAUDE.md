# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Reanimator** is a Proxmox infrastructure management and disaster recovery platform built with Next.js. It provides centralized monitoring, configuration backups, VM/container migration, bulk operations, and an AI-powered agent for managing Proxmox environments and generic Linux servers — all agentless via SSH.

## Build & Development Commands

```bash
npm run dev          # Run migrations + start Next.js dev server
npm run build        # Run migrations + build production bundle
npm run start        # Run migrations + start production server
npm run lint         # ESLint
npm run migrate      # Database schema migration only
```

Scripts in `scripts/`: `reset-admin.js` (reset admin password), `update-roles.js` (role management).

No test suite exists — there are no test scripts, test configs, or test directories.

## Architecture

### Tech Stack
- **Next.js 16** (App Router, React 19, TypeScript)
- **Tailwind CSS 4** + Shadcn UI (new-york style, Lucide icons, Framer Motion)
- **better-sqlite3** (WAL mode, auto-migrations via `scripts/migrate.js`)
- **ssh2** for agentless server communication (SSH + SFTP)
- **Vercel AI SDK** + **ollama-ai-provider** for the AI agent
- **next-intl** for i18n (de, en, es, fr, ru)

### Key Patterns

**Server Actions (no REST API):** All backend logic uses Next.js Server Actions (`'use server'`) in `src/lib/actions/`. Client components call these directly — there is no separate API layer except for a few streaming endpoints under `src/app/[locale]/api/`.

**Agentless SSH:** All server management happens over SSH. The SSH client (`src/lib/ssh.ts`) handles connection pooling, keepalive, and both key-based and password auth. Proxmox API calls (`src/lib/proxmox.ts`) go over HTTPS with SSL bypass for self-signed certs.

**Database as config store:** Settings (AI config, SMTP, Telegram token, SSH keys) are stored in the `settings` table of the SQLite DB at `data/proxhost.db`. No `.env` file is used for app configuration.

**Internationalization:** All routes are under `src/app/[locale]/`. Translation files are in `src/messages/{locale}.json`. Use `getTranslations()` server-side.

### Core Modules

| Module | Path | Purpose |
|--------|------|---------|
| Server Actions | `src/lib/actions/*.ts` (33 files) | All business logic (VMs, backups, monitoring, migrations, etc.) |
| AI Agent | `src/lib/agent/core.ts` | Streaming async generator with tool execution (50+ tools) |
| Agent Tools | `src/lib/agent/tools.ts` | Infrastructure automation tools with `<<<TOOL:Name:{"args"}>>>` syntax |
| AI Context | `src/lib/ai/context.ts` | System prompt builder for the agent |
| Proxmox Client | `src/lib/proxmox.ts` | Proxmox REST API wrapper |
| SSH Client | `src/lib/ssh.ts` | SSH/SFTP connection management |
| Database | `src/lib/db.ts` | SQLite setup (WAL, foreign keys, prepared statements) |
| Scheduler | `src/lib/scheduler.ts` | Cron jobs for backups, scans, stats |
| Backup Logic | `src/lib/backup-logic.ts` | Config backup orchestration (/etc, /root/.ssh, crontabs) |
| Notifications | `src/lib/notifications/` | SMTP + Telegram alerting |
| Telegram Bot | `src/lib/agent/telegram.ts` | Remote management via Telegram |

### Startup Sequence (`src/instrumentation.ts`)
1. Start cron scheduler (backups, network analysis, node stats)
2. Initialize Telegram bot listener
3. Trigger infrastructure scan

### Authentication
Session-based auth with HTTP-only cookies. Middleware (`src/middleware.ts`) checks sessions on all non-public routes. Default credentials: `admin/admin` (force change on first login). RBAC via `users`, `roles`, `permissions` tables.

### AI Agent
- Ollama-based (configurable model/URL in settings)
- `MAX_TURNS=5` for multi-step tool execution
- Brain system: persistent knowledge in `data/brain/` (Markdown files)
- Blocked commands: `rm -rf`, `dd`, `mkfs`, `reboot`, `shutdown` (safety filtering)
- Context extraction: auto-detects serverId/vmId from conversation

### Runtime Data
`data/` directory (gitignored): SQLite DB, config backups, AI brain files. Requires write access.

## Path Aliases

`@/*` maps to `./src/*` (configured in tsconfig.json).

## Shadcn UI

Style: `new-york`, RSC-enabled. Add components via `npx shadcn@latest add <component>`. Components land in `src/components/ui/`.
