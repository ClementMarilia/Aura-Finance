# Crelith Finance security baseline

Security and privacy are release gates. New endpoints are not complete until
they validate authentication, permission, resource ownership, input shape and
safe failure behavior on the backend.

## Implemented controls

- 15-minute JWT access tokens with issuer, audience, type, `jti` and session ID.
- Rotating opaque refresh tokens stored only as an HMAC in MongoDB.
- Refresh cookie is `HttpOnly`, `Secure`, `SameSite=Lax` and first-party through
  the production `/api` proxy.
- Reuse of an old refresh token revokes its session family; a five-second race
  window prevents false positives from simultaneous browser tabs.
- Thirty-minute idle timeout, 30-day absolute expiry and five active sessions
  per account.
- Individual logout, global logout and revocation after password changes,
  password resets and account deletion.
- Login throttling by account/IP fingerprint with progressive temporary lock.
- Password-reset throttling, generic account-discovery-safe responses and
  single-use hashed reset tokens.
- RBAC for user, administrator and super-administrator operations.
- Ownership is included in MongoDB mutation filters for private resources.
- All request models reject unknown fields to prevent mass assignment.
- API payload bounds, narrow CORS methods/headers and correlation IDs.
- HSTS, CSP, anti-framing, MIME sniffing, referrer and permissions headers.
- Upload size, extension, declared MIME and file-signature validation.
- Files are downloaded only by their owner and never authenticate via URL token.
- Minimized audit/security events with one-year configurable retention.
- Account data export with per-user throttling and no-store delivery.
- Permanent account deletion/anonymization flow.
- API responses and the PWA service worker do not cache private API data.
- Analytics/session recording is disabled until a compliant consent flow exists.

## Mandatory implementation checklist

For every new or changed endpoint, test:

1. no token, expired token and revoked session;
2. own resource, another user's ID and an unknown ID;
3. extra/protected fields and malformed values;
4. duplicate and concurrent financial requests;
5. safe error and audit output without secrets or full financial payloads.

All private MongoDB reads and mutations must include the authenticated owner or
an explicit participant/administrator permission in the database filter. A
frontend-provided `user_id`, role, status, balance or audit field is never a
source of authority.

## Production configuration gates

- `JWT_SECRET` must be a random value of at least 32 bytes. Production startup
  fails closed when it is shorter.
- `CORS_ORIGINS` must list only official origins; wildcard CORS fails closed.
- HTTPS is mandatory. The frontend proxies HTTP API calls through its own
  origin so refresh cookies remain first-party.
- Secrets must remain in Render/Vercel environment configuration and must not be
  copied to Git, logs, support tickets or client bundles.
- MongoDB must use a least-privilege application account and network access
  restricted to the backend environment.

## Infrastructure controls still required before claiming full compliance

Application code cannot guarantee these controls by itself:

- Activate the encrypted daily MongoDB backup workflow documented in
  `docs/BACKUP_AND_RESTORE.md`, using a dedicated read-only credential.
- Run the workflow against production and record the first successful isolated
  restoration. Implementation alone is not evidence that production can recover.
- Add a scheduled dependency vulnerability scan after a reproducible frontend
  lockfile is adopted.
- Add 2FA/passkeys and a user-facing connected-device/session screen.
- Define incident contacts, breach triage and GDPR notification responsibilities.

Do not describe the system as fully GDPR compliant or invulnerable. Compliance
also depends on contracts, retention, lawful basis, subprocessors and operational
practice.
