import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule as IORedisModule } from '@nestjs-modules/ioredis';
import { RedisService } from './redis.service';

@Global()
@Module({
  imports: [
    ConfigModule,
    IORedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single',
        url: configService.get<string>('REDIS_URL', 'redis://127.0.0.1:6380'),
      }),
    }),
  ],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
