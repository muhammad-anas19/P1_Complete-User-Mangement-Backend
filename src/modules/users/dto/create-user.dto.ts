import { IsEmail, IsString, IsUUID, MinLength } from 'class-validator';

// No password field — an Admin-invited user starts with no password until
// they accept an invite (docs/PRD.md Workflow 6). roleId, not a raw `role`
// name string — see docs/qa/phase-4-rbac-users-understanding-check.md Q6 /
// BE-DEC-011 for why accepting a client-supplied role label would be a
// privilege-escalation risk.
export class CreateUserDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEmail()
  email: string;

  @IsUUID()
  roleId: string;
}
