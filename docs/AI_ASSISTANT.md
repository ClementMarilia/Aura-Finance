# AI connections and administrator-controlled Aura access

## Two independent connections

- **Own AI:** each user saves an encrypted OpenAI or Gemini API key. Provider limits and billing belong to that user's provider account. No Aura grant, trial or payment is required.
- **Aura AI:** server-owned credentials; every user requests access and the superadministrator decides whether to grant a trial, courtesy access, request payment, reject or suspend.
- Choosing a different connection remains an explicit user action with consent. An Aura expiry or quota never blocks the own-key connection. No automatic paid fallback, billing activation or automatic renewal.

## Access lifecycle

1. `POST /api/ai/plan/request` creates a pending request and notifies the superadministrator. Payment instructions and provider readiness are not prerequisites for requesting access.
2. The admin selects:
   - Trial: default **24 hours / 20 completed commands**, editable to 1–8760 hours and 1–300 commands.
   - Courtesy: default **720 hours / 300 commands**, same editable limits, no payment required.
   - Request payment: requires payment instructions in the backend environment; notifies the user and changes the state to `payment_required` without granting access.
   - Paid activation: requires explicit confirmation of receipt of **€5**, grants **one calendar month / 300 commands**.
   - Reject or suspend.
3. User-reported payment changes state to `payment_reported`. It never grants access. Legacy pending requests can still report payment through the old API flow.
4. Active grants can have expiry and total command limit changed, with an optimistic version check. The duration is measured from the adjustment time. Usage and attempt counts are never reset by this operation.
5. Expiration and quotas are checked on **every server-side interpretation request**, including the exact expiry boundary. No scheduler, browser session or background job is required. The stored state can remain `active`, while `effective_status` reports `expired` or `exhausted`.
6. Users can request access again after expiry, suspension, rejection or exhaustion of successful commands. A new request never self-grants or resets an active entitlement into another approved trial. Each new grant needs an explicit admin decision.

Conditional updates bind request ID, access version and user ID. Duplicate approvals and stale adjustments do not extend or reset access. Previous decisions and resulting grants are recorded in `ai_plan_events`. Admin views contain access metadata and command counts only, never financial entries or provider keys. Notifications link to the relevant screen.

Legacy paid subscriptions without the new fields remain valid with 300 commands and 360 attempts. No data migration or finance data rewrite is required.

## Automatic model selection

Own-key settings offer **Automatic** or a manual model. Explicit existing selections are preserved. New connections default to automatic; Aura always uses automatic within its configured provider.

Automatic selection queries the provider's model list and filters to reviewed models compatible with the current integration:

- OpenAI: `gpt-4.1-mini`, `gpt-4o-mini`.
- Gemini: `gemini-3.5-flash-lite`, `gemini-2.5-flash-lite` (in that priority order).

If a listed model rejects generation as unavailable (HTTP 404), another compatible model of the **same provider** is tried. Quota, credential, region and general outage errors do not trigger retries or a different provider. Preview and unknown models are excluded. Model listing is not treated as proof of inference access; the generated draft must also validate. There is no guarantee against a provider outage or exhausted quota. The last successfully used model is shown to the user.

OpenAI audio is transcribed once with `gpt-4o-mini-transcribe` even if model selection subsequently tries another model. Gemini receives normalized WAV directly. Audio stays in memory and is not persisted.

## Entries and resource limits

- One income or expense per command. Maximum 1500 text characters; 30 seconds of server-validated 16 kHz mono PCM WAV for audio.
- The assistant fills a draft in the existing form and never creates a transaction itself. The user reviews and confirms saving. Category/account IDs are scoped to the authenticated user; incompatible IDs are discarded.
- Only commands and category/account names go to the provider. No balances or transaction history are sent. Provider data policies still apply.
- Successful interpretations consume one command. Failed interpretations refund the successful-command count but remain attempts. Paid grants allow 360 attempts; free grants allow their command limit plus 20% (minimum 5) extra attempts.
- Fixed hosts, reviewed models, context/output caps, a cross-worker lease and cooldown bound attempts. These are not a currency-denominated hard spending cap: monitor provider prices/costs.
- Provider failures preserve the text and offer explicit basic parsing without AI; there is no silent provider switch.
- Disconnect deletes the key. A finance reset preserves the connection/grant; account deletion removes them.

## Backend setup

| Variable | Purpose |
| --- | --- |
| `AI_ENCRYPTION_KEY` | Stable, dedicated Fernet key for own connections; generate with `Fernet.generate_key()`. Keep it in your secrets manager. Losing it requires reconnecting stored keys. Never reuse JWT_SECRET. |
| `AURA_AI_PROVIDER` | `gemini` (default) or `openai`. |
| `AURA_GEMINI_API_KEY` | Server Gemini credential if Aura uses Gemini. |
| `AURA_OPENAI_API_KEY` | Server OpenAI credential if Aura uses OpenAI. |
| `AURA_AI_PAYMENT_INSTRUCTIONS` | Plain-text payment instructions, needed only when the admin requests payment. |

No credentials belong in React environment variables, code, PRs or chat. Missing Aura credentials block grant approval and inference, while requests can still be collected. Own-key operation only needs the encryption key plus the user's provider credential.

Collections `ai_connections` and `ai_plans` use the UUID user ID as unique Mongo `_id`. `ai_plan_events` stores decisions. All approval/adjustment/payment requests use the existing authenticated backend and superadministrator authorization.

## Verification

Isolated API tests cover expiry boundaries, free and paid grants, manual payment, notifications, own-key independence, legacy paid records, quotas, stale/duplicate decisions, and automatic model fallback without paid-source changes. UI tests cover trial defaults, explicit confirmation and payment gating. Real credentials and production account data are not used in tests.

## Master administrator

The backend uses the existing persisted `is_super_admin_user` role resolver to recognize the master administrator. `SUPER_ADMIN` can select Aura directly with consent; there is no access request, payment confirmation or self-approval. Ordinary admins and client flags receive no exemption.

Master consumption is tracked separately in `ai_connections` (`master_period`, `master_used`, `master_attempts`), with 300 completed commands and 360 attempts per UTC calendar month. Counters reserve atomically, failed calls refund only the command, and rollover happens only when the month changes. Disconnecting, saving the connection, or the legacy request button cannot reset consumption. Existing common-user grants are untouched. All provider credentials, microphone consent, draft review and source selection requirements still apply.
