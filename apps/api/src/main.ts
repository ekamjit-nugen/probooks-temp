import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module";
import { AppConfigService } from "./core/config-env/app-config.service";
import { TenantContextInterceptor } from "./core/tenant-context/tenant-context.interceptor";

/**
 * Bootstrap. The Pino logger (LoggingModule, §13) becomes the app logger; the
 * DomainExceptionFilter is wired globally via APP_FILTER in ErrorsModule (§12).
 * Port comes from the validated AppConfig — no direct process.env read (§17).
 *
 * The TenantContextInterceptor is applied globally so that, AFTER the guard
 * stack verifies the token and attaches req.principalClaim (AuthGuard, §10.2),
 * the AsyncLocalStorage tenant context is seeded for the handler + repositories
 * (§9.2). Guards run before interceptors, so the principal is present here.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(app.get(TenantContextInterceptor));

  const config = app.get(AppConfigService);
  await app.listen(config.get("port"));
}

void bootstrap();
