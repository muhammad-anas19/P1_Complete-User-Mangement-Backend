import { SetMetadata } from '@nestjs/common';

// Explicit opt-out, checked first by CsrfGuard — only /auth/login uses this
// (no csrf_token cookie can exist before a session does). See
// docs/qa/phase-5-hardening-understanding-check.md B4.
export const SKIP_CSRF_KEY = 'skipCsrf';

export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
