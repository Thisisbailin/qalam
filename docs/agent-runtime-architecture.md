# Agent Runtime Architecture

## Position

Stylo uses `@openai/agents` as its execution engine and follows the same public
shape used by the Codex app server:

```text
Conversation (Thread)
  -> Run (Turn)
    -> AgentThreadItem[]
```

The runtime protocol is not a log of provider packets. It is a stable semantic
projection over provider output, SDK run items, tool execution, and terminal
run state.

The implementation references are:

- OpenAI Agents SDK `RunStreamEvent`: raw model events plus semantic run-item events.
- Codex app-server v2: `item/started`, item deltas, `item/completed`, and `turn/completed`.
- Stylo's own graph tools and approval domain, which remain product-specific.

## Canonical Items

`AgentThreadItem` is the only transcript-level runtime item union:

- `agent_message`: commentary or final answer text.
- `reasoning`: the provider-supported reasoning summary shown by the UI.
- `tool_call`: one stable item from invocation through output or failure.

Every item has a stable `id`, a `type`, and a lifecycle `status`. Tool starts,
tool outputs, and tool failures are updates to one item, not unrelated chat
records.

Additional semantic item types, such as approval requests, may be added only
when they have an end-to-end lifecycle across persistence, transport, and UI.
Provider-specific packet types must never leak into this union.

## Turn Protocol

One run emits the following ordered protocol:

```text
turn_started
  item_started
  item_delta*
  item_updated*
  item_completed
turn_completed | turn_failed
```

Required invariants:

1. A turn has exactly one terminal event.
2. `turn_completed` contains the single authoritative `StyloRunResult`.
3. No duplicate result packet or transcript event may follow the terminal event.
4. A tool call has one item id for its complete lifecycle.
5. Replayed events are ignored by `(runId, sequence)`.
6. Trace data stays on the observability channel and never enters this protocol.

The Edge wrapper does not publish its own synthetic run to the client. Only the
Agent Core owns the public run lifecycle.

## SDK Projection

The SDK stream projector consumes both event levels for different purposes:

- `raw_model_stream_event` provides low-latency text and reasoning deltas.
- `run_item_stream_event` confirms semantic completion such as
  `message_output_created` and `reasoning_item_created`.

`response_done` is a fallback source for final text extraction, not a second
message-completion signal. This prevents the same answer from being completed
once as a raw response, again as an SDK item, and again as an HTTP result.

Internal tool executor events are adapted into the same public item lifecycle
at the Agent Core boundary. React never consumes the executor's private event
types.

## Transport And UI

The HTTP stream carries only:

- canonical runtime events;
- a transport error when the request fails before the Agent Core owns a turn.

The React projector is a replace-by-id read model. Streaming deltas update the
active item, while terminal item events settle it idempotently. The timeline and
visual cards are projections over items; they are not another source of truth.

Markdown, inline-code labels, external links, and future project references are
presentation semantics inside `agent_message.text`. They are not separate run
items. External links remain protocol-allowlisted. Project references should
resolve through typed Flow/Knowledge resource refs; arbitrary local filesystem
navigation must not be enabled by Markdown alone.

## Persistence And Tracing

SDK session history remains the model-context store. The UI transcript and
runtime stream are projections and must not be replayed into model context as
provider events.

Tracing is emitted without sensitive prompt or project content by default.
Core and wrapper diagnostics stay in server logs and trace persistence; they do
not share the user-facing event channel or create a second run id.

## Human Approval

Image and video execution currently uses a durable NodeFlow generation proposal.
That proposal is product state: the Agent prepares it, the UI asks the human,
and the NodeFlow executor runs only after approval. It must not be described as
an SDK interruption because the high-privilege execution is not currently an
SDK function tool.

If high-privilege execution later becomes an SDK tool, use the SDK's native
human-in-the-loop path:

1. declare `needsApproval` on the tool;
2. surface `tool_approval_requested` as a first-class thread item;
3. persist the serialized `RunState` with the approval request;
4. approve or reject that exact item;
5. resume the same run state and stream the execution result into the same item.

Do not implement approval by blocking an HTTP connection while waiting for UI
input, and do not auto-reissue the original user prompt as a fake resume.

## Development Rules

- Extend the semantic item union before adding one-off UI messages.
- Keep provider compatibility inside provider and stream adapters.
- Keep transport terminal state singular and explicit.
- Test event ordering, duplicate replay, interrupted transport, and semantic SDK
  item projection without making real model calls.
- Treat skills as optional guidance packages, never as runtime protocol layers.
