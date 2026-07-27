import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

// The one place Argon2id's cost parameters are defined — every hash/verify
// call site uses identical, intentional settings. See
// docs/qa/phase-3-cookie-auth-understanding-check.md Q1 for why the
// parameters (not just the algorithm name) are what provide the security.
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB — OWASP baseline
  timeCost: 2,
  parallelism: 1,
};

// A fixed, precomputed hash of a value that is never a real password. Used
// to run a real verify() even when no user exists, so response timing
// doesn't leak whether an email is registered. See Q3.
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$R9EIibILAGmNV4oMK1AiHg$lpNnnseUcoD8q28yKbiFjOWEcFRRQl8FzU2qGIBrHDI';

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }
}
