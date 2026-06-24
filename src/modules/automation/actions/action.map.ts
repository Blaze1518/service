import { Page } from 'playwright';
import { StepConfig } from '../interfaces/step.interface';

export const ActionMap: Record<
  StepConfig['action'],
  (page: Page, step: StepConfig, context?: Map<string, any>) => Promise<void>
> = {
  GOTO: async (page, step) => {
    if (!step.url) throw new Error(`Step ${step.id}: GOTO thiếu trường 'url'`);
    await page.goto(step.url, { timeout: step.timeout || 30000 });
  },

  CLICK: async (page, step, context) => {
    if (!step.selector)
      throw new Error(`Step ${step.id}: CLICK thiếu trường 'selector'`);
    const targetPage = context?.get('active_page') || page;
    await targetPage.click(step.selector, { timeout: step.timeout || 10000 });
  },

  INPUT: async (page, step) => {
    if (!step.selector || step.value === undefined) {
      throw new Error(`Step ${step.id}: INPUT thiếu selector hoặc value`);
    }

    const locator = page.locator(step.selector);

    await locator.waitFor({ state: 'visible', timeout: 10000 });

    await locator.fill(step.value);

    await page.keyboard.press('Tab');
  },

  WAIT_SELECTOR: async (page, step, context) => {
    if (!step.selector)
      throw new Error(`Step ${step.id}: WAIT_SELECTOR thiếu trường 'selector'`);
    const targetPage = context?.get('active_page') || page;

    const stateConfig =
      step.value === 'attached' || step.state === 'attached'
        ? 'attached'
        : 'visible';

    await targetPage.waitForSelector(step.selector, {
      state: stateConfig,
      timeout: step.timeout || 15000,
    });
  },

  WAIT_TIMEOUT: async (page, step) => {
    const delay = Number(step.value) || step.timeout || 2000;
    await page.waitForTimeout(delay);
  },

  WAIT_URL: async (page, step) => {
    if (!step.pattern)
      throw new Error(`Step ${step.id}: WAIT_URL thiếu trường 'pattern'`);
    await page.waitForURL(step.pattern, { timeout: step.timeout || 20000 });
  },

  CHECK_TEXT: async (page, step) => {
    if (!step.value)
      throw new Error(`Step ${step.id}: CHECK_TEXT thiếu trường 'value'`);

    await page.locator(`text=${step.value}`).waitFor({
      state: 'attached',
      timeout: step.timeout || 10000,
    });
  },

  KEY_PRESS: async (page, step) => {
    if (!step.value)
      throw new Error(
        `Step ${step.id}: KEY_PRESS thiếu trường 'value' (tên phím)`,
      );
    const target = step.selector || 'body';
    await page.press(target, step.value, { timeout: step.timeout || 5000 });
  },

  FRAME_CLICK: async (page, step) => {
    if (!step.frameSelector || !step.selector) {
      throw new Error(
        `Step ${step.id}: FRAME_CLICK thiếu 'frameSelector' hoặc 'selector'`,
      );
    }
    await page
      .frameLocator(step.frameSelector)
      .locator(step.selector)
      .click({ timeout: step.timeout || 15000 });
  },

  SCREENSHOT: async (page, step) => {
    const path =
      step.value || `storage/screenshots/step-${step.id}-${Date.now()}.png`;
    await page.screenshot({ path, fullPage: false });
  },

  SAVE_SESSION: async (page, step, context) => {
    if (!context) {
      throw new Error(
        `Step ${step.id}: Hành động SAVE_SESSION yêu cầu phải có runtimeContext`,
      );
    }
    const storageState = await page.context().storageState();

    context.set('saved_session', storageState);
  },

  CLICK_AND_WAIT_POPUP: async (page, step, context) => {
    if (!step.selector)
      throw new Error(
        `Step ${step.id}: CLICK_AND_WAIT_POPUP thiếu trường 'selector'`,
      );
    if (!context)
      throw new Error(
        `Step ${step.id}: CLICK_AND_WAIT_POPUP yêu cầu phải có runtimeContext`,
      );

    const targetPage = context.get('active_page') || page;

    // 🔥 CHIÊU ĐỘC: Lắng nghe sự kiện 'page' từ tầng CONTEXT để hốt trọn toàn bộ tab mới mở ra
    const pagePromise = targetPage.context().waitForEvent('page');

    // Thực hiện click nút mở hóa đơn nạp tiền
    await targetPage.click(step.selector, { timeout: step.timeout || 15000 });

    // 🎯 CHỐT HẠ: Ép Playwright tóm bằng được chiếc Tab mới xuất hiện
    const newTab = await pagePromise;

    // Đợi Tab hóa đơn tải xong cấu hình HTML
    await newTab.waitForLoadState('load');

    // Cất chiếc Tab xịn này vào túi thần kỳ để phục vụ cho các bước check tiếp theo
    context.set('active_page', newTab);
  },
};
