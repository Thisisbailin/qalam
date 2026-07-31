# Plan — DeepSeek Responses Agent Unification

## Architecture Intent Block

The Agent core owns one provider-neutral execution pipeline:

`provider config -> OpenAI-compatible client -> OpenAIProvider(Responses) -> Runner -> shared Session/tools/stream projector`

DeepSeek is configuration data at the provider boundary, not a transport implementation. Model allowlisting is enforced at both persisted-config normalization and server runtime resolution.

## Work Breakdown

1. Replace the DeepSeek Chat Completions API mode with the shared Responses provider runtime.
2. Remove the DeepSeek compatibility adapter and the now-unused Chat Completions compaction session.
3. Lock DeepSeek model resolution and settings UI to `deepseek-v4-flash`.
4. Normalize legacy persisted DeepSeek model configuration.
5. Replace compatibility tests with Responses routing and model-lock regression tests.
6. Run targeted tests, full tests, strict typecheck, production build, and source audits.

## Verification Plan

- AC1/AC2: architecture tests plus source audit for `deepseekCompat`, `chat_completions`, and `useResponses: false`.
- AC3/AC5: unit assertions for missing, Pro, legacy, and arbitrary DeepSeek model inputs.
- AC4: component contract/source assertion for a Flash-only, Responses-labelled UI.
- AC6: `npm test`, `npm run typecheck`, and `npm run build`.

## Rollback Points

- Revert the provider runtime/config/session changes together to restore the former Chat Completions route.
- Revert settings normalization independently if legacy configuration migration causes unexpected UI state.
- `agents/runtime/deepseekCompat.ts` is removed only after all imports and tests are replaced; Git history remains the recovery source.
