# Verify — DeepSeek Responses Agent Unification

## Official source alignment

- DeepSeek change log, 2026-07-31: the official V4 Flash release natively supports the Responses API; the Pro API is unchanged.
  - https://api-docs.deepseek.com/updates/
- DeepSeek Responses guide: only `deepseek-v4-flash` is currently supported; `deepseek-v4-pro` is not supported yet.
  - https://api-docs.deepseek.com/guides/responses_api/
- The same guide documents `https://api.deepseek.com`, semantic SSE, function tools, and a stateless API without `previous_response_id`, Conversations, or `store`.
- OpenAI Agents SDK model guide: `OpenAIProvider({ useResponses: true })` selects the Responses model implementation for string model names and supports a preconfigured OpenAI-compatible client.
  - https://openai.github.io/openai-agents-js/guides/models/
- OpenAI Agents SDK session guide: a custom `Session` prepends persisted history to each run and saves new input/output, so the application does not need server-managed response state.
  - https://openai.github.io/openai-agents-js/guides/sessions/

## AC -> Evidence Mapping

- AC1: `agents/runtime/deepseekCompat.ts` deleted; no live Agent source imports or installs a DeepSeek transport adapter — pass.
- AC2: `agents/runtime/providerRuntime.ts` always constructs `OpenAIProvider` with `useResponses: true`; `functions/api/agent.ts` always uses `StyloResponsesCompactionSession` — pass.
- AC3: `resolveProviderModel("deepseek", anyValue)` always returns `deepseek-v4-flash`; edge and browser runtime both call that resolver before constructing the Agent — pass.
- AC4: DeepSeek settings surface is labelled Responses API, renders a fixed Flash model, and contains no Pro option — pass.
- AC5: `hooks/useConfig.ts` normalizes persisted DeepSeek configuration to Flash; runtime normalization remains the fail-closed enforcement boundary — pass.
- AC6:
  - `npm test`: pass, 219/219 tests.
  - `npm run build`: pass, 7,288 modules transformed.
  - `npm run typecheck`: blocked by pre-existing `unknown` response typing errors outside the changed scope. No error points to a file changed for this migration.

## Source audits

- No live Agent source contains `deepseekCompat`, `chat_completions`, `StyloChatCompactionSession`, `resolveApiMode`, `DEEPSEEK_PRO_MODEL`, or `useResponses: false`.
- Remaining DeepSeek branches are provider-boundary configuration only: credential selection, base URL selection, model allowlisting, labels, and error messages.
- The prompt catalog was regenerated after deleting the Chat Completions compaction prompt; only the shared Responses compaction prompt remains.

## Runtime and privacy checks

- No live model call was made and no API key or user/project payload was read or transmitted.
- DeepSeek session continuity remains application-managed through local/D1 session items, matching the provider's stateless Responses limitation.
- DeepSeek unsupported server-state fields are not used as application invariants; the shared runtime explicitly sets `store: false`.

## Known baseline issue

Strict typecheck currently fails in unrelated files including `agents/tools/accessGithubRepository.ts` and several media/provider services (`multimodalService`, `qwenAudioService`, `qwenResponsesService`, `responsesTextService`, `seedreamService`, `viduService`, and `wanService`). These files were not modified because repairing their response schemas is outside this Agent transport migration and overlaps the user's existing dirty worktree.

## Rollback

Revert this migration as one unit to restore the previous Chat Completions adapter and session branch. The deleted adapter remains recoverable from Git history. No data migration or destructive remote operation occurred.
