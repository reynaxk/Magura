import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User } from '@magura/db';
import { AuthService } from './auth.service';

export const IS_PUBLIC = 'isPublic';
/** Route works without login; user is attached when a token is present. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const dev = req.headers['x-dev-user'] as string | undefined;
    if (isPublic && !token && !dev) return true;
    try {
      req.user = await this.auth.userFromToken(token, dev);
    } catch (e) {
      if (isPublic) return true;
      throw e;
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest().user);
export const OptionalUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User | undefined => ctx.switchToHttp().getRequest().user,
);
