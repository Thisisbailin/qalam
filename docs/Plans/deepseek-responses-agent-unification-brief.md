# Mission Brief — DeepSeek Responses Agent Unification

## Objective

- Route DeepSeek through the same OpenAI Agents SDK Responses API core used by every other Agent provider.
- Remove the DeepSeek Chat Completions compatibility transport and its message/reasoning adapters.
- Allow only the official `deepseek-v4-flash` model until DeepSeek officially releases Responses API support for Pro.
- Migrate persisted or incoming DeepSeek model selections, including `deepseek-v4-pro`, to `deepseek-v4-flash`.

## Out of scope

- Enabling `deepseek-v4-pro` before its Responses API release.
- Replacing the OpenAI Agents SDK or upgrading dependencies.
- Changing non-Agent text generation pipelines.
- Calling a live model or handling production API keys during verification.

## Inputs / Outputs

- Input: Agent provider configuration, persisted project settings, HTTP Agent runtime configuration, and local/edge Agent runs.
- Output: one Responses API execution path backed by the existing generic Agent core and session history.
- DeepSeek contract: base URL `https://api.deepseek.com`, model `deepseek-v4-flash`, Responses API over HTTP.

## Acceptance Criteria

1. No Agent runtime code imports or installs a DeepSeek Chat Completions compatibility layer.
2. All providers construct `OpenAIProvider` with Responses enabled and share one session/compaction path.
3. DeepSeek always resolves to `deepseek-v4-flash`; Pro and arbitrary DeepSeek model values cannot reach the model client.
4. The settings UI exposes DeepSeek Responses API and no Pro selector.
5. Persisted legacy DeepSeek Pro configuration is normalized to Flash.
6. Architecture tests, full tests, strict typecheck, and production build pass.

## Constraints and risks

- DeepSeek Responses is stateless: application sessions must continue replaying stored input items rather than relying on `previous_response_id`, Conversations, or `store`.
- DeepSeek ignores unsupported Responses fields. The shared core must avoid depending on server-side storage or unsupported built-in tools.
- Existing unrelated working-tree changes must be preserved.
- No credentials, user data, or live inference requests are used for validation.

## Platform differences

None. Browser and Cloudflare edge runtimes use the same provider/runtime contract; only credential acquisition differs.
