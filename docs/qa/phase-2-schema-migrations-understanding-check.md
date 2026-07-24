# Phase 2 — Understanding Check: Database Schema & Migrations

> Companion to [phase-0](phase-0-auth-rbac-understanding-check.md) and [phase-1](phase-1-scaffold-db-understanding-check.md). Same format.

## Overall Verdict

**Ready to proceed to Phase 2 implementation.** Two answers (Q6, Q10) were correct with good independent reasoning — worth noting explicitly, not just the gaps. The main correction that matters most going forward is the **cardinality mislabeling in Q1/Q2** (calling a one-to-many relationship "one-to-one," and modeling a genuinely many-to-many relationship with a plain foreign key) — this is a very common early mistake and worth drilling until it's automatic, since it directly determines whether your schema can even represent what the PRD needs.

| Q | Topic | Status |
|---|---|---|
| 1 | User↔Role and Role↔Permission cardinality | ⚠️ Mislabeled — corrected below, this is the important one |
| 2 | Why still build a join table | ✅ Landed on the right *implementation* for User↔Role (a `roleId` FK, not a join table) even though the reasoning given was slightly off; Role↔Permission needs the join table your Q1 answer didn't have |
| 3 | UUID vs. auto-increment | 🔲 New topic — full pros/cons below |
| 4 | `refresh_tokens` columns + why hash | ⚠️ Right instinct on hashing, schema design needs a structural correction (update-in-place vs. insert-new-row-per-rotation) |
| 5 | UNIQUE constraints | ⚠️ Named the wrong column (`id`, already unique by being a primary key) — the real answer is `email` |
| 6 | Index on `email` | ✅ Correct, and you identified the write-cost tradeoff unprompted — expanded below |
| 7 | `migration:generate` mechanics | 🔲 New topic |
| 8 | `up()`/`down()` | 🔲 New topic |
| 9 | Seed vs. migration for roles/permissions | ✅ Correct instinct, expanded to "depends on what" |
| 10 | Soft delete | ✅ Correct, and the reasoning (referential integrity with audit logs/orders) was exactly right |

---

## Q1 & Q2 — Cardinality (the important correction)

**Your answer:** User↔Role called "one to one"; Role↔Permission called "one to many"; permissions modeled as a table with a `roleId` FK column directly on it.

**The correction, precisely:**

**User ↔ Role is many-to-one (many users → one role), not one-to-one.** The test for cardinality isn't "does this user have only one role" (true, but that's only half the picture) — it's "can the *other side* of the relationship be shared." Can two different users both be `Admin` at the same time? Yes, obviously — an admin dashboard with only one possible Admin account ever would be unusable. Since **many** users can point at the **same** role row, this is many-to-one from the `User` side (equivalently, one-to-many from the `Role` side: one role, many users). This is exactly why your Q2 implementation instinct was actually correct despite the mislabel — a plain `roleId` foreign key column on `users` is precisely how you implement a many-to-one relationship. A true one-to-one would need a UNIQUE constraint on that same FK column (guaranteeing no two users share a role) — which would make no sense here.

**Role ↔ Permission is many-to-many, not one-to-many — and this is the one that actually needs a join table.** Ask the same test: can a single permission (e.g. `products:read`) belong to more than one role? Yes — both `Manager` and `Viewer` need `products:read`. And can a single role have more than one permission? Also yes. **Both sides can be "many"** — that's the definition of many-to-many, and a plain foreign key column can *never* represent it (a FK column can only ever point one row at one other row — that's inherently one-to-many, never many-to-many). If you modeled `permissions` with a `roleId` column as you proposed, you'd be forced into **duplicate rows**: `{id:1, roleId:Admin, name:"products:read"}` and `{id:2, roleId:Manager, name:"products:read"}` as two separate, disconnected rows for what should be one reusable concept. That duplication is exactly the bug this schema needs to avoid — if you ever rename `"products:read"`, you'd have to find and update every duplicated copy instead of one row.

**The actual fix — a join table**, which is the *only* way a relational database expresses many-to-many:
```
roles                role_permissions              permissions
┌──────────┐         ┌───────────────┐             ┌──────────────┐
│ id (PK)  │◄────────┤ role_id (FK)  │             │ id (PK)      │
│ name     │         │ permission_id │────────────►│ name (unique)│
└──────────┘         │  (FK)         │             └──────────────┘
                      └───────────────┘
                      (composite identity —
                       one row per role+permission
                       pairing)
```
`permissions` itself has **no** `roleId` column at all — it's a flat, reusable list of atomic capabilities. The join table `role_permissions` is *only* rows of `(roleId, permissionId)` pairs, expressing "this role includes this permission." We'll build this via TypeORM's `@ManyToMany` + `@JoinTable()` decorators, which generates exactly this join table under the hood — you get the correct schema without hand-writing a separate join entity class.

---

## Q3 — UUID vs. auto-increment (full pros/cons, as requested)

| | Auto-increment integer | UUID |
|---|---|---|
| **Security** | Sequential and guessable — an attacker who sees `/users/42` can trivially try `/users/1` through `/users/1000` to enumerate every account (a real vulnerability class called IDOR — Insecure Direct Object Reference — made trivial by sequential IDs) | Effectively unguessable — knowing one valid ID reveals nothing about any other valid ID |
| **Information leakage** | Leaks business metrics — if the newest user is `id: 4`, you've just told anyone watching that only 4 accounts exist | Leaks nothing about record count or growth rate |
| **Storage size** | Compact — 4 bytes (int) / 8 bytes (bigint) | Larger — 16 bytes per value, and every index on it is proportionally bigger |
| **Index/insert performance** | Sequential values insert cleanly at the end of a B-tree index — good locality, few page splits | Fully random UUIDs (the classic `uuid_v4`) insert at random positions in the index, causing more page splits and slightly worse write performance at scale. (Time-ordered variants like UUIDv7 exist specifically to fix this — worth a quick check of what your installed Postgres 18 supports natively, since this is an active, evolving area I won't assert specifics on without checking) |
| **Distributed generation** | Requires a single sequence generator — awkward if multiple services/instances need to generate IDs without coordinating | Can be generated anywhere (client, any service instance) with no coordination and no collision risk |
| **Human debugging** | Easy to read/type/remember while debugging (`user 42`) | Long, unmemorable strings in ad-hoc SQL sessions |

**For this project specifically:** UUIDs for `users` (and, for consistency, every entity) — the security property (no enumeration) matters more here than the raw performance difference, especially since this project's whole point is production-grade security discipline. This confirms the choice already logged as `BE-DEC-003` in `design.md` (currently marked "Pending Review" — updating it to confirmed after this explanation).

---

## Q4 — `refresh_tokens` schema (structural correction needed)

**Your answer:** `id`, `token`, `createdAt`, `updatedAt`, `expiresAt` (expiry recalculated 30 days from the most recent update). Hashing reasoning: correct that a DB-access attacker could otherwise use the plaintext value directly.

**The hashing reasoning, made precise:** you're right, and it's worth being precise about *why* it's not quite the same justification as password hashing. A password hash defends against an attacker *guessing* a low-entropy, human-chosen secret (that's why Argon2id's slowness matters — it makes each guess expensive). A refresh token is already a high-entropy random value (e.g. 256 random bits) — nobody is "guessing" it. The risk here isn't brute-force guessing, it's **direct reuse of a stolen value**: if the raw token sat in the DB in plaintext and an attacker got read access to that table (a DB dump, a compromised backup, an over-privileged internal tool), they could use that exact value as a valid refresh token immediately — no cracking needed at all. Because there's no guessing to slow down, a **fast** one-way hash (e.g. SHA-256) is actually the *correct* choice here, not Argon2id — using a deliberately slow hash for something checked on every single refresh request would just waste CPU for no security benefit, since the thing you're protecting against (DB leak → direct reuse) doesn't care how fast the hash is.

**The structural correction — this is the important one:** your design has one row per user, mutated in place on every refresh (`updatedAt` changes, `expiresAt` recalculated from it). That breaks the exact rotation/reuse-detection mechanism we established in Phase 0 (Q4–Q5). If you overwrite the same row's token value on every refresh, you **destroy the history** needed to detect theft — there's no way to tell "this old token was already used and replaced" if the old value is gone. The correct design **inserts a new row on every refresh** instead of updating the old one:

```sql
refresh_tokens
├── id              uuid, PK
├── user_id         uuid, FK → users.id
├── token_hash      varchar, UNIQUE   -- SHA-256 of the raw token, never plaintext
├── family_id       uuid              -- groups every token descended from one login
├── expires_at      timestamptz       -- fixed at creation, never recalculated in place
├── revoked_at      timestamptz, NULL -- set the instant this token is used/rotated
├── ip_address      varchar, NULL     -- optional device/session metadata
├── user_agent      varchar, NULL
└── created_at      timestamptz
```

- **On login:** insert row 1, `familyId = newUuid()`, `revokedAt = null`.
- **On refresh:** look up the presented token's row by `tokenHash`. If found and `revokedAt IS NULL` → set `revokedAt = now()` on that row, **insert a new row** with the same `familyId`. If found but `revokedAt` is **already set** → this exact token was already used once — reuse detected — revoke every row sharing that `familyId` (kill the whole session chain), force full re-login.
- `family_id` is what makes "revoke the whole chain" a single indexed `UPDATE ... WHERE family_id = ?` instead of needing to walk a linked chain of "replaced-by" pointers.

---

## Q5 — UNIQUE constraints (wrong column named)

**Your answer:** `id` on `users` and `id` on `roles`.

**Correction:** a primary key is *already* unique by definition — every PK in every table is implicitly `UNIQUE NOT NULL`, so declaring "id should be unique" isn't adding anything; it's restating what a PK already guarantees. The column that actually needs an *explicit* `UNIQUE` constraint you have to add yourself is **`users.email`** (and arguably `roles.name`, so you can never accidentally create two rows both named `"Admin"`).

**Why database-level enforcement matters more than an application-level check (the part not yet answered):** imagine the signup/invite flow does `SELECT * FROM users WHERE email = ?` first, sees no result, and only *then* runs `INSERT`. Now imagine two requests for the same email arrive within milliseconds of each other (a real scenario — double-clicked submit button, a retried request, two app server instances handling concurrent traffic). Both requests can run their `SELECT` check *before either one's* `INSERT` completes — both see "no existing user," both proceed to insert, and now you have two rows with the same email. This is a **race condition** (specifically, a **TOCTOU** bug — time-of-check to time-of-use), and no amount of careful application code timing can fully close it, because the check and the insert are two separate operations with a gap between them. A database-level `UNIQUE` constraint closes this gap completely and atomically — the second `INSERT` simply fails at the database engine level, no matter how the race unfolds, and regardless of application bugs, multiple app instances, or someone writing to the DB directly bypassing your API entirely.

---

## Q6 — Index on `email` (correct, expanded)

**Your answer:** correct and, notably, you identified the write-cost tradeoff (indexes speed reads, slow writes) without being asked — that's a solid instinct worth keeping.

**Why specifically `email`, beyond "SELECTs are faster in general":** `email` is looked up on **every single login attempt** — the highest-frequency query type in an auth system. Without an index, that lookup is a full table scan (checking every row) that gets linearly slower as the `users` table grows; with an index, it's a near-constant-time B-tree lookup regardless of table size. One more detail worth connecting: in Postgres, adding a `UNIQUE` constraint (the Q5 fix) **automatically creates a unique index** to enforce it — so once `email` has its `UNIQUE` constraint, the performance-motivated index you're asking about here comes along for free as the same underlying mechanism, not a separate thing you need to add.

**The write-cost tradeoff you already identified, made precise:** every `INSERT`/`UPDATE` touching an indexed column must also update that index's B-tree structure, not just the table row — so more indexes means slower writes and more storage, which is why you index columns that are actually queried frequently (`email`), not every column defensively.

---

## Q7 — What `migration:generate` actually compares

**Your answer:** not sure — new topic, here's the full mechanism.

`typeorm migration:generate` does two things and diffs them: (1) it connects to the **real, live target database** (via `data-source.ts`) and introspects its **current actual schema** — what tables/columns/types/constraints genuinely exist right now; (2) it reads your **TypeScript entity classes** — the schema your code *says* it wants. It computes the difference between "what's actually there" and "what the entities describe," and writes that difference as SQL statements into a new migration file's `up()` (and the inverse into `down()`).

This is precisely why the CLI needs its own working DB connection (`data-source.ts`, built in Phase 1) — unlike a purely declarative/schema-first tool, TypeORM's migration generation is fundamentally a **diff against a real database's current state**, not a diff against an abstract "previous version" file.

**Empty database vs. partially-migrated database:** against a completely fresh database (no tables at all, or only TypeORM's own internal migrations-tracking table), the diff is "nothing → everything my entities describe," so the generated migration creates every table from scratch. Against a database that's already had earlier migrations applied, TypeORM knows (via that same internal tracking table) which migrations have already run, so the diff is much smaller — just whatever changed in your entities *since* the last migration (a new column, a new table, a changed type). One important consequence: if someone manually alters the database outside of migrations (e.g. adds a column via pgAdmin directly), `migration:generate`'s diff becomes unreliable, because it's comparing against the database's *actual* state, which no longer matches what any migration file says it should be — this is called **schema drift**, and it's a large part of why "only ever change schema via migrations" is a hard rule, not a suggestion.

---

## Q8 — `up()` / `down()`

**Your answer:** not sure — new topic.

`up()` applies the change (e.g. `CREATE TABLE users (...)`). `down()` must contain the **exact inverse** of whatever `up()` did (e.g. `DROP TABLE users`; for a migration that does `ALTER TABLE ADD COLUMN x`, `down()` does `ALTER TABLE DROP COLUMN x`).

**Why a broken/missing `down()` is a real problem even if you "never plan to roll back":**
1. **Emergency rollback.** A migration gets merged, deployed, and immediately causes production errors (a bad constraint, a bug in the change). Without a working `down()`, reverting that specific schema change means hand-editing the production database under time pressure — exactly the scenario migrations exist to prevent.
2. **CI safety net.** Some pipelines run migrations `up` → `down` → `up` again as an automated sanity check, specifically to catch a broken migration *before* it ever reaches production. A broken `down()` silently defeats this check.
3. **Local dev iteration.** While you're actively designing a schema, you'll often want to revert one migration to try a different approach, without nuking your entire local database. `down()` is what makes that a clean single command instead of a manual reset.
4. **It's a comprehension check on yourself.** If you can't write a correct `down()` for a migration, that's often a sign you don't fully understand everything `up()` actually changed — e.g. a migration that transforms or drops data isn't cleanly reversible by nature, and that needs to be handled explicitly (a comment, a guard), not silently left broken.

---

## Q9 — Seed vs. migration for roles/permissions (expanded)

**Your answer:** seed — correct instinct. Here's the "does it depend on something" nuance:

Some teams *do* put fixed reference data in a dedicated **seed-only migration** (separate from schema-altering migrations) specifically because it guarantees that data exists in every single environment the migrations run in — dev, CI, staging, prod, a new teammate's laptop — with zero extra manual step to forget. That's a defensible choice when the data is 100% fixed and effectively part of the "schema" conceptually (which 3 roles *are*, for this project).

The alternative — a **separate seed script** (e.g. `npm run seed`, not part of the migration chain) — is more flexible: it can be **re-run safely** at any time (a migration is meant to run exactly once, ever, but you'll want to reset/re-seed your local dev DB repeatedly while developing), and it keeps "structural schema changes" (migrations) cleanly separate from "content changes" (seeds) as two distinct concerns — matching the Phase 0 Q12 rule directly.

**Decision for this project:** a dedicated, **idempotent** seed script (safe to run repeatedly — it finds-or-creates rather than blindly inserting), run manually after migrations. Chosen because this is explicitly a project about *practicing* the seed-vs-migration distinction as its own skill, not just getting data into the table by whatever means is fastest.

---

## Q10 — Soft delete (correct, well-reasoned)

**Your answer:** soft delete, because a hard delete would lose logs and other associated records. Correct, and that's the right instinct without prompting.

**Made precise, for the full picture:** a hard `DELETE FROM users WHERE id = ?` interacts with foreign keys in one of three ways, none of which are what you actually want: (1) if `orders.user_id`/`audit_logs.user_id` have a default/`NOT NULL` FK with no cascade rule, the delete **fails outright** with a confusing constraint-violation error; (2) if the FK is `ON DELETE CASCADE`, the delete **succeeds but silently deletes every order and every audit log entry for that user too** — almost never what you want, since audit logs specifically exist to survive the thing they're auditing; (3) if the FK is `ON DELETE SET NULL`, the orders/logs survive but now point at nothing — you've lost the "who did this" trail permanently. A soft-delete column (`deletedAt`, nullable timestamp on `users`) sidesteps all three: the row still physically exists, so every foreign key reference stays valid, while the application treats any row with a non-null `deletedAt` as "deleted" (filtered out of normal queries). One addition worth building in now: soft-deleting a user should also immediately revoke all of their active `refresh_tokens` rows — removing access and preserving history are two different actions, and both need to happen.

---

## Confirmed Schema Going Into Implementation

```
users                    roles                    permissions
├── id (uuid, PK)        ├── id (uuid, PK)        ├── id (uuid, PK)
├── name                 ├── name (unique)        ├── name (unique)
├── email (unique)  ◄────┼── (role_permissions join table, many-to-many)
├── password_hash (null) │
├── status (enum)         └──< role_permissions >──┘
├── avatar_url (null)
├── last_active (null)
├── role_id (FK → roles.id, many-to-one)
├── created_at / updated_at
└── deleted_at (soft delete)

refresh_tokens
├── id (uuid, PK)
├── user_id (FK → users.id)
├── token_hash (unique)   -- SHA-256, not Argon2id — see Q4
├── family_id             -- groups a rotation chain for reuse detection
├── expires_at            -- fixed at creation, never recalculated in place
├── revoked_at (null)
├── ip_address / user_agent (null)
└── created_at
```

## Suggested Reading Before Phase 3

1. TypeORM docs: `@ManyToMany` + `@JoinTable()`, `@ManyToOne` + `@JoinColumn()`, soft delete (`@DeleteDateColumn`, `softDelete()`/`restore()`).
2. Postgres docs: native `ENUM` types, and what `UNIQUE` actually creates under the hood (a unique index).
3. A short read on **IDOR** (Insecure Direct Object Reference) — ties Q3's UUID reasoning to a named, real vulnerability class.
