import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import { join } from 'path';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { Configuration } from './config/configuration';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { winstonLoggerOptions } from './common/logger/winston.config';

async function bootstrap() {
  // Replaces Nest's default console-only logger app-wide — every existing
  // `new Logger(ClassName.name)` call site (UsersService, RolesService,
  // etc.) needed zero changes to start writing to daily-rotated files too.
  // See docs/qa/phase-13-logging-understanding-check.md Q4.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: WinstonModule.createLogger(winstonLoggerOptions),
  });
  const configService = app.get(ConfigService<Configuration, true>);

  // Aligns with the frontend's existing NEXT_PUBLIC_API_BASE_URL
  // (.../api) — every route so far was unprefixed. /health/* excluded:
  // orchestrators expect health checks at a conventional, unprefixed path,
  // same reasoning as excluding it from the envelope/rate-limit/throttle
  // treatment everywhere else. See docs/phases.md Phase 9.
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health/(.*)', method: RequestMethod.ALL }],
  });

  app.use(cookieParser());

  // Serves uploaded product images from local disk — see
  // common/utils/upload.util.ts for why this is disk, not a bucket, and
  // what that limits. Not behind the API prefix (Phase 9) — static assets
  // aren't part of the versioned API surface.
  app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads' });

  // Global validation: strips unknown fields (whitelist) and rejects requests
  // containing them (forbidNonWhitelisted) instead of silently ignoring them.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Applied globally except /health/* (see the interceptor/filter for why) —
  // guarantees the ApiEnvelope shape "by construction" per docs/design.md
  // Section 1, rather than relying on each controller to remember it.
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // Explicit origin allow-list + credentials — required for the frontend's
  // httpOnly cookies to be sent/received cross-origin at all. Never combine
  // credentials:true with a wildcard origin. See docs/design.md Section 5
  // and docs/qa/phase-0-auth-rbac-understanding-check.md Q6.
  app.enableCors({
    origin: configService.get('cors.origin', { infer: true }),
    credentials: true,
  });

  // Swagger's built-in auth UI is built around headers (Bearer/API-key),
  // not cookies read automatically by the browser — addCookieAuth documents
  // WHICH cookies are required, but "Authorize" in the UI only pre-fills a
  // header Swagger's own test-request tool sends manually. In practice,
  // trying real requests from this UI works anyway because the browser
  // rendering the Swagger page already holds the real session cookies from
  // a normal login elsewhere — the "Authorize" button mostly documents,
  // it doesn't actually drive cookie auth the way it does for Bearer tokens.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('P1 Dashboard API')
    .setDescription(
      'Enterprise Admin Dashboard backend. Auth is httpOnly-cookie based — ' +
        'see docs/qa/phase-0-auth-rbac-understanding-check.md for why Swagger\'s ' +
        'default auth UI does not map cleanly onto this.',
    )
    .setVersion('1.0')
    .addCookieAuth('access_token', {
      type: 'apiKey',
      in: 'cookie',
      description: 'Set automatically by POST /auth/login — httpOnly, not settable from this UI directly.',
    })
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  const port = configService.get('port', { infer: true });
  await app.listen(port);
}
bootstrap();
