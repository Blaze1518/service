// src/modules/automation/automation.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { chromium, Browser } from 'playwright';
import { ActionMap } from './actions/action.map';

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  /**
   * Chạy kịch bản tự động hóa linh hoạt cho cả Master và Worker
   * @param steps Mảng kịch bản JSON
   * @param storageState Cục session dữ liệu (Cookies/LocalStorage)
   * @param options Các tùy chọn nâng cao cho Worker
   */
  async runWorkflow(
    steps: any[],
    storageState?: any,
    options?: { sharedBrowser?: Browser; blockResources?: boolean },
  ) {
    this.logger.log('Bắt đầu luồng automation...');

    let browser: Browser;
    let isSharedBrowser = false;

    // 1. Kiểm tra xem có dùng chung Browser từ Worker truyền xuống không
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

    // =========================================================================
    // 🛡️ BẬC THẦY ĐỒNG BỘ: ÉP ĐỒNG NHẤT USER-AGENT TRÁNH CƠ CHẾ KHÓA COOKIE CHÉO
    // =========================================================================
    // Số lượng cookies được nạp vào khay để giám sát
    const cookieCount = storageState?.cookies?.length || 0;
    this.logger.log(
      `📥 [Session] Tiến hành nạp đạn tài nguyên. Số lượng Cookies phát hiện: [${cookieCount}]`,
    );

    const context = await browser.newContext({
      storageState: storageState || undefined,
      // 🌟 PHÁ BẪY: Ép tất cả các luồng dù ngầm hay hiện hình đều dùng chung dấu chân Chrome Windows sạch
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });

    // 🌟 SỬA BUG: Phải tạo page TỪ CONTEXT thì mới ăn được Session!
    const page = await context.newPage();
    const runtimeContext = new Map<string, any>();

    try {
      // 3. Nếu cấu hình chặn tài nguyên (Tối ưu cho Worker)
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

      // 4. Vòng lặp thực thi kịch bản vạn năng
      for (const step of steps) {
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
      throw error;
    } finally {
      // 5. GIẢI PHÓNG BỘ NHỚ KHÔN NGOAN:
      this.logger.log('🔒 Đóng phiên làm việc (Context), giải phóng bộ nhớ.');
      await context.close(); // Luôn luôn đóng context của job này lại

      if (!isSharedBrowser) {
        // Nếu là Master tự mở trình duyệt riêng thì mới đóng hoàn toàn Browser
        this.logger.log('🛏 Đóng trình duyệt độc lập của Master.');
        await browser.close();
      }
    }
  }
}
