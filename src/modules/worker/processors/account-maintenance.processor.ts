// src/worker/processors/account-maintenance.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { chromium, Browser } from 'playwright';
import { Job } from 'bullmq';
import { AutomationService } from '../../automation/automation.service';
import { RedisService } from '../../../common/redis/redis.service';

@Processor('account-maintenance', { concurrency: 2 })
export class AccountMaintenanceProcessor
  extends WorkerHost
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AccountMaintenanceProcessor.name);
  private maintenanceBrowser: Browser;

  constructor(
    private readonly automationService: AutomationService,
    private readonly redisService: RedisService,
  ) {
    super();
  }

  async onModuleInit() {
    this.logger.log(
      '⏳ [Hạ tầng Worker] Đang khởi động nhân Chromium chuyên dụng nuôi phiên...',
    );
    try {
      this.maintenanceBrowser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });
      this.logger.log(
        '✅ [Hạ tầng Worker] Khởi tạo Browser nuôi phiên thành công!',
      );
    } catch (error) {
      this.logger.error(
        `❌ Lỗi khởi động nhân Browser hạ tầng: ${error.message}`,
      );
    }
  }

  async process(job: Job<any>): Promise<any> {
    const payload = job.data;
    const jobId = payload.jobId || job.id;
    const startTime = Date.now();
    const normalizedSite = payload.targetSiteCode.toUpperCase();
    const username = payload.variableValues?.username;

    if (!username) {
      this.logger.warn(
        `⚠️ [Job ${jobId}] Thiếu username cấu hình, bỏ qua ca trực.`,
      );
      return { status: 'SKIPPED' };
    }

    this.logger.log(
      `🔑 [Nuôi Phiên ngầm] [Job ${jobId}] Kích hỏa hồi sinh phiên Acc [${username}] của đài [${normalizedSite}]`,
    );

    const redis = this.redisService.getClient();

    const intentKey = `account:lock_intent:${normalizedSite}:${username}`;
    const counterKey = `account:active_workers:${normalizedSite}:${username}`;
    const channelKey = `channel:account:free:${normalizedSite}:${username}`;

    try {
      const workflowSteps = payload.compiledWorkflow || [];
      if (workflowSteps.length === 0) {
        this.logger.warn(
          `⚠️ [Job ${jobId}] Cấu hình kịch bản trống rỗng, hủy lượt.`,
        );
        return { status: 'SKIPPED' };
      }

      await redis.set(intentKey, '1', 'EX', 60);
      this.logger.log(
        `🚨 [Hạ tầng] Acc [${username}] ĐÃ BẬT CỜ XIN ĐƯỜNG. Bắt đầu khâu rút cạn (Drain)...`,
      );

      const currentWorkers = await redis.get(counterKey);
      const workerCount = currentWorkers ? parseInt(currentWorkers, 10) : 0;

      if (workerCount > 0) {
        this.logger.log(
          `⏳ [Hạ tầng] Phát hiện còn [${workerCount}] Bot đang bám trụ tác nghiệp. Kích hoạt khâu ngủ chờ Pub/Sub...`,
        );

        const subClient = redis.duplicate();

        await new Promise<void>((resolve) => {
          let isResolved = false;

          // ⏰ CHỐT CHẶN PHÒNG THỦ (FAILSAFE): Quá 5 giây nếu lũ Bot cũ bị treo/sập không nhả sân, ta cưỡng chế chạy luôn!
          // const hardTimeout = setTimeout(() => {
          //   if (!isResolved) {
          //     this.logger.warn(`⏰ [Hạ tầng Timeout] Hết 5s Hard Timeout! Cưỡng chế thu hồi sân bãi để cứu phiên đăng nhập.`);
          //     cleanUpSub();
          //     resolve();
          //   }
          // }, 5000);

          // Hàm dọn dẹp kết nối, triệt tiêu Memory Leak / Connection Leak cho Redis
          // const cleanUpSub = () => {
          //   isResolved = true;
          //   clearTimeout(hardTimeout);
          //   subClient.unsubscribe(channelKey).catch(() => {});
          //   subClient.quit().catch(() => {}); // 🌟 Bắt buộc đóng hẳn socket bản sao
          // };

          // Lắng nghe loa phát thanh từ luồng giải phóng trả acc
          subClient.on('message', (channel, message) => {
            if (channel === channelKey && message === 'clear') {
              this.logger.log(
                `🔔 [Hạ tầng Event] Ting Ting! Đã nhận được tín hiệu SẠCH ĐƯỜNG từ Pub/Sub. Lao vào tác nghiệp.`,
              );
              // cleanUpSub();
              resolve();
            }
          });

          // Kích hoạt cổng nghe của kênh
          subClient.subscribe(channelKey).catch((err) => {
            this.logger.error(
              `❌ [Hạ tầng] Lỗi lệnh Subscribe, bypass chờ đợi: ${err.message}`,
            );
            // cleanUpSub();
            resolve();
          });
        });
      } else {
        this.logger.log(
          `🟢 [Hạ tầng] Sân bãi trống trải (Counter = 0). Tiến hành mở Chrome xử lý luôn không cần đợi.`,
        );
      }

      const runtimeContext = await this.automationService.runWorkflow(
        workflowSteps,
        null,
        {
          sharedBrowser: this.maintenanceBrowser,
          blockResources: true,
        },
      );

      if (runtimeContext && runtimeContext.has('saved_session')) {
        const freshCookie = runtimeContext.get('saved_session');

        const saveSessionStep = workflowSteps.find(
          (step: any) => step.action === 'SAVE_SESSION',
        );
        const targetRedisKey =
          saveSessionStep?.value ||
          `account:session:${normalizedSite}:${username}`;

        const redis = this.redisService.getClient();

        await redis.set(
          targetRedisKey,
          JSON.stringify(freshCookie),
          'EX',
          45 * 60,
        );

        if (username) {
          const poolKey = `account:active_pool:${normalizedSite}`;
          await redis.sadd(poolKey, username);
          this.logger.log(
            `📥 [Pool Set] Đã nạp Acc [${username}] vào Hồ chứa hoạt động [${poolKey}]`,
          );
        }

        const duration = Date.now() - startTime;
        this.logger.log(
          `🟢 [Job ${jobId}] Nuôi phiên THÀNH CÔNG cho Acc [${username}] trong ${duration}ms ➔ Đã nạp đạn vào RAM: [${targetRedisKey}]`,
        );

        return { status: 'SUCCESS', targetKey: targetRedisKey };
      } else {
        throw new Error(
          'Playwright chạy hoàn tất nhưng không tìm thấy dữ liệu saved_session phát ra trong context',
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ [Job ${jobId}] Tiến trình nuôi tài khoản [${username}] THẤT BẠI: ${error.message}`,
      );
      throw error;
    } finally {
      await redis.del(intentKey);
      this.logger.log(
        `🧼 [Hạ tầng] Đã nhổ cờ XIN ĐƯỜNG, trả tự do cho Acc [${username}] phục vụ.`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.maintenanceBrowser) {
      this.logger.log('🔒 Đóng toàn bộ nhân Chromium tổng.');
      await this.maintenanceBrowser.close();
    }
  }
}
