import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { User } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type AuthenticatedRequest = Request & { user: User };

/**
 * Verifies the Bearer JWT and loads the user from the database.
 * The role is always taken from the DB, not from the token, so a role change
 * takes effect immediately instead of after the token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: { sub?: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    request.user = user;
    return true;
  }

  private extractBearerToken(header: string | undefined): string | undefined {
    const [type, token] = header?.split(' ') ?? [];
    return type === 'Bearer' && token ? token : undefined;
  }
}
