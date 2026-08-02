# Cloud sync audit — 2026-07-29

Continued and production-verified on 2026-07-31.

## Scope

This audit separates three authorities that were previously conflated:

1. Account project catalog: which projects exist and their display metadata.
2. Per-project realtime document: the project's complete materialized content.
3. Read projection: D1 JSON used by HTTP, public profile, and Agent readers.

## High-severity findings fixed

### Project existence depended on content projection

`GET /api/projects` previously listed `user_project_documents`. A new or empty
project did not exist on another device until its realtime room completed a
projection. Switching projects during the first handshake could therefore make
the earlier project permanently absent from the cloud catalog.

Fix: `user_project_catalog` is now the account-level authority. Project
creation/metadata changes publish an event-triggered catalog manifest, while
the Durable Object also refreshes the row when project content is projected.
Catalog tombstones prevent a stale device from reviving a deleted ID.

An account-level hibernating WebSocket now broadcasts catalog invalidations.
Devices that are already open discover project creation, deletion, and reset
without polling and without requiring a reload.

### Non-canvas content was account-global

Only `flow`, roles, and design assets were retained per `FlowProject`.
Screenplay text, episodes, canvas viewport, token usage, and statistics were
stored only in the active top-level view. Switching projects could mix this
data, and an inactive remote project could not merge it correctly.

Fix: every `FlowProject` now owns those fields. The top-level `ProjectData`
fields remain a compatibility view of the active project.

### Project capacity disagreed across layers

The account UI allowed 24 projects, while normalization and cloud validation
silently capped the list at 3.

Fix: both boundaries now enforce 24.

Realtime, signed-upload, signed-download, and object-deletion gateways also
require a catalog admission. Guessing arbitrary project IDs can no longer
allocate unbounded Durable Objects or object-store prefixes outside the account
limit.

### CRDT history could grow without an epoch boundary

Checkpointing removed append rows but retained Yjs tombstones forever. Reset
also cleared a map inside the old document, allowing stale structural history
to survive.

Fix: the room uses an epoch. When no WebSocket is connected and history is at
least 768 KB and 3x the materialized document, it rebuilds a canonical Y.Doc
and increments the epoch. Reset always creates a fresh document and epoch.
Clients atomically persist `(epoch, checkpoint)` and reject stale-epoch writes.
Clients also retain the last server-confirmed checkpoint and perform a
three-way semantic rebase. An offline field survives a server history rebase
without replaying a complete stale snapshot over unrelated remote edits.

### Client-declared project size was trusted too far

The server bounded the declared project size, but a buggy or hostile owner
client could under-report it and leave projection permanently failing.

Fix: the room keeps material and pending byte accounting and materializes a
candidate document near the limit before acknowledging the update.

The WebSocket gateway now rejects an oversized raw frame before `JSON.parse`
and applies per-socket message/byte budgets. This closes the cheapest
memory/CPU amplification path available to a modified authenticated client.

### Project switching could abandon the first upload

React cleanup closed the old project socket immediately, including while its
initial snapshot was waiting for the server handshake.

Fix: a detached engine drains pending/initial changes for up to eight seconds,
while stale callbacks are fenced from the newly active project.

### Runtime media refresh created phantom edits

Private Supabase URLs were refreshed by writing the new signed URL back into
node data. Merely opening a project therefore looked like an authored change
and could keep the sync indicator active.

Fix: image, audio, video, PDF, Lookbook, and Leporello surfaces resolve signed
URLs into component runtime state. Refreshed credentials are never written to
the Yjs project. Lookbook/Leporello/audio imports now upload bytes into the
project-scoped object store instead of persisting `data:` URLs that the cloud
projection intentionally removes.

### The private asset bucket was public in production

The application treated Supabase `assets` as private and issued short-lived
download URLs, but the production bucket itself had `public = true`. Anyone
who learned an object path could therefore bypass Stylo's account/project
authorization and fetch the asset directly.

Fix: production `assets` is now private. Its bucket-level limit is 64 MiB and
its MIME allow-list covers the image, audio, video, and PDF formats the app
accepts. `public-assets` remains public only for avatars and provider review
images, with a 20 MiB limit and an image-only MIME allow-list.

The upload-signing endpoint now also requires the declared file size, applies
the same MIME/size policy before minting a token, and rate-limits signing per
account/project. The bucket limit remains the authoritative defense against a
client that lies about `fileSize`.

### Reset deleted the project directory authority

A normal content reset deleted `user_project_catalog` together with the
project document. Other devices could temporarily lose the project, and its
return depended on a client reconnecting and re-admitting the ID.

Fix: content reset retains the catalog row. Only permanent project deletion or
a full account wipe removes it. A full account wipe writes all former project
tombstones atomically and retains them, so an offline stale device cannot
resurrect erased projects later.

### Realtime connection and supply-chain amplification

Authenticated clients could create unbounded sockets and repeatedly force a
full initial Yjs state transfer. Rooms now cap account-catalog connections,
owner edit connections, per-viewer connections, and total room connections in
addition to the existing raw-frame and message/byte rate limits.

Production dependency vulnerabilities were reduced to zero. Exact overrides
pin the MCP HTTP adapter, body parser, and URI parser to patched versions. The
remaining npm audit findings are confined to Electron packaging's development
dependency graph; npm's proposed `--force` remedy downgrades
`electron-builder`, so it was not applied to production code.

### Project discovery had no live account channel

Project content was realtime, but the list of projects was fetched only during
application mount. An already-open second device could not discover a new
project created elsewhere.

Fix: `AccountCatalogRoom` is a separate Durable Object keyed only by the
authenticated user. Catalog writes, project deletion, and reset publish a tiny
invalidation event; clients then read the canonical D1 catalog. The channel is
server-push only and contains no project payload.

### Browser WebSocket authentication exposed a reusable session credential

Browser WebSockets cannot attach an `Authorization` header, so the client put
the short-lived Clerk session JWT into `Sec-WebSocket-Protocol`. Pages removed
it before forwarding to a Durable Object, but an infrastructure access log or
handshake diagnostic could still capture a credential reusable across the
account until its normal expiry.

Fix: an authenticated HTTP request now mints a cryptographically random,
30-second connection ticket. D1 stores only its SHA-256 digest. The ticket is
bound to one canonical realtime route and its project/public-view parameters,
then consumed with one atomic `UPDATE ... WHERE consumed_at IS NULL RETURNING`
during the WebSocket handshake. It cannot be replayed, moved to another
project, or used as an account API bearer credential. Issuance is rate-limited
per account and unknown/duplicate query parameters fail closed.

## Remaining performance and integrity risks

1. The server still accepts opaque Yjs updates from an authenticated owner and
   validates encoding, epoch, material size, room identity, and rate, but does
   not perform a complete application-schema validation before ACK. A modified
   client can corrupt its own project shape and make projection fail. A future
   protocol should validate typed mutation envelopes at the room boundary or
   quarantine invalid generations.
2. A remote update still materializes and normalizes the full project in the
   React client before applying it. The wire operation is incremental, but CPU
   cost is O(project size). More typed adapters are needed for text/data edits,
   node/link creation, and deletion.
3. D1 is deliberately a full JSON read projection. Continuous edits are
   debounced, but each projection serializes the full project. Large projects
   should eventually split searchable/read-model data from the Yjs authority.
4. Permanent deletion recursively lists and removes object storage during one
   request. A project with many assets can exceed an HTTP lifetime. Production
   hardening should move deletion to an idempotent background workflow with a
   visible tombstone state.
5. Provider-generated media URLs that were never ingested into Stylo storage
   still depend on the provider's retention policy. User-uploaded core media
   now uses project storage; generated outputs need the same ingestion policy.
6. Bucket limits bound a single object, and the signing endpoint bounds request
   rate, but there is no authoritative per-account total-byte quota yet. Add a
   post-upload ledger/webhook and quota reservation protocol before offering
   high storage allowances or untrusted public signup at scale.
7. Connection tickets remove reusable Clerk JWTs from WebSocket handshakes.
   Their D1 issuance/consume path adds a small fixed connection-establishment
   cost; monitor ticket rejection and D1 write latency before substantially
   increasing per-account connection limits.

## Incremental action path

Node position and measurement changes publish a typed geometry mutation.
The realtime engine applies it directly to the target Yjs node. The normal
normalized snapshot remains the validation and recovery fallback, while the
wire update contains only the touched geometry and is coalesced during a drag.

Other mutations continue to use the existing field-level Yjs snapshot adapter.
Additional action adapters should be added for node text/data changes, node
create/delete, and link create/delete only after their action contracts are
made explicit.

## Deployment order

1. Apply D1 migrations through `0010_realtime_connection_tickets.sql`.
2. Deploy the realtime Worker.
3. Deploy the Pages application/functions.

Deploying the Worker before the migration would make D1 projection retries fail
until the catalog table exists.

## Production verification — 2026-07-31

- Applied remote D1 migrations `0008` and `0009`; no migrations remain.
- Deployed realtime Worker version
  `f77fd099-5314-4e19-bfd9-02612d703aee` with both Durable Object bindings.
- Deployed Pages/Functions at `https://b08712be.node-qalam.pages.dev` and the
  production alias returned HTTP 200 during post-deploy verification.
- Remote D1 catalog backfill contains 2 catalog rows for 2 projected documents;
  the check was read-only and did not inspect project payloads.
- Production unauthenticated `/api/projects` returns HTTP 401.
- Supabase security and performance advisors reported no error/warning-level
  findings; only informational no-policy tables (server-only RLS-denied data)
  and currently-unused indexes.

## Realtime ticket rollout — 2026-08-01

- Applied remote D1 migration `0010_realtime_connection_tickets.sql`; no
  migrations remain pending.
- Deployed the scoped one-time ticket gateway and browser client as production
  Pages deployment `1f2391c0-10cc-4cf2-98fa-7704800ebc39` at
  `https://1f2391c0.node-qalam.pages.dev`.
- The production alias returned HTTP 200 after deployment.
- An unauthenticated ticket request returned HTTP 401, confirming that ticket
  issuance is behind the normal account authentication boundary.
- A read-only D1 verification found no unconsumed live tickets after the
  deployment checks.

## Validation

- Full test suite: 230 passed.
- Vite production build: passed.
- Realtime Worker strict targeted typecheck: passed.
- Sync/Pages Functions strict targeted typecheck: passed.
- Wrangler Worker dry-run: passed.
- All nine D1 migrations applied successfully to an isolated local database.
- Production dependency audit (`npm audit --omit=dev`): zero vulnerabilities.
- Production D1 migration state at the time of the July deployment: current
  through `0009`; apply `0010` before deploying the ticket-based gateways.

Repository-wide strict typecheck still contains unrelated pre-existing errors
in GitHub/media response parsing and Flow edge selection code. The changed sync
and Worker modules pass targeted strict checks.

## Consistency incident follow-up — 2026-08-01

Production testing exposed three additional failure modes that can account for
visible edits disappearing or a project remaining in `Connection interrupted`:

1. React committed a local edit before the passive sync effect staged it. A
   remote WebSocket event arriving in that interval projected the remote scoped
   project over the visible local project. The hook now stages at the layout
   boundary, and the engine force-materializes any staged local snapshot before
   applying a remote update.
2. Unacknowledged edits lived in the Yjs checkpoint but did not have an explicit
   durable client outbox. A renderer crash inside the checkpoint/localStorage
   debounce window could therefore lose the only actionable operation. Every
   operation is now assigned an id and written to IndexedDB before it is sent.
   Startup replays that outbox ahead of the separately debounced UI snapshot.
3. A rejected Durable Object initialization promise was cached permanently for
   that in-memory object lifetime. A transient D1/storage error could therefore
   make one project fail every reconnect. Failed initialization is now logged,
   uncached, and retryable. Stored checkpoint/update sequence invariants are
   checked while rebuilding the room.

The client now permits only one operation awaiting ACK at a time; later local
updates remain coalesced in the durable outbox and are released after the ACK.
This removes ACK reordering as a state-deletion hazard. Superseded WebSockets
cannot deliver messages or close the replacement connection. Application-level
`ping`/`pong` uses the Durable Object hibernation auto-response path, so it can
detect half-open transports without waking the room or polling/uploading idle
project content. Connection limits and broadcasts count only `OPEN` sockets,
not stale sockets still completing a close handshake.

New failure-injection coverage verifies pre-remote local staging, crash/outbox
recovery, persist-before-send ordering, single-flight ACK behavior, and stale
socket isolation. Ticket coverage additionally verifies canonical scoping,
route-confusion rejection, and exactly-once consumption. The full suite now
contains 230 tests.
