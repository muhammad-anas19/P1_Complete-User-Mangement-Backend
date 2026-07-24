# Phase 0 — Understanding Check: httpOnly Cookie Auth & RBAC

> **Purpose of this document:** A senior-engineer-style review of your Phase 0 answers, before any backend code was written. Keep this file — it's meant to be re-read before interviews, not just once. Where you were right, I've said so briefly. Where you were partially right or unsure, I've expanded in full, because that's the part worth re-reading later.
>
> **Context:** Project is an internal Enterprise Admin Dashboard (Users/Products/Orders) with three roles — `Admin`, `Manager`, `Viewer`. Frontend is Next.js (FSD architecture), currently mocked with JWT-in-localStorage. This backend replaces that with NestJS + Postgres + httpOnly cookie auth + RBAC.

---

## Overall Verdict

**Ready to proceed to Phase 1.** Your motivation and security intuition (XSS risk of localStorage, the shape of access/refresh tokens, why migrations matter) are solid — that's the hard-to-teach part, and you already have it. The gaps below are all mechanical/NestJS-specific knowledge, which is exactly what building this project will teach you. None are "wrong instincts," they're "haven't seen the mechanism yet."

| Area | Status |
|---|---|
| Motivation / goal clarity | ✅ Clear and well-reasoned |
| XSS vs. httpOnly cookies | ✅ Correct |
| Login flow shape | ✅ Correct, missing response-body nuance |
| Access/refresh token purpose | ✅ Correct |
| Refresh flow mechanics | ⚠️ Direction right, protocol detail missing |
| CSRF + SameSite | ⚠️ Right threat, mechanism unclear (expected — you asked) |
| Password hashing (salt/pepper) | ⚠️ Right instinct, term undefined (you asked) |
| Logout semantics | ✅ Correct |
| RBAC enforcement location | ⚠️ Right instinct, NestJS mechanism unknown (you asked) |
| Role model (RBAC table vs enum) | ✅ Correct choice, reasoning worth reinforcing |
| Why migrations | ✅ Correct |
| What NOT to put in migrations | 🔲 Unknown — new topic |
| Guard/Interceptor/Pipe/Middleware | 🔲 Unknown — first NestJS project, expected |
| Folder structure discipline | ✅ Correct |
| Unit vs. e2e testing scope | 🔲 Unknown — new topic |

---

## Q1 — Why this project / this skill gap

**Your answer:** First full-stack project, goal to become mid-to-senior over 4–6 months, chosen specifically to go deep on FE + BE security (auth/RBAC).

**Review:** Good — this is a well-scoped goal. One thing to keep sharpening as you go: "security in depth" is not one skill, it's a stack of narrower skills (transport security, session/token lifecycle, input validation, authorization logic, secrets management, dependency hygiene). This project will only cover session/token lifecycle and authorization deeply. Keep a running list of the security topics this project does *not* cover (e.g., we won't do secrets rotation, WAF, dependency scanning here) so you know what to seek out in Project 2.

---

## Q2 — Why httpOnly cookies, what does it prevent, what doesn't it prevent

**Your answer:** Correctly identified that `localStorage.getItem(...)` is trivially readable by any injected script (XSS), and that httpOnly cookies aren't readable by JS. You also correctly flagged CSRF as the residual risk, though the phrasing ("attacker can see the token in header/API call") isn't quite right.

**Correction — this is important:** CSRF does **not** work by an attacker *reading* your token. The attacker never sees the cookie value, ever. CSRF works because of the browser's **ambient authority**: once you're logged into `bank.com` and its cookie is httpOnly + not `SameSite=Strict`/`Secure`-locked-down, visiting a completely unrelated `evil.com` that has `<form action="https://bank.com/transfer" method="POST">` auto-submitted via JS causes your browser to attach `bank.com`'s cookies automatically to that request — because cookies are scoped by domain, not by which page is making the request. The attacker doesn't need to read the token; they just need to make your browser use it on their behalf.

**What httpOnly actually protects against:** token *exfiltration* via injected/malicious JS (XSS reading `document.cookie` or making a fetch to send the token to an attacker's server).

**What httpOnly does NOT protect against:**
- CSRF (described above) — different attack vector entirely, needs its own mitigation (see Q6).
- The *impact* of XSS in general. Even if the attacker can't read the cookie, an XSS payload running in the victim's browser can still call `fetch('/api/users/1', {method:'DELETE', credentials:'include'})` and it will succeed — the cookie rides along automatically. **httpOnly stops token theft, not XSS-driven actions.** That's why XSS prevention (output encoding, CSP, sanitizing rendered HTML) still matters even after you "fix" auth with httpOnly cookies.

---

## Q3 — Login flow

**Your answer:** Validate input → hash password with same strategy used at signup → compare against DB → on match, generate token → set as httpOnly cookie → user is logged in. Correct shape.

**One gap to add:** what goes in the **response body**? The answer is: **not the token** — the token lives only in the `Set-Cookie` header, invisible to JS. The body should return only what the frontend UI needs to render (matches the frontend's `User` type): `{ id, name, email, role }`. Compare this to the current frontend mock, which calls `login(tokens, user)` and expects to receive `accessToken` in the response — that pattern goes away entirely once you're on cookies. The frontend won't manage tokens at all anymore; it just trusts that if a request succeeds, the cookie was valid.

Also worth internalizing now (we'll implement it in Phase 3): the login endpoint should return a **generic** error ("Invalid email or password") regardless of whether the email didn't exist or the password was wrong — never reveal which one, or you've built a user-enumeration oracle.

---

## Q4 — Why access + refresh tokens

**Your answer:** Access token short-lived (~15–20 min), refresh token long-lived (days), frontend refreshes before expiry. Correct.

**What's server-side for each (you weren't asked this directly, but it matters):**
- **Access token**: typically a stateless JWT — the server verifies it with a signature check only, no DB lookup, no server-side record. This is *why* it must be short-lived: you cannot "delete" a JWT before it naturally expires, since the server never stored it (this is the tradeoff of statelessness — see Q8, logout).
- **Refresh token**: should **not** be purely stateless. Store a record server-side (hashed, never plaintext — treat it like a password) associated with the user + a "family"/session id. This is what makes real revocation possible, and it enables **refresh token rotation**: every time a refresh token is used, invalidate it and issue a brand new one. If an old, already-rotated refresh token is ever presented again, that's a signal of theft (someone has a copy of a stolen token) — the server should then revoke the entire token family, forcing full re-login. This is a standard production pattern worth implementing here specifically because it's the kind of detail interviewers probe for.

---

## Q5 — Refresh flow mechanics

**Your answer:** "Cleared above" — but the actual *protocol* (how the frontend knows *when* to call refresh, and what happens to the original failed request) wasn't described. Worth being precise about, since this trips people up in real implementations.

Two workable patterns:

1. **Reactive (401-triggered):** Frontend makes a normal API call. If it comes back `401`, the frontend's fetch wrapper catches it, calls `/auth/refresh` (browser auto-attaches the refresh cookie — no JS ever touches it), and if that succeeds (`200`, new access-token cookie set), **retries the original request once**. If refresh also fails, redirect to login.
   - **Concurrency trap:** if 5 API calls are in flight and all get 401 at once, naively each would call `/auth/refresh` independently — since refresh token rotation invalidates the token on first use, requests 2–5 would fail. Fix: a single in-flight refresh promise that all 401s await, then everyone retries once the one refresh resolves.
2. **Proactive (timer-based):** Frontend can't read the access token's expiry (it's httpOnly), so the server must tell it out-of-band — e.g., the login/refresh response body includes a **non-sensitive** field like `{ accessTokenExpiresAt: <timestamp> }` (a plain JSON field, not a cookie, not the token itself). Frontend sets a timer to call `/auth/refresh` ~1 minute before that timestamp.

Production systems often do **both** (proactive as the common path, reactive 401-retry as the safety net for clock drift/tab-was-asleep cases). We'll build the reactive path first in Phase 3 since it's simpler and correctness-critical; proactive refresh is a nice-to-have polish item for later.

---

## Q6 — CSRF and SameSite (you asked for more detail — here it is)

**The mechanism, precisely:** `SameSite` is a cookie attribute that tells the browser *when* to attach a cookie based on the relationship between the site that owns the cookie and the site the request is going to.

| Value | Sent on same-site requests | Sent on cross-site top-level navigation (e.g. clicking a link) | Sent on cross-site `fetch`/`XHR`/form POST |
|---|---|---|---|
| `Strict` | Yes | **No** | No |
| `Lax` (default in modern browsers) | Yes | Yes (GET only) | No |
| `None` | Yes | Yes | Yes (requires `Secure`) |

For an **API-only backend** consumed exclusively via `fetch`/`XHR` from your own frontend (never via `<form>` submissions or top-level cross-site navigation), `Strict` or `Lax` both fully block the classic CSRF vector, because the browser only attaches `SameSite=Strict/Lax` cookies to *same-site* requests, and a malicious `evil.com` page making a request to your API counts as cross-site. `Lax` is the safer *practical* default because `Strict` has a UX gotcha: if a user clicks a link to your app from an external site (e.g. an email link, or a bookmark opened fresh), even that legitimate same-user navigation won't send the cookie under `Strict`, so they'd appear logged out on first load.

**Layer 2, independent of SameSite — CORS.** Your frontend calls the API cross-origin (different port/domain in dev, possibly different subdomain in prod). Browsers block cross-origin `fetch` from *reading* the response and from *sending* cookies at all unless the server explicitly opts in: `Access-Control-Allow-Origin: <exact frontend origin>` (never `*` when using credentials) **and** `Access-Control-Allow-Credentials: true`, and the frontend request must set `credentials: 'include'`. Misconfigured CORS (wildcard origin + credentials) is itself a common real-world vulnerability, so this isn't just plumbing — it's a security control.

**Layer 3, belt-and-suspenders — CSRF token / custom header check.** Even with `SameSite=Lax`, some older browsers or edge cases exist, so many production APIs add: require a custom header (e.g. `X-Requested-With: XMLHttpRequest`) on all state-changing requests. A cross-site `<form>` POST *cannot* set custom headers — only `fetch`/`XHR` from JS can, and cross-origin JS can't do that without CORS approval. This makes it a cheap, effective extra check. A full CSRF-token (double-submit cookie) pattern is the more "textbook" version of this and is worth implementing in Phase 5 as a hardening exercise, even though `SameSite=Lax` + strict CORS already covers most of the real risk for this project.

**Bottom line for this project:** `SameSite=Lax`, `Secure`, `httpOnly` on both cookies + a locked-down CORS origin allowlist with credentials is the correct baseline. We'll add an explicit CSRF-token check in the hardening phase as a learning exercise, not because it's strictly required given the above.

---

## Q7 — Password hashing, salt (you asked for more detail)

**Salt, precisely:** a random value generated **per password**, stored alongside the hash (bcrypt/argon2 output strings actually embed the salt in the string itself, so you don't manage it separately). Before hashing, the salt is combined with the plaintext password. Why this matters: without a salt, two users with the same password (`"password123"`) would produce the *identical* hash, which (a) leaks that they share a password just by looking at the DB, and (b) makes precomputed **rainbow table** attacks (huge lookup tables of hash → plaintext) effective, since the attacker only needs one table for all users. With a unique salt per user, the attacker would need a separate rainbow table per user — computationally infeasible at scale.

**Pepper** (you didn't ask, but it's the natural next term): a **single, secret, application-wide** value (not stored in the DB — stored in an env var / secret manager), also mixed into the hash. The distinction from salt: salt protects against *cross-user* pattern leaks and is not secret; pepper protects against a **full database dump** — if an attacker steals your DB (including all salts, which are stored in plaintext next to the hashes) but does *not* also compromise your application secrets, the pepper means they still can't brute-force the hashes offline. Pepper is optional but is a legitimate "senior engineer" detail to mention in an interview.

**Which algorithm, and why (the actual property, not just the name):** **Argon2id** (current OWASP recommendation) over bcrypt. The property that matters is **memory-hardness**: bcrypt's cost factor only tunes CPU time, which means an attacker with GPUs/ASICs (cheap parallel compute, cheap-ish memory) can brute-force bcrypt hashes far faster per-dollar than a defender's single CPU can verify them. Argon2id requires a configurable amount of *memory* per hash attempt, which GPUs/ASICs have proportionally far less of relative to raw compute — so it closes that asymmetry. Argon2id specifically (vs Argon2i/Argon2d) is recommended because it hybridizes resistance to both side-channel timing attacks and pure GPU-cracking attacks.

---

## Q8 — Logout

**Your answer:** Client JS can't clear the cookie itself since it has no access to it. Correct.

**Precise mechanism (worth stating fully for an interview):** the client doesn't need to "clear" anything directly — it just calls `POST /auth/logout`, and the **server** responds with `Set-Cookie` headers for both cookie names, using the *same* `Path`/`Domain`/`SameSite` attributes as when they were set, but with an expired/zero `Max-Age`. The browser sees a `Set-Cookie` for a cookie it already has and overwrites/deletes it because the new one is expired. That's the entire "clearing" mechanism — it's not special, it's just a normal cookie overwrite.

**The part that actually matters for security, beyond clearing the cookie:** because access tokens are stateless JWTs, clearing the cookie only stops *this browser* from presenting the token — it does **not** invalidate the token itself. If someone had already copied the access token (e.g., via a narrow XSS window before you patched it, or a proxy log), it remains valid until its natural (short) expiry even after "logout." This is precisely why the refresh token must be **revoked server-side** on logout (delete/mark-revoked its DB record) — that's the part of logout that provides real security, not the cookie-clearing. Short access-token lifetime is what bounds the damage in between.

---

## Q9 — Where RBAC enforcement lives, mechanism (you asked for more detail)

**Your answer:** Should be enforced in the backend, role info stored in the JWT. Correct high-level, mechanism unknown — reasonable for a first NestJS project.

**The actual mechanism, precisely:**

1. When the access token JWT is issued at login, its **payload** includes `{ sub: userId, role: 'Admin' | 'Manager' | 'Viewer', ... }` (or `permissions: [...]` if using the permission-table model — see Q10).
2. A `JwtAuthGuard` (built on Passport's JWT strategy, reading the token from the cookie rather than an `Authorization` header) runs on every protected route. It verifies the JWT signature, and if valid, attaches the decoded payload to `request.user`.
3. A separate `RolesGuard` runs after that. It reads **route-level metadata** — set via a custom decorator like `@Roles('Admin', 'Manager')` placed on a controller method — using NestJS's `Reflector.getAllAndOverride()`, compares it against `request.user.role`, and throws `403 Forbidden` if there's no match.
4. Both guards are wired via `@UseGuards(JwtAuthGuard, RolesGuard)` on the controller/route, or registered globally with per-route opt-out via a decorator like `@Public()`.

**One nuance worth understanding now, because it's a real tradeoff:** if the role is baked into the JWT at login time, and an Admin later changes that user's role to `Viewer`, the change **won't take effect until the access token naturally expires and is refreshed** (up to ~15–20 min later per your own answer in Q4) — the old JWT still says `Admin` and the guard has no way to know it's stale without a DB check. For a dashboard where instantly revoking elevated access might matter (e.g., an admin is fired), this is a real gap. Two fixes, in increasing order of freshness-vs-cost: (a) accept the short window as fine given the token is already short-lived — reasonable for this project; (b) look up the role fresh from the DB on every request instead of trusting the JWT payload (always correct, adds one indexed query per request — cheap with Postgres + an index on `users.id`); (c) cache role/permissions in something like Redis with active invalidation on role change (fast *and* fresh, but more infrastructure than this project needs). We'll implement (a) by default and document (b) as the upgrade path — good discussion point for an interview.

---

## Q10 — Role+permission table vs. hardcoded enum (you asked for more detail)

**Your answer:** Role + permission table, for flexibility. Good instinct, and the right choice for a *learning* project even though it's technically more than the current PRD strictly requires.

**The actual tradeoff:**

| | Hardcoded enum role (`Admin`/`Manager`/`Viewer` as a Postgres enum or string column) | Normalized `roles` + `permissions` + `role_permissions` tables |
|---|---|---|
| Complexity | Low — one column, one `@Roles()` decorator check | Higher — 3–4 tables, seeding required, joins to resolve a user's effective permissions |
| Matches current PRD | Exactly — PRD defines exactly 3 fixed roles with fixed capabilities | Over-engineered *for the PRD as written* |
| Flexibility if requirements grow | Poor — adding a 4th role or a role with a custom subset of permissions requires a code change and redeploy | Good — new roles/permissions are data changes, not code changes |
| Granularity | Role-level only (`Manager` either can or can't edit Products — no in-between) | Permission-level (`products:read`, `products:update`, `users:read` — a role is just a named bundle of these) |
| Testing surface | Small | Larger — need to test permission resolution logic itself, not just role string equality |

**Why your choice is still right here despite the PRD only needing 3 roles:** your stated goal (Q1) is to learn production-grade RBAC in depth, not to ship the minimum viable version of this specific PRD. A permission-table model is exactly the kind of thing real production systems use once they outgrow "3 fixed roles" (which happens fast — e.g., "Manager but can also delete Orders" becomes a real ask within a few sprints of any real product). Building it now, even though the PRD only exercises 3 roles, is a legitimate and deliberate scope decision **for learning purposes** — just be able to articulate in an interview that you know this is more than the PRD strictly demands, and *why* you chose it anyway (this is precisely the kind of "over-engineering vs. right-sizing" judgment call senior engineers get asked to defend).

---

## Q11 — Why migrations instead of `synchronize: true` / `db push`

**Your answer:** Easier for new devs / schema changes. Correct, but worth having the fuller list ready for an interview:

- `synchronize: true` **diffs your entity classes against the live DB schema and auto-alters it** on every app boot. In production, this can silently **drop columns or tables** when a type changes in a way the ORM interprets as "recreate," destroying data with no warning and no confirmation step.
- If you run multiple app instances (any real deployment), each instance booting with `synchronize: true` can race to alter the schema simultaneously — undefined, dangerous behavior.
- There's no reviewable diff. A migration file is a piece of code that goes into a Git PR, gets reviewed like any other change, and has a clear author + timestamp + reason. `synchronize` changes happen invisibly at runtime.
- No rollback path. A migration file has an explicit `up()`/`down()` (or reversible SQL), so a bad deploy can be undone. `synchronize` has no "undo."
- No historical record. Six months from now, "why does this column exist / when did it change type" is answerable by reading migration files in order; it's unanswerable with `synchronize`.

---

## Q12 — What should NOT go in a migration file

**Your answer:** Not sure — reasonable, this is a new topic.

Things that tempt people but shouldn't go in a migration:

- **Bulk / test / fake data.** Migrations should describe *schema* shape, not populate it with sample rows. Use a separate **seed script** for that (small, fixed reference data — like literally seeding the 3 fixed roles — is a defensible exception, since that's structural, not "data").
- **Business logic.** A migration should never call application services, hash passwords via app code, send emails, etc. It's a schema change, run by a migration tool, potentially outside your app's runtime context entirely.
- **Environment-specific secrets or config.** Never hardcode a real API key, connection string, or credential inside a migration file — it becomes permanent Git history.
- **Large destructive backfills run inline.** E.g., "update 10 million existing rows to set a new `NOT NULL` column" inside a migration can lock the table for the duration of the deploy. Real production migrations often split this into: (1) add nullable column, (2) backfill in batches via a background job, (3) a *later* migration adds the `NOT NULL` constraint once backfill is confirmed complete.
- **Editing an already-applied migration file.** Once a migration has run anywhere (teammate's machine, staging, prod), treat it as immutable history — fix mistakes with a **new** migration, the same way you wouldn't `git commit --amend` a commit someone already pulled.

---

## Q13 — Guard vs. Interceptor vs. Pipe vs. Middleware

**Your answer:** Not sure — expected for a first NestJS project. Full explanation, in actual request-lifecycle order:

```
Request
  → Middleware        (Express-level; runs first, before Nest's routing context;
                        no access to route handler metadata; good for raw logging,
                        body parsing, cookie parsing)
  → Guards             (CanActivate; has access to ExecutionContext + route metadata
                        via Reflector; returns true/false; used for AUTHENTICATION
                        — "who are you" — and AUTHORIZATION — "are you allowed here")
  → Interceptors (pre)  (wrap the handler; can run logic before AND after, like
                        middleware for the Observable response stream; good for
                        logging timing, transforming responses, caching)
  → Pipes              (run just before the handler receives its arguments; used
                        for VALIDATION and TRANSFORMATION of incoming data, e.g.
                        ValidationPipe + class-validator DTOs, or ParseIntPipe)
  → Route Handler       (your actual controller method logic)
  → Interceptors (post) (can transform the outgoing response before it's sent)
  → Exception Filters   (catch anything thrown anywhere above and turn it into a
                        consistent HTTP error shape)
```

**Mapped to this project specifically:**
- **Auth (who are you):** `JwtAuthGuard` — reads the httpOnly cookie, verifies the JWT, attaches `request.user`.
- **RBAC (are you allowed):** `RolesGuard` — reads `@Roles()` metadata + `request.user.role`, throws 403 if mismatched.
- **Input validation:** global `ValidationPipe` + `class-validator` decorators on DTOs (e.g., `@IsEmail()` on the login DTO's email field) — rejects malformed requests before they ever reach your service logic.
- **Consistent error shape:** a global `AllExceptionsFilter` catching everything and returning the `{ success: false, message, ... }` envelope shape the frontend's `fetchClient.ts` already expects.
- **Cross-cutting logging/audit:** an `Interceptor` is the natural place for "log every request with timing" or "record this action to an audit log table" without cluttering every controller method.

---

## Q14 — Why folder structure discipline matters

**Your answer:** Prevents things from becoming messy/unmanageable with multiple modules. Correct — same argument as the frontend's own "10-module rule" in the PRD, applied to NestJS. We'll make module boundaries explicit (e.g., `auth`, `users`, `roles`) each owning their own controller/service/DTOs/entities, with a shared `common/` for cross-cutting guards/filters/pipes/decorators — mirroring the frontend's `shared` vs. feature-layer separation conceptually, even though NestJS's module system is structurally different from FSD.

---

## Q15 — Unit vs. e2e/integration testing

**Your answer:** Not sure — new topic, expected.

- **Unit test:** tests **one class/function in isolation**, with all its dependencies mocked (no real DB, no real HTTP, no network). For login, this means testing `AuthService` methods directly — e.g., "given a user record with hash X, `validatePassword('wrongpw')` returns false," "given valid credentials, `login()` calls the token-signing function with the right payload" — fast (milliseconds), and precise about *which* branch of logic is being tested.
- **e2e / integration test:** spins up the **actual NestJS application** (via `Test.createTestingModule()` + `supertest`) against a **real test database**, and sends an actual HTTP request to `POST /auth/login`. This validates that the whole chain — guard, pipe, controller, service, DB, cookie-setting — is wired together correctly. For login specifically, this is where you'd assert things a unit test can't see at all: that the response actually has a `Set-Cookie` header, that it has the `HttpOnly`/`Secure`/`SameSite` flags set, that the response body does *not* contain the raw token, and that invalid credentials really produce a `401` through the full real pipeline (not just that a mocked function returned `false`).

**Rule of thumb going forward:** unit tests for business/security logic branches (password comparison, token expiry math, permission resolution), e2e tests for "does the actual HTTP contract behave as documented" (status codes, cookie flags, response shapes) — both are needed, they check different failure modes.

---

## Suggested Reading Order (before Phase 1 questions)

1. NestJS official docs: **Guards**, **Interceptors**, **Pipes**, **Middleware**, **Exception Filters** (in that order — the request lifecycle order above).
2. OWASP Cheat Sheet: **Password Storage** (salt/pepper/Argon2id in more depth).
3. OWASP Cheat Sheet: **Cross-Site Request Forgery Prevention** (SameSite + double-submit pattern in more depth).
4. MDN: **Set-Cookie**, specifically the `HttpOnly`, `Secure`, `SameSite`, `Path`, `Max-Age` attributes.
5. Whatever ORM we settle on in Phase 1 (TypeORM or Prisma) — read their **migrations** documentation specifically, not just the general docs.

---

## Rapid-Fire Interview Prep (re-read this before interviews)

1. *Q: If TLS/HTTPS isn't enforced, does httpOnly still protect your token?* — A: No. `HttpOnly` only stops JS from reading the cookie; it does nothing against a network-level attacker reading unencrypted traffic. That's what the `Secure` flag + actual HTTPS enforcement is for — they're independent protections.
2. *Q: Why scope the refresh-token cookie's `Path` to `/auth/refresh` instead of `/`?* — A: Defense in depth — even if some other endpoint had an XSS or logging bug that exposed cookies, a refresh token scoped to a narrow path is sent (and therefore exposed) on far fewer requests than one sent site-wide.
3. *Q: What is refresh token reuse detection, precisely?* — A: If refresh tokens rotate on every use (old one invalidated, new one issued) and an *already-invalidated* token is presented again, that's proof someone has a stolen copy racing the legitimate user — the server should revoke the whole session/family immediately, not just deny that one request.
4. *Q: Why is a generic "invalid email or password" error better than "user not found"?* — A: Prevents user enumeration — an attacker shouldn't be able to tell which emails are registered by watching for different error messages.
5. *Q: Why does the access token stay stateless (JWT) but the refresh token get a DB record?* — A: Stateless tokens can't be individually revoked before expiry, so keep their lifetime short and accept that risk; the refresh token is long-lived, so it needs a server-side kill switch, which requires it to be stateful (a DB row you can delete/rotate).
6. *Q: What's the actual difference between authentication and authorization in this system?* — A: Authentication (`JwtAuthGuard`) answers "is this a valid, logged-in user" — it doesn't care what they're allowed to do. Authorization (`RolesGuard`) runs after, and answers "given who they are, are they allowed to hit *this specific* route."
