# Plan — Remove Leporello and lighten the Lookbook wrapper

## Architecture intent

Delete the feature vertically across UI, domain types, graph projection, and desktop adapter so no dead integration seam remains. Keep Lookbook data and behavior stable; isolate the visual change to its canvas component and CSS.

## Work breakdown

1. Remove Leporello files, types, factories, registry entries, creation options, wrapper projection logic, and desktop sketch IPC.
2. Refactor the Lookbook canvas cover into the same title / paper stack / footer composition used by Manus.
3. Replace hardcover depth with two shallow paper layers and transform-only hover/open motion.
4. Update source-structure regression tests and run the full verification suite.

## Verification plan

- Repository search for Leporello runtime references.
- TypeScript strict typecheck.
- Full Node test suite.
- Vite production build.
- `git diff --check` and scoped status review.

## Rollback points

- Leporello removal can be reverted as one vertical feature slice.
- Lookbook visual changes are isolated to `CompactIdentityCardNode.tsx`, `nodeflow.css`, and their source assertions.
