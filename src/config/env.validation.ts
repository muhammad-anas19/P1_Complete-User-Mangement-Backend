import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Every env var the app depends on, with the validation rule that must hold
 * before the app is allowed to boot. See docs/qa/phase-1-scaffold-db-understanding-check.md
 * (Q3) for why this runs synchronously at bootstrap instead of failing lazily.
 */
class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number;

  @IsString()
  @MinLength(1)
  DATABASE_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DATABASE_PORT: number;

  @IsString()
  @MinLength(1)
  DATABASE_USER: string;

  @IsString()
  @MinLength(1)
  DATABASE_PASSWORD: string;

  @IsString()
  @MinLength(1)
  DATABASE_NAME: string;

  // 32+ chars: a short JWT secret is brute-forceable (see phase-0 doc, Q7 sibling reasoning on hashing).
  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET: string;

  @IsString()
  @MinLength(1)
  CORS_ORIGIN: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const messages = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(
      `Environment variable validation failed — refusing to start: ${messages}`,
    );
  }

  return validatedConfig;
}
