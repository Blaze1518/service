// src/common/redis/redis.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit {
  private readonly logger = new Logger(RedisService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // 📡 Lắng nghe trạng thái kết nối của Redis ngay khi khởi động
  onModuleInit() {
    this.redis.on('connect', () => {
      this.logger.log('📡 Đang kết nối tới Redis server tại');
    });

    this.redis.on('ready', () => {
      this.logger.log('✅ Kết nối thành công! Redis đã sẵn sàng nhận lệnh.');
    });

    this.redis.on('error', (err) => {
      this.logger.error(`❌ Lỗi kết nối Redis: ${err.message}`);
    });
  }

  async set(key: string, value: any, ttlInSeconds?: number): Promise<string> {
    const stringValue =
      typeof value === 'object' ? JSON.stringify(value) : String(value);

    if (ttlInSeconds) {
      return await this.redis.set(key, stringValue, 'EX', ttlInSeconds);
    }
    return await this.redis.set(key, stringValue);
  }

  async get<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(key);
    if (!data) return null;

    try {
      return JSON.parse(data) as T;
    } catch {
      return data as any;
    }
  }

  async del(key: string): Promise<number> {
    return await this.redis.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }

  async flushAll(): Promise<string> {
    return await this.redis.flushall();
  }

  getClient(): Redis {
    return this.redis;
  }
}
