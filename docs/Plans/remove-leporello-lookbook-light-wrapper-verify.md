# Verify — Remove Leporello and lighten the Lookbook wrapper

## Acceptance criteria evidence

- AC1–AC3: repository search over product source (excluding docs/tests) returns no `Leporello` or `leporello` references. Dedicated component, studio CSS, workspace utility, test file, node registry entries, and desktop IPC were removed.
- AC4–AC5: `CompactIdentityCardNode.tsx` retains image/empty states and wrapper state semantics; `nodeflow.css` keeps the 320 × 320 footprint and implements a 244 × 244 shallow paper stack with flat front cover.
- AC6 partial:
  - `git diff --check`: pass.
  - isolated Lookbook suite: 14/14 pass via esbuild + Node test runner.
  - `npm run build`: pass.
  - `npm run typecheck`: blocked by unrelated existing errors in GitHub tool response typing, project deletion worker environment typing, multimodal service response typing, and pre-existing FlowSurface clipboard nullability.
  - full `npm test`: first run compiled and reached 228/229 with one local assertion mismatch; that assertion was corrected and passes in isolation. A second run was then blocked during compilation by a concurrent unrelated `FlowProject.name` test fixture error.

## Platform checks

- Web/App shared Lookbook wrapper: covered by the same React/CSS implementation.
- Electron: Leporello preload methods, IPC handlers, temporary sketch generation, and session cleanup are absent.

## Compatibility impact

Historical projects containing a Leporello node are no longer accepted by the current NodeFlow type contract. No automatic migration is provided.

## Rollback

Restore the deleted Leporello feature slice and revert the NodeFlow registry/type removals. Revert the Lookbook component/CSS independently if only the visual treatment needs rollback.
