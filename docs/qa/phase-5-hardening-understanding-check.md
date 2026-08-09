# Phase 5 — Understanding Check: Rate Limiting, CSRF, Audit Logging

> Same format as [phase-3](phase-3-cookie-auth-understanding-check.md)/[phase-4](phase-4-rbac-users-understanding-check.md): explanations written directly, before the code, doubling as the design spec. Three independent hardening features this phase — rate limiting, CSRF defense-in-depth (promised back in Phase 0 Q6, deferred until now), and audit logging.

---

## A. Rate Limiting

### A1 — What a rate limiter actually tracks, and the shared-IP problem

A fixed-window rate limiter (what `@nestjs/throttler` does by default) tracks a counter per **tracker key** — by default, the requester's IP address — over a rolling time window (`ttl`). Each request within the window increments the counter; once it exceeds `limit`, further requests are rejected until the window resets.

**The real limitation worth knowing:** IP-based tracking conflates *all* traffic from behind the same public IP into one bucket. Two employees on the same corporate NAT, or a shared university/office network, or traffic passing through a proxy, all appear as "one requester" to a naive IP-based limiter — one person hitting the limit can lock out everyone else sharing that IP. This project accepts that tradeoff (it's still far better than no rate limiting at all), but it's worth being precise that "rate limit by IP" is an approximation, not a perfect per-human identity check — a more sophisticated system might combine IP with a session/device fingerprint, at real added complexity.

### A2 — Why `/auth/login` and `/auth/refresh` need stricter limits, and what this does and doesn't stop

General API traffic from a legitimate logged-in user can reasonably burst (a dashboard loading five widgets at once). Login attempts should never legitimately burst — a real user fat-fingering their password twice is normal; 50 attempts in a minute from one source is not. A stricter, separate limit on `/auth/login` specifically mitigates **credential stuffing** (an attacker trying many stolen email/password pairs against your login endpoint) and **brute force** (many password guesses against one known email) by making both slow and expensive per-IP.

**What it explicitly does *not* stop:** a patient, distributed attacker spreading attempts across thousands of different IPs (a real botnet) trivially evades a per-IP limit — each IP individually stays under the threshold. Rate limiting is one layer, not a complete defense; it raises the cost of the *cheap, common* version of this attack, not the sophisticated one. Combined with Argon2id's per-attempt cost (Phase 0/3) and generic error messages (no user enumeration), it's a meaningful, cheap improvement — not a claim that credential attacks become impossible.

### A3 — Status code and client-side handling

`429 Too Many Requests` (the package's `ThrottlerException` is an `HttpException` with that status baked in — meaning it flows through `AllExceptionsFilter` exactly like any other thrown exception, no special-casing needed). Realistically, a frontend should treat `429` distinctly from a generic error: show something like "Too many attempts — try again shortly," not the generic `ApiError` message path, and ideally respect a `Retry-After` header if the server sends one (this project's default config doesn't add one yet — a reasonable future enhancement, not built this phase).

### A4 — In-memory storage vs. Redis, and what breaks at scale

`@nestjs/throttler`'s default storage keeps every IP's counters in the Node process's own memory. That's exactly right for this project's current single-instance setup. **It silently breaks the moment this app runs as more than one instance** (e.g. 3 replicas behind a load balancer): each instance tracks its own separate counter for the same IP, with no shared state between them — an attacker (or the load balancer's own round-robin routing) spreads requests across instances, and the *effective* limit becomes `limit × number of instances`, not `limit`. The fix at that point is a shared, external storage backend (Redis is the standard choice for this package) — not built in this project since it only ever runs as one instance, but worth stating precisely as a known, disclosed limitation rather than pretending the current setup scales as-is.

### A5 — Should health checks be rate-limited?

No — `HealthController` is exempted via `@SkipThrottle()`. An orchestrator (Kubernetes, a PaaS) polls `/health/live`/`/health/ready` frequently and automatically; if those requests counted against a rate limit meant for user/API traffic, a normal polling interval could eventually trip the limit and make the orchestrator falsely believe the app is unhealthy — the health-check mechanism would end up *causing* the outage it exists to detect. Same reasoning already applied to `ResponseEnvelopeInterceptor`/`AllExceptionsFilter` treating `/health/*` as an ops contract, not user-facing API traffic.

---

## B. CSRF Defense-in-Depth (Double-Submit Cookie)

Promised back in Phase 0 Q6 as a hardening-phase addition on top of the `SameSite=Lax` + strict CORS baseline already in place — not because that baseline is insufficient for this project's real threat model, but as a deliberate learning exercise in the full mechanism.

### B1 — Why the CSRF cookie must be `httpOnly: false` — doesn't that reintroduce the XSS risk?

The entire double-submit mechanism depends on **JavaScript being able to read this one specific cookie's value** and echo it back as a request header. If it were `httpOnly`, client-side JS couldn't read it at all, and the whole scheme would be impossible to implement — there'd be no way for the frontend to know what value to put in the `X-CSRF-Token` header.

This is *not* the same risk as making `access_token`/`refresh_token` readable would be. Those two cookies **are the credential itself** — reading either one, verbatim, is enough to impersonate the user completely. The CSRF token is different in kind: on its own, knowing its value grants an attacker *nothing*, because an attacker exploiting a CSRF vulnerability (a victim's browser making a request to your site from a different origin) **cannot read the victim's cookies at all** — CSRF and XSS are different attack classes with different capabilities, covered next in B2. Making the CSRF cookie readable by the *same-origin* frontend JS doesn't hand anything useful to a *cross-origin* attacker.

### B2 — Precisely why a CSRF attacker can't produce a matching header value

This is the core mechanism, worth being exact about. A CSRF attack works because the *browser* automatically attaches cookies to requests regardless of which page triggered them — that's "ambient authority" (Phase 0 Q2/Q6). But **JavaScript running on `evil.com` cannot read cookies belonging to `your-api.com` at all** — the browser's same-origin policy blocks cross-origin `document.cookie` access entirely, independent of any cookie attribute (`httpOnly`, `SameSite`, anything). So:
- `evil.com`'s script *can* cause the victim's browser to send a request to `your-api.com`, and that request *will* automatically include the `csrf_token` cookie (ambient authority, unaffected by this defense).
- But `evil.com`'s script has no way to *read* that cookie's actual value, so it cannot construct a matching `X-CSRF-Token` header to attach to the forged request.
- The server compares the value it received in the cookie against the value it received in the header — for a genuine same-origin request (the real frontend, which *can* read its own cookie), they match. For the forged cross-origin request, the header is either missing or wrong, and the guard rejects it.

The attacker can trigger the request; they cannot forge a value they're structurally incapable of reading. That's the entire trick, and it's why this is called "double-submit" — the same secret has to arrive twice, through two channels only a legitimate same-origin client can both access.

### B3 — Guard, not middleware — and why that's not just a safety fallback

CSRF checking is implemented as `CsrfGuard` (`implements CanActivate`), not raw Express middleware, for a concrete, verifiable reason (not a guess): Guards are unambiguously part of Nest's own request-handling pipeline — every guard built so far (`JwtAuthGuard`, `PermissionsGuard`) throws exceptions that are confirmed, tested, working correctly through `AllExceptionsFilter`. Raw middleware registered via `app.use()` sits at a lower, Express-native level, and this project has no verified evidence either way about whether exceptions thrown there get the same treatment — rather than assume, this project builds on the mechanism already proven correct.

There's also a genuine architectural upside beyond just "it's already proven to work": as a Guard, `CsrfGuard` gets access to `ExecutionContext.getHandler()`/`getClass()` — the exact same `Reflector`-based metadata mechanism `PermissionsGuard` already uses. This lets routes opt out cleanly via a `@SkipCsrf()` decorator (matching the `@RequirePermissions()` pattern exactly) instead of hardcoding a path string comparison (`if (req.path === '/auth/login')`) inside middleware, which is fragile against routing changes, prefixes, or versioning.

### B4 — Should `/auth/login` be exempt?

Yes. Two independent reasons: (1) mechanically, no `csrf_token` cookie can exist yet before a session has ever been established — there's nothing to double-submit against on the very first request; (2) the classic CSRF threat model targets forging a *state-changing action within an already-authenticated session* — login itself requires knowing the victim's actual password, which CSRF alone can never provide. (A narrower, historical variant called "login CSRF" — tricking a victim into unknowingly logging into an *attacker's* account to poison what they save under that identity — exists as a named concept but is deliberately out of scope here, not silently ignored.)

---

## C. Audit Logging

### C1 — Why `audit_logs` deliberately has NO foreign key, breaking the pattern from every other table

Every relationship built in Phase 2 (`users.role_id`, `refresh_tokens.user_id`) used a real foreign key specifically to guarantee referential integrity. `audit_logs.actor_user_id` and `audit_logs.target_id` are plain `uuid` columns with **no FK constraint at all** — a deliberate exception, not an inconsistency.

The reason is the audit log's entire *purpose*: it must remain a permanent, trustworthy record of "who did what to whom," **regardless of what later happens to the users or entities involved.** If `actor_user_id` had an `ON DELETE CASCADE` FK to `users`, deleting that admin's account would delete the historical record of everything they ever did — exactly backwards from what an audit trail is for. `ON DELETE RESTRICT` would be just as wrong in the other direction — it would make it *impossible* to ever delete a user who has ever performed a single logged action, forever. `SET NULL` would at least preserve the log row, but Phase 2's soft-delete pattern already means users are never hard-deleted in the first place, making an FK's cascade behavior moot for that path while still adding schema coupling for no real benefit. The simplest, correct choice: no FK, since the audit table's job is to be independent of the lifecycle of the things it references.

### C2 — Audit log vs. a normal application log line — different purpose, different everything

An application/debug log (`Logger.error(...)`, already used in `AllExceptionsFilter`) exists for **operational debugging** — "why did this request fail," read by an engineer, often short-retention, unstructured or loosely structured, and can reasonably include stack traces and internal detail. An audit log entry exists for **accountability** — "which specific human took this specific action on this specific record, and when" — read potentially much later (a security incident review, a compliance audit, a user disputing "I never approved that"), needs to be structured and queryable by actor/target/action, and must **never** be silently lost or overwritten the way a rotated debug log file might be.

Concretely: `Admin X deleted User Y at 14:32` belongs in the audit log — it's a permanent business-relevant fact. `TypeError: Cannot read property 'id' of undefined at UsersService.ts:42` belongs in the application log only — it's a debugging detail with no accountability value and every reason to eventually be purged.

### C3 — Where does the audit-recording call actually live?

Inside `UsersService`'s own methods (`update()`, `remove()`), as an explicit call — **not** as a generic cross-cutting interceptor watching for "any mutating request to `/users/*`." The tradeoff: a generic interceptor would be less code to add per-entity (Products/Orders would get logging "for free"), but it can only know *that* a route was hit and *what* the raw request/response looked like — it has no clean way to know the *meaningful* business fact worth recording (e.g., specifically that a role changed, and from what to what) without re-parsing request/response bodies heuristically. An explicit call inside the service method, at the exact point the meaningful state change is already known precisely, is more code per entity but produces genuinely meaningful audit entries instead of generic "PATCH happened" noise. For a project explicitly about production-grade RBAC/security depth, precise audit entries are worth the extra line of code per action.

---

## What Gets Built This Phase

1. `@nestjs/throttler` — global default (`100`/`60s`), stricter override (`5`/`60s`) on `/auth/login` and `/auth/refresh`, `/health/*` exempted.
2. `CsrfGuard` + `@SkipCsrf()` — double-submit `csrf_token` cookie (non-`httpOnly`), checked against an `X-CSRF-Token` header on every mutating request except `/auth/login`.
3. `AuditModule`/`AuditLog` entity (new migration) + `AuditService.record(...)`, wired into `UsersService.update()` (role changes only) and `UsersService.remove()` (deletions) — recording, not a viewer endpoint (flagged as a future/stretch item, matching how `PRD.md` already scoped real invite-email-sending as a stretch goal, not built here).

## Open Decisions (proceeding as stated; flag if you'd rather change any)

| Decision ID | Area | Decision | Rationale | Status |
| :--- | :--- | :--- | :--- | :--- |
| `BE-DEC-013` | Rate limit values | Global `100 req/60s`; `5 req/60s` on login/refresh specifically | Reasonable, disclosed defaults — not derived from real production traffic data (none exists yet) | Proceeding |
| `BE-DEC-014` | CSRF header/cookie names | Cookie `csrf_token`, header `X-CSRF-Token` | Conventional, matches common real-world naming | Proceeding |
| `BE-DEC-015` | Audit log FK strategy | No foreign keys on `actor_user_id`/`target_id` | Audit trail must outlive the lifecycle of what it references — see C1 | Proceeding |
| `BE-DEC-016` | Audit log scope | Recording only, no admin-facing viewer endpoint yet | Matches `PRD.md`'s existing pattern of deferring non-core features explicitly rather than silently skipping them | Proceeding |
