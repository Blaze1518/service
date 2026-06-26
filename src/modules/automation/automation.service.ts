// src/modules/automation/automation.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { chromium, Browser } from 'playwright';
import { ActionMap } from './actions/action.map';

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  async runWorkflow(
    steps: any[],
    storageState?: any,
    options?: { sharedBrowser?: Browser; blockResources?: boolean },
  ) {
    this.logger.log('Bắt đầu luồng automation...');

    let browser: Browser;
    let isSharedBrowser = false;

    if (options?.sharedBrowser) {
      browser = options.sharedBrowser;
      isSharedBrowser = true;
      this.logger.log(
        '🔌 [Automation] Nhận thông hành: Sử dụng cụm nhân Browser dùng chung tổng.',
      );
    } else {
      this.logger.warn(
        '⚠️ [Automation] Không thấy Browser tổng. Đang kích hoạt chế độ Master tự phát...',
      );
      browser = await chromium.launch({ headless: false });
    }

    const cookieCount = storageState?.cookies?.length || 0;
    this.logger.log(
      `📥 [Session] Tiến hành nạp đạn tài nguyên. Số lượng Cookies phát hiện: [${cookieCount}]`,
    );

    const context = await browser.newContext({
      storageState: storageState || undefined,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();
    const runtimeContext = new Map<string, any>();

    let currentStep: any = null;

    try {
      if (options?.blockResources) {
        await page.route('**/*', async (route) => {
          const type = route.request().resourceType();
          if (['image', 'font', 'media'].includes(type)) {
            await route.abort();
          } else {
            await route.continue();
          }
        });
      }

      for (const step of steps) {
        currentStep = step;
        this.logger.log(`[Step ${step.id}] Thực thi hành động: ${step.action}`);

        const actionFn = ActionMap[step.action];
        if (!actionFn) {
          throw new Error(
            `Hành động '${step.action}' không tồn tại trong ActionMap!`,
          );
        }
        await actionFn(page, step, runtimeContext);
      }

      this.logger.log('🎉 Toàn bộ kịch bản chạy THÀNH CÔNG!');
      return runtimeContext;
    } catch (error) {
      this.logger.error(
        `❌ Kịch bản THẤT BẠI tại bước nào đó. Lỗi: ${error.message}`,
      );

      try {
        const stepDetail = currentStep
          ? `step_${currentStep.id}_${currentStep.action}`
          : 'unknown_step';
        const timestamp = Date.now();

        const activePages = context.pages();
        this.logger.warn(
          `📸 [Emergency UI] Phát hiện hệ thống đang mở [${activePages.length}] Tab tại mốc sập luồng.`,
        );

        for (let index = 0; index < activePages.length; index++) {
          const targetPage = activePages[index];

          try {
            const pageUrl = targetPage.url();
            const filename = `screenshots/fail_${stepDetail}_tab_${index}_${timestamp}.png`;

            await targetPage.screenshot({
              path: filename,
              fullPage: true,
            });

            this.logger.log(
              `✅ [Screenshot Tab ${index}] Đã lưu ảnh hiện trường Tab [${pageUrl}] tại: ${filename}`,
            );
          } catch (pageError) {
            this.logger.error(
              `⚠️ Gặp lỗi khi cố chụp ảnh Tab số [${index}]: ${pageError.message}`,
            );
          }
        }
      } catch (screenshotError) {
        this.logger.error(
          `❌ Cụm xử lý chụp ảnh đa Tab thất bại: ${screenshotError.message}`,
        );
      }

      throw error;
    } finally {
      this.logger.log('🔒 Đóng phiên làm việc (Context), giải phóng bộ nhớ.');
      await context.close();

      if (!isSharedBrowser) {
        this.logger.log('🛏 Đóng trình duyệt độc lập của Master.');
        await browser.close();
      }
    }
  }
}
