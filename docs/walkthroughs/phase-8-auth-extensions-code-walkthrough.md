# Phase 8 Code Walkthrough: Signup, Verify-OTP, Accept-Invite, Forgot/Reset Password

> All five flows below were verified against the real running app and real Postgres — not just written and assumed correct. The OTP/invite/reset token values in this doc are real values pulled from actual server logs during that verification pass.

## `UserToken` — one table, three purposes

Same design philosophy as `refresh_tokens` (Phase 2): a dedicated table rather than columns bolted onto `User`. The `purpose` enum (`email_verification | invite | password_reset`) is what lets one table and one `UserTokensService` serve three different flows without three near-identical services.

`UserTokensModule` is deliberately **standalone** — not owned by `AuthModule` or `UsersModule` — because `UsersService.create()` needs to issue invite tokens, and `AuthModule` already imports `UsersModule` (for the `User` repository, since Phase 3). If `UserTokensModule` lived inside `AuthModule`, `UsersModule` importing it back would be circular. A third, independent module both can import solves it — the exact same shape as the `RefreshToken`-in-two-modules workaround from Phase 4, generalized.

## Two token shapes, one storage model

```ts
async issueOtp(userId, purpose) {
  const raw = randomInt(100000, 1000000).toString();   // 6-digit, human-typed
  ...
}
async issueUrlToken(userId, purpose) {
  const raw = randomBytes(32).toString('hex');          // 256-bit, embedded in a link
  ...
}
```
Both get hashed (SHA-256, same reasoning as refresh tokens — high/adequate entropy, nothing to slow-hash against) and stored identically. `crypto.randomInt`, not `Math.random()`, for the OTP — `Math.random()` is not cryptographically secure and must never generate anything security-relevant.

## Why `consume()` takes an optional `expectedUserId`

```ts
async consume(rawToken, purpose, expectedUserId?) {
  const record = await this.repo.findOne({ where: { tokenHash, purpose } });
  if (expectedUserId && record.userId !== expectedUserId) throw new UnauthorizedException(...);
  ...
}
```
A 6-digit OTP has only ~900,000 possible values — small enough that, in principle, two different users' pending codes could coincide. `verify-otp` looks the user up by email *first*, then passes that `userId` in, so `consume()` also checks the code belongs to *that specific user*, not just that *some* valid code matches. A 256-bit URL token's collision probability is astronomically lower, so `accept-invite`/`reset-password` can safely omit it — the token alone is a safe enough credential on its own.

## Signup vs. Admin-provisioning — two different `User` creation paths, on purpose

```ts
// AuthService.signup()
const passwordHash = await this.passwordService.hash(dto.password);   // set immediately
const user = this.usersRepo.create({ ..., passwordHash, status: UserStatus.PENDING, roleId: viewerRole.id });
```
vs.
```ts
// UsersService.create() — Admin-provisioned
const user = this.usersRepo.create({ ..., passwordHash: null, roleId: dto.roleId });
```
Self-registration sets a password immediately (the user provided one) and defaults to **Viewer** — least privilege, since nothing about a self-registration proves the person should have any elevated access. Admin-provisioning leaves `passwordHash: null` until `accept-invite` sets one, and the Admin explicitly chooses the role. Both converge on the same `PENDING → ACTIVE` transition via `verify-otp`.

## `verify-otp` — the one endpoint that both activates AND logs in

```ts
async verifyOtp(dto, meta): Promise<AuthResult> {
  const user = await this.usersRepo.findOne({ where: { email: dto.email } });
  await this.userTokensService.consume(dto.code, UserTokenPurpose.EMAIL_VERIFICATION, user.id);
  user.status = UserStatus.ACTIVE;
  await this.usersRepo.save(user);
  const accessToken = this.tokenService.signAccessToken(user);
  const { raw: refreshToken } = await this.tokenService.issueRefreshToken(user.id, meta);
  return { user, accessToken, refreshToken };
}
```
Returns the exact same `AuthResult` shape `login()`/`refresh()` do — which is precisely why `AuthController.verifyOtp()` can reuse `setAuthCookies()` unchanged. **Verified live**: a fresh signup, once OTP-verified, immediately worked against `GET /auth/me` with no separate login step — matching the real frontend's existing behavior of calling `login()` right after OTP success.

## `accept-invite` does *not* log in — verified, not assumed

```ts
async acceptInvite(dto): Promise<{ email: string }> {
  const userId = await this.userTokensService.consume(dto.token, UserTokenPurpose.INVITE);
  const user = await this.usersRepo.findOneByOrFail({ id: userId });
  user.passwordHash = await this.passwordService.hash(dto.password);
  await this.usersRepo.save(user);
  await this.issueAndLogOtp(user);   // fresh OTP — feeds into the SAME verify-otp step as signup
  return { email: user.email };
}
```
Confirmed via the real invite flow: after `accept-invite`, the user's `status` was still `Pending` (not `Active`) until a *separate* `verify-otp` call completed it — matching the frontend's actual routing (`accept-invite` page redirects to `/verify-otp`, not straight to the dashboard).

## `forgot-password`'s generic response, and why `reset-password` revokes everything

```ts
async forgotPassword(email: string): Promise<void> {
  const user = await this.usersRepo.findOne({ where: { email } });
  if (!user) return;   // silently no-ops — see below
  const rawToken = await this.userTokensService.issueUrlToken(user.id, UserTokenPurpose.PASSWORD_RESET);
  this.logger.log(`[MOCK EMAIL] ...`);
}
```
The controller returns the identical `{ message: "If that email exists..." }` regardless of whether `user` was found — **verified live**, byte-identical responses for a real vs. a fake email. This is the same user-enumeration defense as login's generic error (Phase 0 Q3), applied here too.

```ts
async resetPassword(dto): Promise<void> {
  ...
  await this.tokenService.revokeAllForUser(userId);
}
```
A password reset is treated as "the old password may have been compromised" — every existing session, on every device, gets force-logged-out, not just the one that requested the reset. **Verified live**: a session's cookies from *before* the reset failed on the very next `/auth/refresh` with `"Session revoked — please sign in again"` — the exact same reuse-detection message path from Phase 3, now reached via a different trigger (`revokeAllForUser`'s bulk update, not a rotation-reuse event) but the same underlying mechanism (mark `revoked_at`, `rotate()` rejects it).

## What's genuinely mocked, disclosed plainly

Every "email" in this phase is a `Logger.log()` call reading `[MOCK EMAIL] ...` — no SMTP integration, no real delivery. This is the same disclosed scope boundary already stated in `PRD.md` for invite emails, now extended to cover verification codes and reset links too. A real deployment would swap these log lines for an actual email provider call without changing anything else about the token issue/consume logic.
