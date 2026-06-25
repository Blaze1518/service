// src/worker/brokers/account-session-broker.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../common/redis/redis.service';

@Injectable()
export class AccountSessionBroker {
  private readonly logger = new Logger(AccountSessionBroker.name);

  constructor(private readonly redisService: RedisService) {}

  async acquireSession(
    siteCode: string,
  ): Promise<{ username: string; storageState: any } | null> {
    const redis = this.redisService.getClient();
    const normalizedSite = siteCode.toUpperCase();
    const nowSec = Math.floor(Date.now() / 1000);

    const maxTokens = 3;
    const refillRateSec = 10;

    const luaScript = `
      local site = ARGV[1]
      local now = tonumber(ARGV[2])
      local max_tokens = tonumber(ARGV[3])
      local refill_rate = tonumber(ARGV[4])
      
      local pool_key = "account:active_pool:" .. site
      local users = redis.call("SMEMBERS", pool_key)
      
      for _, user in ipairs(users) do
        local session_key = "account:session:" .. site .. ":" .. user
        local token_key = "account:token:" .. site .. ":" .. user
        
        if redis.call("EXISTS", session_key) == 1 then
          
          local bucket = redis.call("HMGET", token_key, "tokens", "last_refill")
          local tokens = tonumber(bucket[1])
          local last_refill = tonumber(bucket[2])
          
          if not tokens then
            tokens = max_tokens
            last_refill = now
          else
            local elapsed = now - last_refill
            local refill_tokens = math.floor(elapsed / refill_rate)
            if refill_tokens > 0 then
              tokens = math.min(max_tokens, tokens + refill_tokens)
              last_refill = last_refill + (refill_tokens * refill_rate)
            end
          end
          
          if tokens > 0 then
            tokens = tokens - 1
            redis.call("HMSET", token_key, "tokens", tokens, "last_refill", last_refill)
            return user
          end
        else
          redis.call("SREM", pool_key, user)
        end
      end
      return nil
    `;

    const allocatedUser = (await redis.eval(
      luaScript,
      0,
      normalizedSite,
      nowSec.toString(),
      maxTokens.toString(),
      refillRateSec.toString(),
    )) as string | null;

    if (!allocatedUser) return null;

    const cookieBlob = await redis.get(
      `account:session:${normalizedSite}:${allocatedUser}`,
    );

    if (!cookieBlob) {
      this.logger.warn(
        `⚠️ [Broker] Lỗi hiếm: Acc [${allocatedUser}] lọt lưới Lua nhưng cookie đã bốc hơi.`,
      );
      return null;
    }

    return {
      username: allocatedUser,
      storageState: JSON.parse(cookieBlob),
    };
  }
}
