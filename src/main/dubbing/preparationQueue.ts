/** Bounded asynchronous preparation, consumed exactly once in source order. */
export class PreparationQueue<T> {
  private controller = new AbortController()
  private outcomes = new Map<number, Promise<{ ok: true; value: T } | { ok: false; error: unknown }>>()
  private next = 0
  private consumed = 0
  private active = 0
  private stopped = false
  private readonly abortParent = (): void => { this.stopped = true; this.controller.abort() }

  constructor(
    private readonly count: number,
    private readonly concurrency: number,
    private readonly prepare: (index: number, signal: AbortSignal) => Promise<T>,
    private readonly parent: AbortSignal
  ) {
    if (parent.aborted) this.abortParent()
    else parent.addEventListener('abort', this.abortParent, { once: true })
    this.fill()
  }

  private fill(): void {
    while (!this.stopped && this.active < this.concurrency && this.next < this.count && this.next < this.consumed + 2 * this.concurrency) {
      const index = this.next++
      this.active++
      const outcome = Promise.resolve().then(() => this.prepare(index, this.controller.signal)).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => { this.stopped = true; return { ok: false as const, error } }
      ).finally(() => { this.active--; this.fill() })
      this.outcomes.set(index, outcome)
    }
  }

  async take(index: number): Promise<T> {
    if (index !== this.consumed) throw new Error('Preparation queue phải consume theo thứ tự nguồn.')
    const pending = this.outcomes.get(index)
    if (!pending) throw new Error('Preparation queue đã dừng trước cue tiếp theo.')
    const outcome = await pending
    this.outcomes.delete(index)
    if (!outcome.ok) throw outcome.error
    if (this.parent.aborted) throw new Error('Đã hủy tác vụ chuẩn bị audio.')
    this.consumed++
    this.fill()
    return outcome.value
  }

  async close(): Promise<void> {
    this.abortParent()
    await Promise.all(this.outcomes.values())
    this.outcomes.clear()
    this.parent.removeEventListener('abort', this.abortParent)
  }
}
