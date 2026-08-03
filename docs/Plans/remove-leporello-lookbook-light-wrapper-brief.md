# Mission Brief — Remove Leporello and lighten the Lookbook wrapper

## Objective

- Remove Leporello as a creatable, renderable, editable, and desktop-integrated wrapper module.
- Redesign the Flow-canvas Lookbook wrapper to match the light paper language of Manus: primarily flat, with restrained layered-paper lift.

## Out of scope

- Changing Lookbook book data, its full-screen studio, identity synchronization, or membership behavior.
- Migrating historical Leporello nodes into another wrapper type.
- Changing Manus visuals.

## Inputs / outputs

- Input: the current NodeFlow type registry, wrapper projection, creation surfaces, Electron bridge, and Lookbook cover component/styles.
- Output: no Leporello product surface or runtime API remains; Lookbook retains the same data contract and interactions with a lighter collapsed presentation.

## Acceptance criteria

1. Source code outside historical planning/audit documents contains no `Leporello`, `leporello`, or `leporello-membership` product implementation.
2. The node creation menus and Flow node registry no longer expose Leporello.
3. Electron no longer exposes or handles Leporello sketch sessions.
4. Lookbook remains 320 × 320 and keeps cover image, identity title, selection, hover, open, and closed states.
5. Closed Lookbook uses a flat paper cover, two restrained backing sheets, a tinted low-opacity shadow, and no heavy hardcover spine or deep Y-axis rotation.
6. Type checking, tests, production build, and diff whitespace checks pass.

## Constraints and risks

- Existing Leporello project data becomes unsupported by the current NodeFlow type contract.
- Existing unrelated workspace changes must remain untouched.
- No new dependency or external service is introduced.

## Platform differences

- Removing Leporello also removes its macOS-only system sketch IPC. Lookbook remains platform-neutral.
