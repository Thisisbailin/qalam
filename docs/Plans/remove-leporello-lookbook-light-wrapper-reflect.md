# Reflect — Remove Leporello and lighten the Lookbook wrapper

## What failed or nearly failed

- The initial Lookbook CSS source assertion captured the shared board rule instead of the specific front-board rule. It was narrowed to the rule containing `z-index: 3` and then passed in isolation.
- Full repository typecheck and the repeated full test run were destabilized by unrelated concurrent changes outside this feature slice.

## Three concrete improvements

1. Source-structure tests should identify a unique declaration within a CSS rule before asserting its contents.
2. For a dirty shared workspace, record the initial unrelated error baseline before the first edit when feasible.
3. Keep feature-isolated build-and-test commands available so a concurrent repository-wide failure does not obscure local verification.
