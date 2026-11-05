import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../prisma/generated/prisma/client';
import { buildDatabaseUrl } from '../../prisma/database-url';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    const connectionString = buildDatabaseUrl((key) => config.get<string>(key));
    if (!connectionString) {
      throw new Error(
        'Database is not configured: set DATABASE_USER, DATABASE_PASS, DATABASE_HOST, DATABASE_PORT, DATABASE_NAME',
      );
    }
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  onModuleInit(): any {
    this.$connect();
  }

  onModuleDestroy(): any {
    this.$disconnect();
  }
}
