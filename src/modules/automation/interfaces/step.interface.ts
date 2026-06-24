export interface StepConfig {
  id: string;
  action:
    | 'GOTO'
    | 'CLICK'
    | 'INPUT'
    | 'WAIT_SELECTOR'
    | 'WAIT_TIMEOUT'
    | 'WAIT_URL'
    | 'CHECK_TEXT'
    | 'KEY_PRESS'
    | 'FRAME_CLICK'
    | 'SCREENSHOT'
    | 'SAVE_SESSION'
    | 'CLICK_AND_WAIT_POPUP';
  selector?: string; // Dùng cho CLICK, INPUT, WAIT_SELECTOR, KEY_PRESS
  value?: string; // Dùng cho INPUT (text cần gõ), KEY_PRESS (tên phím như 'Enter')
  url?: string; // Dùng cho GOTO
  pattern?: string; // Dùng cho WAIT_URL (Regex hoặc chuỗi khớp URL)
  timeout?: number; // Thời gian tối đa chờ đợi (ms)
  frameSelector?: string; // Dùng riêng cho các tương tác nằm trong thẻ <iframe>
  state?: string;
}
