import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { Configuration } from './config/configuration';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<Configuration, true>);

  app.use(cookieParser());

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

  const port = configService.get('port', { infer: true });
  await app.listen(port);
}
bootstrap();
