// src/worker/processors/portal-check.processor.ts
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { chromium, Browser } from 'playwright';
import { Job, Queue } from 'bullmq';
import { AutomationService } from '../../automation/automation.service';
import { RedisService } from '../../../common/redis/redis.service';

@Processor('portal-checks', { concurrency: 15 })
export class PortalCheckProcessor
  extends WorkerHost
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PortalCheckProcessor.name);
  private globalBrowser: Browser;

  constructor(
    private readonly automationService: AutomationService,
    private readonly redisService: RedisService,
    @InjectQueue('global-task-results') private readonly resultQueue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    this.logger.log(
      '🚀 Đang khởi động tiến trình Chromium dùng chung cho cụm Worker...',
    );
    try {
      this.globalBrowser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });
      this.logger.log('✅ Khởi tạo cụm nhân Browser dùng chung thành công!');
    } catch (error) {
      this.logger.error(`❌ Lỗi khởi động nhân Browser: ${error.message}`);
    }
  }

  async process(job: Job<any>): Promise<any> {
    const payload = job.data;
    const jobId = payload.jobId || job.id;
    const startTime = Date.now();

    this.logger.log(
      `🤖 [Job ${jobId}] Tiếp nhận cấu hình Bot ID [${payload.taskId}] - Đài [${payload.targetSiteCode}]`,
    );

    try {
      const redisKey = `session:${payload.targetSiteCode}`;
      const storageState = await this.redisService.get<any>(redisKey);

      if (!storageState) {
        this.logger.warn(
          `⚠️ [Job ${jobId}] Huỷ lệnh! Không có Session của đài [${payload.targetSiteCode}] trên Redis.`,
        );
        throw new Error(
          `MISSING_SESSION: Thiếu tư cách uỷ quyền cho đài ${payload.targetSiteCode}`,
        );
      }

      const workflowSteps = payload.compiledWorkflow || [];
      if (workflowSteps.length === 0) {
        this.logger.warn(
          `⚠️ [Job ${jobId}] Kịch bản thô rỗng, bỏ qua ca trực.`,
        );
        return { status: 'SKIPPED', message: 'Workflow steps empty' };
      }

      await this.automationService.runWorkflow(workflowSteps, storageState, {
        sharedBrowser: this.globalBrowser,
        blockResources: true,
      });

      const executionTimeMs = Date.now() - startTime;
      this.logger.log(
        `🟢 [Job ${jobId}] Kết quả: ĐANG SỐNG (ALIVE) - Xử lý trong: ${executionTimeMs}ms`,
      );

      await this.resultQueue.add(
        'process-result',
        {
          taskId: payload.taskId,
          engineType: 'PLAYWRIGHT',
          templateSlug: payload.templateSlug,
          targetSiteCode: payload.targetSiteCode,
          variableValues: payload.variableValues,
          executionTimeMs,
          isTestRun: payload.isTestRun || false,
          timestamp: Date.now(),
          result: {
            status: 'ALIVE',
            reasonCode: 'SUCCESS',
            rawLog: 'Toàn bộ kịch bản tự động hóa tuần tự chạy THÀNH CÔNG!',
          },
        },
        { removeOnComplete: true, removeOnFail: true },
      );

      return { status: 'ALIVE', jobId: jobId };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      this.logger.error(
        `❌ [Job ${jobId}] Kết quả: THẤT BẠI (DEAD). Lỗi chi tiết: ${error.message}`,
      );

      const cleanReasonCode = this.parseTechnicalErrorToReasonCode(
        error.message,
      );

      await this.resultQueue.add(
        'process-result',
        {
          taskId: payload.taskId,
          engineType: 'PLAYWRIGHT',
          templateSlug: payload.templateSlug,
          targetSiteCode: payload.targetSiteCode,
          variableValues: payload.variableValues,
          executionTimeMs,
          isTestRun: payload.isTestRun || false,
          timestamp: Date.now(),
          result: {
            status: 'DEAD',
            reasonCode: cleanReasonCode,
            rawLog: error.message,
          },
        },
        { removeOnComplete: true, removeOnFail: true },
      );

      return { status: 'DEAD', error: error.message, jobId: jobId };
    }
  }

  private parseTechnicalErrorToReasonCode(errorMessage: string): string {
    const msg = errorMessage.toLowerCase();
    if (msg.includes('missing_session')) return 'AUTH_SESSION_EXPIRED';
    if (msg.includes('timeout')) return 'TIMEOUT_EXCEEDED';
    if (msg.includes('selector') || msg.includes('locator'))
      return 'DOM_SELECTOR_NOT_FOUND';
    if (msg.includes('navigation')) return 'NETWORK_NAVIGATION_FAILED';
    return 'ENGINE_EXECUTION_FAILED';
  }

  async onModuleDestroy() {
    if (this.globalBrowser) {
      this.logger.log('🔒 Đóng toàn bộ nhân Chromium tổng.');
      await this.globalBrowser.close();
    }
  }
}
