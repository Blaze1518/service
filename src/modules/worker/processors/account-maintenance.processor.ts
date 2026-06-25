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
        headless: false,
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

    this.logger.log(
      `🔑 [Nuôi Phiên ngầm] [Job ${jobId}] Kích hỏa hồi sinh phiên Acc [${username}] của đài [${normalizedSite}]`,
    );

    try {
      const workflowSteps = payload.compiledWorkflow || [];
      if (workflowSteps.length === 0) {
        this.logger.warn(
          `⚠️ [Job ${jobId}] Cấu hình kịch bản trống rỗng, hủy lượt.`,
        );
        return { status: 'SKIPPED' };
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
    }
  }

  async onModuleDestroy() {
    if (this.maintenanceBrowser) {
      this.logger.log('🔒 Đóng toàn bộ nhân Chromium tổng.');
      await this.maintenanceBrowser.close();
    }
  }
}
