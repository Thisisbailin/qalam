# Reflect — DeepSeek Responses Agent Unification

## What failed or nearly failed

- The repository-wide strict typecheck is already blocked by unrelated provider response values inferred as `unknown`; the migration itself compiles under the test configuration and production build.
- Importing runtime provider configuration directly into the settings surface created a circular manual-chunk warning. The UI keeps a small display-time normalization while browser and edge execution share the single authoritative runtime resolver.
- The former DeepSeek compatibility implementation mixed transport conversion, reasoning replay, and model defaults. Leaving any part of it would have preserved an accidental second pipeline.

## Three concrete improvements next time

1. Add schema validators at every external provider `response.json()` boundary so strict TypeScript upgrades cannot turn unrelated integrations into a repository-wide baseline failure.
2. Move provider identity/model metadata into a dependency-light domain module that both UI and runtime can import without crossing manual chunk boundaries.
3. Add a credential-free contract fixture that replays representative DeepSeek Responses SSE events through the SDK stream projector, alongside the current model-class and source architecture tests.

## Lessons appended to context memory

- API-format compatibility is not enough to assume stateful Responses features; session ownership must be checked explicitly.
- Model availability must be enforced at the server/runtime boundary, with UI and persisted-config normalization treated as defense in depth.
- Removing a provider fork includes its session maintenance path and generated prompt artifacts, not only its request adapter.
