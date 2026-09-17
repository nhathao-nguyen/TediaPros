import type { ProviderWaitRecord } from './autoShortBatchJournal'

type Wait = Pick<ProviderWaitRecord, 'reason' | 'nextEligibleAtUtc'>

export function providerWaitNeedsAction(wait: Wait): boolean {
  return wait.reason === 'outcome-unknown' || !wait.nextEligibleAtUtc || !Number.isFinite(Date.parse(wait.nextEligibleAtUtc))
}

export function providerWaitMessage(wait: Wait): string {
  if (wait.reason === 'outcome-unknown') {
    return 'Đã tạm dừng: Gemini chưa trả kết quả hoàn chỉnh. Cần khôi phục Gateway trước khi tiếp tục; tác vụ không tự chạy lại.'
  }
  if (providerWaitNeedsAction(wait)) return `Đã tạm dừng: Gateway chưa có lịch thử lại (${wait.reason}). Cần kiểm tra Gateway trước khi tiếp tục.`
  return 'Gemini đang giới hạn yêu cầu. Sẽ tự tiếp tục khi hết thời gian chờ.'
}
