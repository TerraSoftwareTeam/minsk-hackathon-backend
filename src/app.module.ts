import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [PrismaModule, ConfigModule.forRoot({ isGlobal: true }), HealthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
