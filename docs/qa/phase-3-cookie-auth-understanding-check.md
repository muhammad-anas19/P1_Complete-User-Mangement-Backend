# Phase 3 — Understanding Check: Login, Logout, Refresh

> Companion to [phase-0](phase-0-auth-rbac-understanding-check.md), [phase-1](phase-1-scaffold-db-understanding-check.md), [phase-2](phase-2-schema-migrations-understanding-check.md). Different format this round, at your request: you asked for the explanations directly rather than answering first. Read this before touching the implementation — everything below is exactly what the actual code (built right after this doc) implements, so this doubles as the design spec.

---

## Q1 — Argon2id's three parameters

- **Memory cost (`m`)** — the amount of RAM, in KiB, required to compute a single hash. This is the parameter that actually creates memory-hardness: an attacker trying to brute-force in parallel (GPUs, ASICs) needs that much memory *per parallel guess*, and memory is comparatively expensive/scarce on cracking hardware relative to raw compute — which is exactly the asymmetry Argon2id is designed to exploit in the defender's favor.
- **Time cost (`t`, iterations)** — how many passes the algorithm makes over that memory. Increases wall-clock cost per hash independent of memory size; used to fine-tune total hashing time (OWASP's baseline guidance targets roughly 250–500ms per hash on your actual server hardware).
- **Parallelism (`p`)** — how many independent lanes/threads compute the hash simultaneously, letting you use multiple CPU cores. Kept low deliberately (1 here) — high parallelism on the *defender's* side also makes it easier for an *attacker* to parallelize their own cracking attempts, partially undermining the memory-hardness property.

**What goes wrong if memory cost is set too low, even with the "right" algorithm:** Argon2id's entire security advantage over something like bcrypt comes from memory-hardness. If you configure `memoryCost` down to something trivial (say, a few KB), you've picked the right algorithm *name* but stripped out the property that actually matters — an attacker with GPUs can now brute-force it roughly as easily as a purely CPU-bound hash, because there's no longer meaningful memory pressure to exploit their hardware's relative scarcity of RAM. **The parameters are the security, not the algorithm name alone.** This project uses `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1` — OWASP's current baseline recommendation — all defined in exactly one place (`PasswordService`) so every call site uses identical, intentional settings.

---

## Q2 — Where hashing/comparison code lives

It lives in a dedicated, injectable `PasswordService` (`hash()`, `verify()`), never inline in a controller and never called as a bare static utility from inside `AuthService` directly. This is the direct payoff of the Phase 1 DI lesson (Q2): because `PasswordService` is injected into `AuthService`'s constructor, a unit test for `AuthService.login()` can `overrideProvider(PasswordService).useValue({ verify: jest.fn().mockResolvedValue(true/false) })` and test both the "correct password" and "wrong password" branches **without ever running a real, deliberately-slow Argon2id computation** in the test suite. If hashing logic were inlined directly, every unit test touching login would have to pay the real ~250–500ms cost of actual hashing, and you couldn't force the "wrong password" branch without an actual mismatching hash pair to test against. A second, quieter benefit: hashing parameters live in exactly one place, so there's no risk of signup using one cost setting and a password-reset flow (built later) accidentally using different, weaker settings.

---

## Q3 — The login service method, step by step

1. Controller receives `LoginDto { email, password }` — already validated by the global `ValidationPipe` (valid email format, non-empty password) before this method is ever called.
2. Look up the user by email: `usersRepo.findOne({ where: { email } })`. Because `User` has a `@DeleteDateColumn`, TypeORM's default `find`/`findOne` **automatically excludes soft-deleted rows** — a deleted user simply won't be found, with no extra filtering code needed.
3. **Timing-attack-aware comparison, not just a generic error message:** this is a level deeper than the Phase 0 Q3 "generic error message" lesson. If the code short-circuited immediately when `user` is `null` (skipping the password check entirely), a "user not found" response would return noticeably *faster* than a "user found, wrong password" response (which has to run a deliberately slow Argon2id verify). An attacker measuring response times could use that timing difference to enumerate valid emails even though the error *message* is identical. The fix: run `passwordService.verify()` **regardless of whether the user exists** — using a fixed, precomputed dummy hash when there's no real user — so the response takes roughly the same time either way.
4. If the user doesn't exist, or has no `passwordHash` yet (an invited user who hasn't accepted their invite), or the verify fails → throw the same `UnauthorizedException('Invalid email or password')` in all three cases. One error type, one message, indistinguishable from the response alone.
5. On success: sign an access token (JWT), issue a new refresh token (random value + DB row with a fresh `familyId`), and return `{ user, accessToken, refreshToken }` as plain data — **not** cookies. The service never touches `Request`/`Response` (per `rules.md`'s "services never touch HTTP internals" rule) — only the controller, which actually has the `Response` object, calls `res.cookie(...)`.

---

## Q4 — What goes in the access token payload

**Included:** `sub` (user id — the JWT-standard "subject" claim), `email`, `role` (the role's name, e.g. `"Admin"`) — enough for a `RolesGuard` to authorize a request without a DB hit on every single request (accepting the staleness tradeoff already discussed in Phase 0 Q9). `iat`/`exp` are added automatically by the JWT library.

**Must never be included, even hashed:** the password hash, or anything else secret. The reason is a common misconception worth stating precisely: **a JWT is signed, not encrypted.** The signature proves the payload wasn't tampered with, but the payload itself is just base64url-encoded JSON — anyone holding the token (including, trivially, the legitimate browser/user themselves, or anyone who ever sees a copy of it in a log line) can decode and read every field with zero cryptographic effort. Putting a password hash in there would hand an attacker the hash directly, letting them brute-force it completely offline, with no need to ever touch your database. Nothing goes in a JWT payload that you wouldn't be comfortable being fully readable by whoever holds the token.

---

## Q5 — Setting cookies in Express/NestJS

The call is `response.cookie(name, value, options)` on Express's `Response` object, where `options` includes `httpOnly`, `secure`, `sameSite`, `path`, and `maxAge` (milliseconds).

**A NestJS-specific gotcha this depends on:** injecting the raw response via `@Res() res: Response` normally tells Nest "I am fully responsible for sending this response myself" — Nest will **not** automatically serialize and send whatever your controller method returns, which silently breaks the usual `return user;` pattern. The fix is `@Res({ passthrough: true }) res: Response` — this gives you the response object (so you can call `res.cookie(...)`) while telling Nest to still handle sending your method's actual return value automatically, exactly as if you hadn't injected `@Res()` at all.

**What breaks if you set a cookie after the response is already sent:** HTTP sends headers once, as a single block, before the body. Once `res.send()`/`res.json()` (or Nest's automatic equivalent) has flushed the response, headers — including `Set-Cookie` — can no longer be modified; Node/Express throws `Cannot set headers after they are sent to the client` (`ERR_HTTP_HEADERS_SENT`). This is exactly why cookies must be set synchronously inside the handler *before* returning, which the `passthrough: true` pattern makes work correctly.

---

## Q6 — Does the `Path=/auth/refresh` cookie get sent on `/auth/login`?

**No.** A cookie's `Path` attribute is a plain URL-prefix filter the browser applies to every *outgoing* request, completely independent of `SameSite`, domain, or which endpoint originally set the cookie: the browser only attaches the cookie if the request's path starts with (or exactly equals) the cookie's `Path`. `/auth/login` does not start with `/auth/refresh`, so the refresh cookie is simply invisible to a login request — which is exactly what we want, since login is creating a brand-new session and has no reason to read an old refresh token at all.

Both cookies get set from the *same* login response via two separate `res.cookie()` calls — one HTTP response can carry multiple `Set-Cookie` headers (each call appends one more), so "two calls" and "one response" aren't in tension.

> **Corrected during implementation — read this, it's a real bug this exact mechanism caused.** The plan going in was `Path=/auth/refresh`, reasoning "only the refresh endpoint ever needs to read this cookie." That's wrong: **logout** also needs to read the refresh token, to revoke it in the DB. Testing the actual endpoint (not just reading the code) surfaced this immediately — `curl` correctly emulating real cookie-path matching sent *no* `refresh_token` cookie at all to `/auth/logout`, so the logout endpoint's DB revocation step silently did nothing (it received `undefined` and no-op'd, exactly as its own code says it should when no token is presented — the *code* wasn't wrong, the *cookie scope* was). The fix actually implemented: **`Path=/auth`** — broad enough to cover `/auth/login`, `/auth/refresh`, `/auth/logout`, and `/auth/me`, still narrow enough to exclude it from every non-auth business endpoint (`/users`, `/products`, etc.). The tradeoff: the refresh cookie now *is* sent to `/auth/login` too (harmlessly ignored there — login doesn't consult it) — a small, standard, accepted cost. `BE-DEC-004` in `design.md` is updated to reflect this as the actual shipped design, not the originally planned one.

---

## Q7 — The refresh endpoint, step by step

1. Read the raw refresh token from the `refresh_token` cookie (its narrow `Path` scoping means this cookie is *only* ever present on requests to `/auth/refresh` in the first place).
2. Hash it (SHA-256, same as at creation) and look up the matching `RefreshToken` row by `tokenHash`.
3. **Not found at all** → the value is bogus/forged/never-issued → reject, force full re-login. (Rotated-away tokens are *not* "not found" — they're found, just marked revoked; see next step.)
4. **Check `revokedAt` before `expiresAt`, in that specific order.** If `revokedAt` is already set, this exact token was already consumed by an earlier refresh — presenting it again is the theft/reuse signal, and it takes priority over the normal expiry check. Checking expiry first could lead you to treat an actively-being-replayed stolen token as a merely mundane "expired, please log in again" case instead of the actual security event it is.
5. If revoked → **revoke the entire family** in one statement: `UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = :familyId AND revoked_at IS NULL` — reject this request, force full re-login.
6. If not revoked but `expiresAt` has passed → reject with a plain "session expired" 401 — normal lifecycle, no theft, no family revocation.
7. If valid (found, not revoked, not expired) — the legitimate rotation path, wrapped in a **single database transaction** so a crash mid-operation can't leave things inconsistent (e.g. old token revoked with no replacement minted, or a replacement minted while the old one is still usable): mark the current row `revokedAt = now()`, insert a new row with the *same* `familyId`, a new random raw token, and a fresh `expiresAt`. The order of "revoke old" vs. "insert new" inside the transaction doesn't matter for correctness — only that both commit atomically together, not the literal statement sequence.
8. Sign a new access token, set both refreshed cookies, return the user profile.

---

## Q8 — Reuse detection: the actual operation, and blast radius

The operation is exactly the single `UPDATE ... WHERE family_id = ? AND revoked_at IS NULL` shown above — one indexed statement (the `family_id` index added back in Phase 2 exists specifically for this), not a loop walking a chain of "replaced-by" pointers.

**Should other currently-valid sessions get force-logged-out too?** No — only the compromised chain. A user's session on their phone and their session on their laptop come from two *separate* login events, each with its own independent `familyId`. Theft of the laptop's refresh token has no connection to the phone's `familyId`, so revoking "the whole family" correctly scopes the blast radius to just the session lineage that was actually compromised, not every device the user is logged in on. (A more paranoid alternative design — revoke *all* of a user's sessions on any reuse event — is a legitimate, stricter tradeoff some systems make; logged as an open design decision below rather than assumed.)

---

## Q9 — `passport-jwt` reading from a cookie instead of a header

`passport-jwt`'s `Strategy` constructor takes a `jwtFromRequest` option — a function whose job is purely to pull the raw JWT string out of the incoming request, however you like. The default, `ExtractJwt.fromAuthHeaderAsBearerToken()`, reads an `Authorization: Bearer <token>` header. To read from a cookie instead, you supply your own extractor: `(req) => req?.cookies?.['access_token'] ?? null` — which only works because `cookie-parser` middleware (wired in Phase 1) has already parsed `req.cookies` before this ever runs.

**The full chain:** `JwtAuthGuard extends AuthGuard('jwt')` — applying `@UseGuards(JwtAuthGuard)` on a route triggers Passport's pipeline *before* the route handler executes: extract the token (via your custom cookie extractor) → verify its signature and expiry against `JWT_ACCESS_SECRET` → if that succeeds, call your strategy's `validate(payload)` method → whatever `validate()` **returns** becomes `request.user`, which the route handler (and, from Phase 4 onward, `RolesGuard`) can then read. If extraction or verification fails at any point, the guard itself throws `401` and the route handler never runs at all.

---

## Q10 — Logout, step by step, and why order matters

1. Read the raw refresh token from the `refresh_token` cookie (if present at all — logout should still "succeed" gracefully even with no session, for a client that's already logged out).
2. **First**, if a token was present: hash it, look it up, and mark that row `revokedAt = now()` in the database. This is the actual security-relevant action — from this point on, that refresh token can never mint another access token again, no matter who holds a copy of the raw cookie value.
3. **Only then**, respond with `Set-Cookie` headers that expire both cookies client-side (same `path`/`sameSite` attributes as when they were set, `maxAge: 0`).

**Why this order, specifically:** if you cleared the cookies first and the DB revocation step then failed for any reason, the user would *appear* logged out (no cookies) while the actual refresh token record was still live and usable — meaning if an attacker had independently captured a copy of that same raw token value, it would still work even after the legitimate user "logged out." Doing the real security action (DB revocation) first means that even if the cookie-clearing step somehow failed afterward, the meaningful guarantee already holds. In practice both happen within the same request, so the risk window is tiny — but the principle (the DB write *is* the security boundary; cookie-clearing is client-side tidiness) is the same one from Phase 0 Q8, now applied as an implementation ordering rule, not just a concept.

**One more thing worth being explicit about:** logout cannot invalidate an already-issued **access token** before its natural (short) expiry — it's stateless, there's no DB record to revoke. This is precisely why access tokens are kept short-lived: logout's real guarantee is "no more tokens can be minted from this session," not "every currently-valid access token stops working the instant you log out."

---

## Implementation Notes (decided while building, not asked as questions above)

- **Response envelope + global error shape, introduced this phase:** `ResponseEnvelopeInterceptor` (wraps success responses as `{ success, data, timestamp }`, calling `instanceToPlain()` internally so `@Exclude()`'d fields like `passwordHash` are stripped in one explicit, ordered step rather than relying on interceptor-chain ordering) and `AllExceptionsFilter` (normalizes every thrown error to `{ success: false, message, timestamp }`) are applied **globally**, with an explicit, narrow exception for `/health/*` routes — those keep Terminus's own standard shape untouched, since they're an ops/infrastructure contract, not part of the frontend-facing API contract described in `design.md`.
- **`/auth/login`, `/auth/refresh`, `/auth/logout` are intentionally NOT behind `JwtAuthGuard`** — each authenticates itself differently (password, refresh cookie, refresh cookie) rather than via a valid access token, so guarding them with the access-token guard would be backwards. Only `/auth/me` is guarded. A global guard + `@Public()` escape-hatch pattern (more useful once many protected routes exist) is deferred to Phase 4, where it actually pays for itself.
- **Refresh tokens are opaque random values, not JWTs** — `crypto.randomBytes(64).toString('hex')`, hashed with SHA-256 for storage. No signing/verification needed for them at all; their validity is checked entirely against the DB row (existence, `revokedAt`, `expiresAt`), which is also what makes revocation possible in the first place (a stateless JWT refresh token couldn't be revoked before its own expiry, defeating the entire point of rotation).

## Open Design Decision Log Addition

| Decision ID | Area | Decision Made | Rationale / Tradeoff | Review Status |
| :--- | :--- | :--- | :--- | :--- |
| `BE-DEC-008` | Reuse-detection blast radius | Revoke only the compromised `familyId`, not all of a user's sessions | Preserves legitimate other-device sessions; a stricter "revoke everything" alternative is a defensible but more paranoid tradeoff | *Pending review* |
| `BE-DEC-009` | Envelope/filter scope | `ResponseEnvelopeInterceptor`/`AllExceptionsFilter` applied globally except `/health/*` | Keeps Terminus's standard health-check shape intact for ops tooling while still guaranteeing the envelope "by construction" everywhere else | *Pending review* |
