# Access Tokens, Refresh Tokens, and Token Families — Revision Notes

> **Origin of this doc:** written up from your own explanation of the mechanism (hotel analogy, step-by-step lifecycle, family-ID reasoning) — it was accurate on every structural point. One factual correction made: our actual password verification is **Argon2id** (`argon2.verify()`), not bcrypt — fixed throughout. Everything else below is your mental model, cleaned up, cross-referenced to the real code (`token.service.ts`, `auth.service.ts`), and extended with the one case your notes didn't cover (a completely bogus/unknown token). Read this as your interview-revision copy of this concept.

---

## 1. The core problem, as an analogy

You check into a hotel. The receptionist gives you two things:

- A **room key** (access token) — works on your room's door specifically, for a limited time.
- Your **passport, kept at reception** (refresh token) — proves who you are, used to get a *new* room key if yours stops working.

Why two things instead of one? If you lose your room key, the hotel doesn't want whoever finds it to have access forever — but they also don't want you walking back to reception to re-prove your identity every time you want back into your room. The split exists to solve *two different problems* with *two different lifetimes*.

## 2. Why not just one long-lived token?

If a JWT never expired and got stolen, the attacker has permanent access — and because JWTs are **stateless** (the server verifies a signature; it doesn't keep a list of "currently valid tokens"), there is no way to revoke one before it naturally expires. That's the core limitation this whole design works around.

The fix looks obvious: make the token short-lived. But now a new problem appears — if the *only* token expires every 15 minutes, the user gets logged out mid-session constantly. Neither extreme works alone. **Two tokens, two lifetimes, two different revocation strategies** is what resolves both problems at once:

| | Access Token | Refresh Token |
| :--- | :--- | :--- |
| **Purpose** | Authorizes actual API calls | Used only to obtain a new access token |
| **Contents** | JWT: `{ sub, email, role, iat, exp }` | A random, opaque string — no structure, no meaning |
| **Lifetime** | 15 minutes (`JWT_ACCESS_EXPIRES_IN`) | 7 days (`JWT_REFRESH_EXPIRES_IN`) |
| **Where it lives** | `httpOnly` cookie only — **never stored server-side** | `httpOnly` cookie **and** a hashed row in the `refresh_tokens` table |
| **Can it be revoked before it expires?** | No — stateless, no DB record to delete | Yes — its DB row can be marked `revoked_at` at any time |
| **Real function that creates it** | `TokenService.signAccessToken()` | `TokenService.issueRefreshToken()` |

The access token being un-revocable is *why* it's kept short — 15 minutes is the maximum possible damage window if one leaks, full stop, nothing else can shorten that. The refresh token being long-lived is *only* safe because it's the one token backed by a real, deletable database row.

## 3. Login, step by step (matching the real code)

```
POST /auth/login  { email, password }
```

1. **Verify the password** — `AuthService.login()` calls `PasswordService.verify(user.passwordHash, dto.password)`, which internally is `argon2.verify()` — **Argon2id, not bcrypt** (chosen for memory-hardness; see `qa/phase-0-auth-rbac-understanding-check.md` Q7 for the full reasoning).
2. **Generate the access token** — `TokenService.signAccessToken(user)` builds and signs a JWT: `{ sub: user.id, email, role: user.role.name }`, expiry attached automatically by `@nestjs/jwt`.
3. **Generate the refresh token** — *not* a JWT. `TokenService`'s private `generateRawToken()` calls `crypto.randomBytes(64).toString('hex')` — 512 bits of pure randomness, no embedded meaning at all. Its only job is to be unguessable.
4. **Hash the refresh token before storing it** — exactly the same instinct as password hashing, `createHash('sha256').update(raw).digest('hex')`. The raw value goes in the cookie; only the hash goes in the database. See Section 6 for *why* SHA-256 and not Argon2id here specifically.
5. **Both values ride out as cookies** — `access_token` (`Path=/`) and `refresh_token` (`Path=/auth`), both `httpOnly`, `Secure` (prod), `SameSite=Lax`.

## 4. Making requests — why it's fast

```
GET /users
Cookie: access_token=...
```

`JwtAuthGuard` → `JwtStrategy` verifies the JWT's **signature only** — no database call at all. This is the entire point of a stateless token: authorization on every request costs one cryptographic check, not one query. The tradeoff (already logged in `qa/phase-0-...md` Q9): if an admin changes this user's role right now, this access token still says the *old* role until it naturally expires (≤15 min) — a deliberate, accepted staleness window, not an oversight.

## 5. Access token expires — the refresh flow

```
GET /users → 401 (access token expired)
POST /auth/refresh   (refresh_token cookie sent automatically)
```

`TokenService.rotate(rawToken, meta)` — the actual logic, in the exact order it runs, is a **four-way branch**, not three (your notes covered three of the four — adding the missing one):

1. **Token hash not found in the DB at all** → completely bogus/forged/never-issued value → reject immediately, force full re-login. *(This is the case your notes didn't cover — it matters because it's the "attacker is just guessing random strings" case, distinct from "attacker has a copy of a real, once-valid token.")*
2. **Found, but `revoked_at` is already set** → this exact token was already consumed by an earlier refresh — **the theft signal**, checked *before* expiry on purpose (see Section 7).
3. **Found, not revoked, but `expires_at` has passed** → ordinary session expiry, no theft implied, just "please log in again."
4. **Found, not revoked, not expired** → the legitimate path: rotate.

Rotation itself (still inside `TokenService.rotate()`, wrapped in one DB transaction so it can't half-complete): mark the *current* row `revoked_at = now()`, insert a *new* row with a fresh random token and the **same `familyId`**, return it. The controller sets two fresh cookies; the user notices nothing.

## 6. Why SHA-256 for the refresh token, not Argon2id (the same question as passwords, different answer)

Password hashing must be *slow*, because the input space is small and human-guessable (people reuse `"password123"`) — Argon2id's memory-hardness exists specifically to make guessing expensive. A refresh token is the opposite: it's already 512 random bits, nobody is "guessing" it — the only realistic threat is someone obtaining the *exact* raw value some other way (a DB leak of an unhashed column, a log line). A fast hash (SHA-256) fully closes that specific risk, and using a deliberately slow hash here would just waste real CPU on every single refresh request for zero additional security benefit.

## 7. Why rotate at all — and why check "revoked" before "expired"

Without rotation, a single stolen refresh token is valid for its *entire* lifetime (7 days) — one theft, a full week of silent access. Rotation means a token is only ever valid for **one use**; the moment it's used, it's dead, and a replacement takes its place.

This is exactly what makes reuse **detectable**: if a token that's already marked revoked gets presented again, there are only two explanations — a rare network retry racing itself, or someone else has an independent copy of a token that should no longer exist. The code can't tell those apart, so it treats it as theft. This is precisely why the revoked-check runs **before** the expiry-check in `rotate()` — an already-revoked-but-not-yet-expired token is the active attack signal; checking expiry first could mask it behind a much milder "just expired, log in again" response instead of the alarm it actually is.

## 8. `familyId` — what it's for, and why it beats scoping by `userId`

Every refresh token row has a `familyId` (see `refresh_tokens` schema, `qa/phase-2-schema-migrations-understanding-check.md`). It's assigned once, at login, and every token minted by every subsequent rotation of that same session **keeps the same `familyId`** — think of it as "which login session produced this chain of tokens," not "which user owns this token" (that's a separate column, `userId`).

**When reuse is detected**, the fix-it action is one indexed SQL statement:
```sql
UPDATE refresh_tokens SET revoked_at = NOW()
WHERE family_id = :familyId AND revoked_at IS NULL;
```
This kills every currently-valid token descended from that one login — including, deliberately, the attacker's stolen chain *and* whatever the legitimate user's browser currently holds, since by definition they share the same family once theft has happened somewhere in that chain.

**Why not just scope revocation by `userId` instead?** Your laptop/phone/tablet framing is exactly the right way to think about this: logging in on three devices creates **three separate login events**, and therefore three separate `familyId`s for the same `userId`. If your laptop's refresh token is stolen, revoking *by `familyId`* kills only that one compromised chain — your phone and tablet sessions, each their own family, are untouched. Revoking *by `userId`* instead would force-logout every device you're signed in on, every time, for any single-device compromise — correct in spirit, but a much bigger, unnecessary blast radius. `familyId` is what lets "contain the damage" mean "just this session," not "this entire user."

**Why not scope even more narrowly, per-token?** Because a compromised chain has already produced descendants — Token A stolen → rotated to B → rotated to C. If you only ever revoked the *specific* token presented (just A), an attacker who captured a *later* token in the chain (say, B) could keep rotating forward indefinitely; you'd only ever be closing the door the attacker already walked through, one step behind. Revoking the whole family closes every door in that chain at once, regardless of which specific token the attacker actually holds a copy of.

## 9. Full lifecycle, current implementation

```
POST /auth/login
  → password verified (argon2)
  → access_token (JWT, 15m) — stateless, cookie only
  → refresh_token (random, 7d) — row inserted: { userId, tokenHash, familyId: new, expiresAt, revokedAt: null }
  → both set as httpOnly cookies

  ... 15 minutes pass, or many requests happen in between ...

GET /some-protected-route → 401 (access token expired)

POST /auth/refresh (refresh_token cookie auto-sent)
  → hash presented token, look up by tokenHash
  → not found?      → reject, full re-login required
  → revoked_at set? → REUSE DETECTED: revoke entire family, reject, full re-login required
  → expired?        → reject ("session expired"), no family revocation, no alarm
  → else: legitimate rotation —
      mark current row revoked_at = now()
      insert new row: same familyId, new tokenHash, new expiresAt
      issue new access_token
  → both cookies refreshed, user notices nothing

POST /auth/logout
  → hash presented refresh_token, mark that row revoked_at = now()
  → clear both cookies client-side
  → (access_token itself still technically valid until its own natural
     15-min expiry — logout guarantees "no more tokens from this session,"
     not "this specific access token stops working instantly")
```

---

## Rapid-fire self-check (re-read before an interview)

1. *Why can't you revoke a stolen access token immediately?* — It's a stateless JWT; there's no server-side record to delete. Short expiry is the only mitigation.
2. *Why is the refresh token not a JWT?* — It doesn't need to carry any data — its only job is to be an unguessable key into a DB row that *does* carry the real state (`userId`, `familyId`, `revokedAt`).
3. *What's the actual difference between salt/pepper (passwords) and hashing a refresh token?* — Passwords need slow, memory-hard hashing to resist guessing a small, human-chosen input space. Refresh tokens are already maximum-entropy random values; a fast hash (SHA-256) is correct and sufficient because there's nothing to "guess."
4. *Why check `revoked_at` before `expires_at` in the refresh logic?* — An already-revoked token being replayed is an active theft signal and must not be mistaken for the much milder "just expired" case.
5. *Why `familyId` instead of `userId` for revocation scope?* — Multiple devices = multiple independent login events = multiple families under one user. Revoking by family contains damage to the compromised session only; revoking by user would log out every device unnecessarily.
6. *What does logout actually guarantee, precisely?* — That the refresh token can never mint another access token again. It does **not** invalidate the current access token before its own short natural expiry.

## Related docs

- [qa/phase-0-auth-rbac-understanding-check.md](../qa/phase-0-auth-rbac-understanding-check.md) — Q4–Q8: original access/refresh conceptual grounding, password hashing depth.
- [qa/phase-2-schema-migrations-understanding-check.md](../qa/phase-2-schema-migrations-understanding-check.md) — Q4: the `refresh_tokens` table design itself.
- [qa/phase-3-cookie-auth-understanding-check.md](../qa/phase-3-cookie-auth-understanding-check.md) — Q7–Q8: the rotation/reuse-detection logic as actually implemented.
- [walkthroughs/phase-3-auth-code-walkthrough.md](../walkthroughs/phase-3-auth-code-walkthrough.md) — the real `TokenService`/`AuthService` code, line by line.
