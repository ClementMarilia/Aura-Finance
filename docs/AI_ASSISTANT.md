# AI entry assistant and manual monthly plan

## Product behavior

- Settings → Artificial intelligence: off, own OpenAI/Gemini connection, or Aura.
- Own keys: encrypted at rest, never returned by the API; no Aura subscription required. The selected provider bills the user. No automatic paid fallback.
- Integrated models: OpenAI `gpt-4.1-mini`, Gemini `gemini-2.5-flash-lite`. OpenAI audio uses `gpt-4o-mini-transcribe`; Gemini receives WAV directly.
- Aura costs **€5 for one calendar month starting at manual payment approval**, with 300 completed interpretations. There is no credit wallet, automatic debit or automatic renewal. Renewal can be requested after expiration; unused commands do not roll over.
- One income or expense per command. Audio is limited to 30 seconds, server-validated 16 kHz mono PCM WAV. Missing/ambiguous values remain for user review; multiple entries, transfers and recurrences are outside this first release.
- The assistant fills the existing transaction form. It never calls transaction creation itself. Saving still requires the user's normal form confirmation.
- Failed calls refund the command quota; a separate 360-attempt cap per paid period bounds repeated failures. Requests use a cross-worker lease and short cooldown. Models, hosts, context size and output size are fixed/bounded. This is not an exact currency-denominated spending cap; monitor provider costs and pricing changes.
- Provider output IDs are checked against the authenticated user's categories/accounts; incompatible category kinds/account currencies are discarded.
- No bank balances or transaction history are sent. Commands and category/account names go to the chosen provider; audio is not persisted. Provider data policies still apply.
- Disconnect removes the stored key. Financial reset preserves subscription and connection; account deletion removes them.

## Enable in the backend environment

No existing environment variables are changed. These are new **backend-only** variables:

| Variable | Purpose |
| --- | --- |
| `AI_ENCRYPTION_KEY` | Dedicated Fernet key for user-owned provider keys. Generate securely with `Fernet.generate_key()` from `cryptography`; keep it stable and backed up in your secrets manager. Losing it requires reconnecting user keys. Never reuse JWT_SECRET. |
| `AURA_AI_PROVIDER` | `gemini` (default) or `openai`. Determines the model included in the paid plan. |
| `AURA_GEMINI_API_KEY` | Server-owned Gemini API key when Aura uses Gemini. |
| `AURA_OPENAI_API_KEY` | Server-owned OpenAI API key when Aura uses OpenAI. Existing API credits can be consumed by this key. |
| `AURA_AI_PAYMENT_INSTRUCTIONS` | Payment instructions shown to users. Plain text, including the recipient/reference/contact route as appropriate. |

Until these are configured, own-key setup and/or paid requests show an unavailable/configuration message. Do not put secrets in React environment variables, source files, PRs or chat.

Superadministrator at `/admin/ia`: view requests, confirm actual receipt of €5, approve or reject, suspend an active plan. Payment reporting by a user does not activate service. Conditional transitions and request IDs prevent duplicate approval or old confirmations activating a new request. `ai_plan_events` records administrative decisions, previous state and resulting entitlement. Admin views expose subscription metadata and command counts only, never financial entries or keys. Notifications link to the request screen.

Collections: `ai_connections` and `ai_plans` use the existing UUID user ID as Mongo `_id` (inherently unique). `ai_plan_events` holds decision history. No migration or finance data rewrite is required.

## Verification

Isolated API tests use MongoDB-compatible in-memory queries and mocked provider calls. Recorder tests validate WAV format, sample conversion and duration cap. Real provider credentials, audio devices and production billing have not been used by these tests. After setting backend secrets, verify on a phone: connect a key, dictate one entry, inspect the draft, save manually; then test a manually approved Aura account and a provider quota failure.

Validation on this implementation:

| Check | Result |
| --- | --- |
| Isolated backend suite | 314 tests passed, including 20 AI-specific cases |
| Frontend suite with coverage | 28 suites, 121 tests passed |
| Production build | Passed |
| Initial JS bundle budget | 199.81 KiB gzip / 200 KiB maximum |
| Translation catalogs and PWA checks | Passed |
| Production dependency audit | No applicable high/critical vulnerabilities |

AI translation messages load with feature routes so the initial bundle stays within the existing budget. The existing basic speech parser remains available when external AI is off.
