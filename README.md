# Stylo

Stylo is a canvas-first creative workspace for script writing, project archives, identity assets, and AI-assisted image production.

The current product is no longer related to Google AI Studio. The application now centers on two independent layers:

- `Canvas`: the infinite spatial support layer for viewport, zoom, pan, selection, rendering, and visual organization
- `Flow`: the creative node-and-link layer that spans script writing, project archives, foundation structure, and AIGC image/video workflows
- `Stylo Agent`: a single general-purpose project agent built on `@openai/agents`

## What The App Does

- Import and organize project/script data
- Build visual creative flows on the infinite canvas
- Organize script documents, archive documents, and production nodes in one Flow graph
- Run image, video, audio, and reference-based generation flows
- Use `Stylo Agent` to collaborate across the same graph world:
  - read project archive facts
  - edit durable flow resources
  - operate the visible creative flow
- Persist project state locally, with optional cloud sync

## Core Architecture

Stylo no longer treats reading, editing, and operating as actions over unrelated business modules.

The project now revolves around a two-layer architecture:

- `Canvas`
  - the spatial support system
  - owns viewport, zoom, pan, selection, background, rendering, and hit testing
  - should not understand script writing, identity assets, or generation semantics
- `Flow`
  - the creative node system
  - owns nodes, links, documents, foundation axes, approvals, and agent operations
  - contains script documents as one node/document type rather than a top-level app mode

In tool terms, the runtime aims to stay aligned to three atomic actions:

- `read`
  - unified graph reading across Flow resources
- `edit`
  - durable Flow resource mutation for project archives and foundation blocks
- `operate`
  - visible Flow graph mutation

The public tool protocol is now intentionally graph-shaped instead of module-shaped:

- `read`
  - `list_project_resources`
  - `read_project_resource`
  - `search_project_resource`
  - uses `layer / entity / view`
  - reads `node / link / map / approval`
- `edit`
  - `edit_script_resource`
  - writes durable project archive entities inside Flow
- `operate`
  - `operate_project_resource`
  - uses `entity / action`
  - operates only `Flow` graph entities
  - current atomic actions:
    - node: `create / update / move / remove`
    - link: `connect / unlink`

All three now converge on a shared output shape:

- `target`
- `layer`
- `entity`
- `artifact`

So the agent is no longer switching between unrelated tool worlds. It is acting inside one shared graph world with different planes and mutation boundaries.

This means the agent and the user are no longer modeled as working in separate systems.

They collaborate around the same central `Canvas + Flow` world:

- the Canvas layer provides the infinite spatial workspace
- the Flow layer provides creative documents, nodes, and relationships
- the agent reads, edits, and operates the same Flow graph the user sees

## Current Runtime Stack

- Frontend: React 18 + TypeScript + Vite
- Styling: Tailwind CSS 4
- Canvas/workflow: `@xyflow/react`, `konva`, `zustand`
- Agent runtime: `@openai/agents`
- Auth: Clerk
- Cloud persistence: Cloudflare Pages Functions + D1
- Asset upload helpers: Supabase Storage signed upload URLs

## Model And Provider Paths

Stylo currently supports multiple model/provider lanes depending on the task:

- Agent/chat: `Qwen` or `OpenRouter`
- Image and multimodal text generation: OpenAI-compatible or provider-specific endpoints configured in-app
- Voice and audio flows: `Qwen`
- Video generation: `Seedance`, `Vidu`, plus other service-specific paths already wired in the codebase

Most provider keys can be supplied either:

- through environment variables
- through the in-app settings panels for local use

## Local Development

### Prerequisites

- Node.js 22.12+
- npm

### Install

```bash
npm install
```

### Run

```bash
npm run dev
```

### Build

```bash
npm run build
```

## Minimal Local Config

Projects are always tied to an authenticated cloud account. If
`VITE_CLERK_PUBLISHABLE_KEY` is missing, the app shows a configuration gate;
it does not create a separate guest or local-only project.

Frontend environment variables must never contain provider secrets. The supported local frontend variables are:

```bash
VITE_CLERK_PUBLISHABLE_KEY=
VITE_API_BASE=
```

Notes:

- `Qwen` is the default primary route for the current agent and several media flows.
- `OpenRouter` is supported as an alternate agent/chat path.
- `VITE_API_BASE` is useful when the frontend runs locally but `/api/*` should hit a deployed Cloudflare Pages backend.
- For BYOK development, enter the provider key in project settings. Shared provider keys belong only in Pages Functions secrets listed below. Vite exposes every `VITE_*` value to the browser bundle, so `VITE_*_API_KEY` variables are intentionally unsupported.

## Cloud Sync And Backend

Stylo projects use authenticated cloud sync backed by Cloudflare Pages Functions and D1.

### Frontend env

```bash
VITE_CLERK_PUBLISHABLE_KEY=
VITE_API_BASE=
```

### Pages Functions env

```bash
CLERK_SECRET_KEY=
CLERK_JWT_KEY=
SECRETS_ENCRYPTION_KEY=

QWEN_API_KEY=
DASHSCOPE_API_KEY=
OPENAI_API_KEY=
OPENROUTER_API_KEY=

OPENAI_TRACING_API_KEY=
AGENT_TRACE_INCLUDE_SENSITIVE_DATA=false

SUPABASE_SECRET_KEY=
```

`SECRETS_ENCRYPTION_KEY` is required when API-key sync is enabled. It must decode to exactly 32 random bytes (for example, generate one with `openssl rand -base64 32`) and must be stored only as a Cloudflare Pages secret. Existing plaintext `user_secrets` rows are migrated to an AES-256-GCM envelope with per-record random IVs and user-bound authenticated data on first access; the endpoint fails closed when the key is missing or invalid.

### Wrangler-managed vars

This project uses `wrangler.toml` for non-secret Pages variables. Add plain-text values such as `SUPABASE_URL` under `[vars]` in `wrangler.toml`, not in the Cloudflare dashboard secret editor.

```toml
[vars]
SUPABASE_URL = "https://<project-ref>.supabase.co"
```

Notes:

- Keep `SUPABASE_SECRET_KEY` in Cloudflare Pages secrets.
- Mirror `SUPABASE_SECRET_KEY` to the `stylo-project-deletion` Worker. The
  Worker consumes bounded, idempotent Storage cleanup jobs; the secret is never
  embedded in a queue message.
- `SUPABASE_SERVICE_ROLE` is still supported by the code for backward compatibility, but `SUPABASE_SECRET_KEY` is the preferred current name.
- Asset uploads expect Supabase Storage buckets `public-assets` and `assets` to exist.
  `assets` must be private, limited to 64 MiB per object, and allow only the
  image/audio/video/PDF MIME types accepted in `functions/api/upload-url.ts`.
  `public-assets` is reserved for avatars and provider review images; keep it
  public, image-only, and limited to 20 MiB. The bucket limits are the
  authoritative enforcement for signed uploads and must match the API policy.

### Required bindings

- D1 binding name: `DB`

Database schema changes are deployment-time migrations, never request-time DDL. Apply them before deploying Functions:

```bash
npx wrangler d1 migrations apply stylo --remote
```

For local D1 development, use the same command with `--local`. The migration files live in `migrations/` and are the authoritative schema.

## Main Backend Surfaces

- `functions/api/agent.ts`: edge agent runtime over `@openai/agents`
- `functions/api/project-realtime.ts`: authenticated multi-device realtime project channel
- `functions/api/realtime-ticket.ts`: short-lived one-time WebSocket ticket issuer
- `realtime-worker/`: project-scoped Yjs Durable Object coordinator
- `project-deletion-worker/`: recoverable queue consumer for permanent,
  project-scoped object-storage deletion
- `functions/api/project.ts`: authenticated read-only projection of the realtime document
- `functions/api/projects.ts`: authenticated cloud-project catalog
- `functions/api/upload-url.ts`: Supabase signed upload URL helper

Cloud project authorities are isolated by `(user_id, project_id)`. D1 project,
Agent, trace, and generated-asset rows carry an explicit `project_id`; Supabase
objects live below `users/{user_id}/projects/{project_id}/`. Migration `0003`
intentionally clears pre-scope development project data while preserving account
profiles and encrypted secrets. Migration `0007` removes the retired snapshot/CAS
tables; project content is written only through the Yjs realtime room.
- `functions/api/download-url.ts`: Supabase download URL helper

## Product Structure

- `App.tsx`: top-level application shell
- `node-workspace/components/CreativeWorkspace.tsx`: central `Flow` workspace
- `node-workspace/components/StyloAgent.tsx`: embedded project agent UI
- `node-workspace/components/ProjectSettingsPanel.tsx`: project settings, assets, ability, sync, labs, and runtime configuration
- `agents/`: Stylo agent runtime, unified graph tools, memory, bridge, and guardrails

## Repo Status

The product, source namespace, GitHub repository, Cloudflare Pages project, and active D1 database are `Stylo`/`stylo`.

Compatibility readers intentionally remain for existing browser storage, Agent sessions, desktop bridge clients, and `.qalam` project packages. New state and exports are written with the Stylo namespace.

The existing production hostname remains `node-qalam.pages.dev` because Cloudflare Pages does not support changing a project's assigned `*.pages.dev` subdomain in place. The hostname is treated as a legacy transport coordinate rather than product branding; use a Stylo custom domain when one is available.
