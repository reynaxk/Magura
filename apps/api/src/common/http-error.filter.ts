import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { ZodError } from 'zod';
import { HttpError } from '@magura/chains';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse();
    if (err instanceof ZodError) {
      return res.status(400).json({ error: 'invalid_request', issues: err.issues });
    }
    if (err instanceof HttpException) {
      const body = err.getResponse();
      return res.status(err.getStatus()).json(typeof body === 'string' ? { error: body } : body);
    }
    if (err instanceof HttpError) {
      // upstream provider failure (DexScreener, Jupiter, …)
      return res.status(HttpStatus.BAD_GATEWAY).json({ error: 'upstream_error', status: err.status });
    }
    Sentry.captureException(err);
    console.error(err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
