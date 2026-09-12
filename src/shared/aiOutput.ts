/** Pure, isomorphic primitives for parsing untrusted model output. */

export const AI_OUTPUT_PARSER_VERSION = 'ai-output-parser-v1'
export const AI_OUTPUT_SCHEMA_VERSION = 'ai-output-schema-v1'

export type AiJsonOutcome = 'clean' | 'unwrapped' | 'extracted'
export type AiStructuredTask = 'title' | 'summary' | 'video-seo'
export type AiCompletionState = 'complete' | 'truncated' | 'refused' | 'filtered' | 'unknown'

export interface AiCompletionEnvelope {
  rawText: string
  provider: string
  modelIdentity: string
  formatMode: 'schema-constrained' | 'json-only'
  completion: AiCompletionState
  transport: 'complete' | 'incomplete'
  finishReason?: string
}

export interface AiJsonLimits {
  maxBytes: number
  maxDepth: number
  maxMembers: number
  maxCandidates: number
}

export interface ParsedAiJsonObject {
  value: Record<string, unknown>
  outcome: AiJsonOutcome
  bytes: number
}

const DEFAULT_LIMITS: AiJsonLimits = {
  maxBytes: 256 * 1024,
  maxDepth: 16,
  maxMembers: 1_000,
  maxCandidates: 1
}

export class AiOutputParseError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AiOutputParseError'
    this.code = code
  }
}

const TASK_PROPERTIES: Record<AiStructuredTask, Record<string, unknown>> = {
  title: { title: { type: 'string' } },
  summary: { summary: { type: 'string' } },
  'video-seo': {
    title: { type: 'string' },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 100 },
    hashtags: { type: 'array', items: { type: 'string' }, maxItems: 100 }
  }
}

export function structuredOutputJsonSchema(task: AiStructuredTask): Record<string, unknown> {
  const properties = TASK_PROPERTIES[task]
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false
  }
}

export function openAiResponseFormat(task: AiStructuredTask): Record<string, unknown> {
  return {
    type: 'json_schema',
    json_schema: {
      name: task.replace(/-/gu, '_'),
      strict: true,
      schema: structuredOutputJsonSchema(task)
    }
  }
}

export function classifyCompletion(finishReason?: string, refused = false): AiCompletionState {
  if (refused) return 'refused'
  const reason = finishReason?.trim().toLowerCase()
  if (!reason) return 'unknown'
  if (['length', 'max_tokens', 'max_output_tokens'].includes(reason)) return 'truncated'
  if (['content_filter', 'safety', 'recitation', 'blocked'].includes(reason)) return 'filtered'
  if (['stop', 'end_turn'].includes(reason)) return 'complete'
  return 'unknown'
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length
}

function containsLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

class StrictJsonParser {
  private index = 0
  private members = 0

  constructor(private readonly text: string, private readonly limits: AiJsonLimits) {}

  parseDocument(): unknown {
    this.skipWhitespace()
    const value = this.parseValue(0)
    this.skipWhitespace()
    if (this.index !== this.text.length) this.fail('multiple-root', 'Phản hồi chứa dữ liệu ngoài JSON root.')
    return value
  }

  parsePrefix(): { value: unknown; end: number } {
    this.skipWhitespace()
    const value = this.parseValue(0)
    return { value, end: this.index }
  }

  private parseValue(depth: number): unknown {
    if (depth > this.limits.maxDepth) this.fail('depth-limit', 'JSON vượt giới hạn độ sâu.')
    const char = this.text[this.index]
    if (char === '{') return this.parseObject(depth + 1)
    if (char === '[') return this.parseArray(depth + 1)
    if (char === '"') return this.parseString()
    if (char === 't' && this.takeLiteral('true')) return true
    if (char === 'f' && this.takeLiteral('false')) return false
    if (char === 'n' && this.takeLiteral('null')) return null
    if (char === '-' || (char >= '0' && char <= '9')) return this.parseNumber()
    this.fail('invalid-json', 'Phản hồi không phải JSON hợp lệ.')
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.index++
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    const keys = new Set<string>()
    this.skipWhitespace()
    if (this.text[this.index] === '}') {
      this.index++
      return result
    }
    while (true) {
      this.skipWhitespace()
      if (this.text[this.index] !== '"') this.fail('invalid-json', 'Tên trường JSON phải là chuỗi.')
      const key = this.parseString()
      if (keys.has(key)) this.fail('duplicate-key', `JSON chứa trường trùng: ${key}.`)
      keys.add(key)
      this.countMember()
      this.skipWhitespace()
      if (this.text[this.index] !== ':') this.fail('invalid-json', 'JSON thiếu dấu hai chấm sau tên trường.')
      this.index++
      this.skipWhitespace()
      result[key] = this.parseValue(depth)
      this.skipWhitespace()
      const next = this.text[this.index++]
      if (next === '}') return result
      if (next !== ',') this.fail('invalid-json', 'JSON object chưa đóng đúng định dạng.')
    }
  }

  private parseArray(depth: number): unknown[] {
    this.index++
    const result: unknown[] = []
    this.skipWhitespace()
    if (this.text[this.index] === ']') {
      this.index++
      return result
    }
    while (true) {
      this.countMember()
      result.push(this.parseValue(depth))
      this.skipWhitespace()
      const next = this.text[this.index++]
      if (next === ']') return result
      if (next !== ',') this.fail('invalid-json', 'JSON array chưa đóng đúng định dạng.')
      this.skipWhitespace()
    }
  }

  private parseString(): string {
    const start = this.index
    this.index++
    let escaped = false
    while (this.index < this.text.length) {
      const char = this.text[this.index++]
      if (escaped) {
        if (char === 'u') {
          const hex = this.text.slice(this.index, this.index + 4)
          if (!/^[0-9a-f]{4}$/iu.test(hex)) this.fail('invalid-json', 'JSON chứa Unicode escape không hợp lệ.')
          this.index += 4
        } else if (!/^["\\/bfnrt]$/u.test(char)) this.fail('invalid-json', 'JSON chứa escape không hợp lệ.')
        escaped = false
      } else if (char === '\\') escaped = true
      else if (char === '"') {
        let value: string
        try {
          value = JSON.parse(this.text.slice(start, this.index)) as string
        } catch {
          this.fail('invalid-json', 'JSON chứa chuỗi không hợp lệ.')
        }
        if (containsLoneSurrogate(value!)) this.fail('invalid-unicode', 'JSON chứa Unicode surrogate không hoàn chỉnh.')
        return value!
      } else if (char.charCodeAt(0) <= 0x1f) this.fail('invalid-json', 'JSON chứa ký tự điều khiển chưa escape.')
    }
    this.fail('invalid-json', 'JSON chứa chuỗi chưa đóng.')
  }

  private parseNumber(): number {
    const source = this.text.slice(this.index)
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(source)
    if (!match) this.fail('invalid-json', 'JSON chứa số không hợp lệ.')
    this.index += match![0].length
    const value = Number(match![0])
    if (!Number.isFinite(value)) this.fail('invalid-number', 'JSON chứa số vượt giới hạn hữu hạn.')
    return value
  }

  private takeLiteral(literal: string): boolean {
    if (!this.text.startsWith(literal, this.index)) return false
    this.index += literal.length
    return true
  }

  private skipWhitespace(): void {
    while (this.text[this.index] === ' ' || this.text[this.index] === '\t' ||
      this.text[this.index] === '\r' || this.text[this.index] === '\n') this.index++
  }

  private countMember(): void {
    this.members++
    if (this.members > this.limits.maxMembers) this.fail('member-limit', 'JSON có quá nhiều phần tử.')
  }

  private fail(code: string, message: string): never {
    throw new AiOutputParseError(code, message)
  }
}

function exactObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiOutputParseError('wrong-root', 'AI phải trả về đúng một JSON object.')
  }
  return value as Record<string, unknown>
}

function limitsWith(overrides?: Partial<AiJsonLimits>): AiJsonLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides }
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new AiOutputParseError('invalid-limit', `Giới hạn ${key} không hợp lệ.`)
  }
  return limits
}

function completeFence(raw: string): string | null {
  const match = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```[\t ]*$/iu.exec(raw.trim())
  return match ? match[1] || '' : null
}

function topLevelObjectStarts(raw: string): number[] {
  const starts: number[] = []
  let inString = false
  let escaped = false
  let depth = 0
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') {
      if (depth === 0) starts.push(index)
      depth++
    } else if (char === '}' && depth > 0) depth--
  }
  return starts
}

export function parseAiJsonObject(raw: string, options: {
  allowFence?: boolean
  allowProseObject?: boolean
  limits?: Partial<AiJsonLimits>
} = {}): ParsedAiJsonObject {
  const limits = limitsWith(options.limits)
  const text = raw.replace(/^\ufeff/u, '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/gu, '')
  const bytes = utf8Bytes(text)
  if (bytes > limits.maxBytes) throw new AiOutputParseError('byte-limit', 'Phản hồi AI vượt giới hạn kích thước.')
  let strictError: AiOutputParseError | undefined
  try {
    return { value: exactObject(new StrictJsonParser(text, limits).parseDocument()), outcome: 'clean', bytes }
  } catch (error) {
    if (!(error instanceof AiOutputParseError)) throw error
    strictError = error
  }
  if (options.allowFence) {
    const fenced = completeFence(text)
    if (fenced !== null) {
      return { value: exactObject(new StrictJsonParser(fenced, limits).parseDocument()), outcome: 'unwrapped', bytes }
    }
    if (text.startsWith('```')) throw new AiOutputParseError('malformed-fence', 'Phản hồi có code fence chưa hoàn chỉnh.')
  }
  if (!options.allowProseObject) throw strictError

  const candidates: Record<string, unknown>[] = []
  let malformed = false
  for (const start of topLevelObjectStarts(text)) {
    try {
      const parsed = new StrictJsonParser(text.slice(start), limits).parsePrefix()
      candidates.push(exactObject(parsed.value))
      if (candidates.length > limits.maxCandidates) break
    } catch {
      malformed = true
    }
  }
  if (malformed || candidates.length !== 1) {
    throw new AiOutputParseError('ambiguous-json', 'AI trả về JSON mơ hồ hoặc không hoàn chỉnh.')
  }
  return { value: candidates[0], outcome: 'extracted', bytes }
}

export function assertExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const allowed = new Set(expected)
  const keys = Object.keys(record)
  if (keys.length !== expected.length || keys.some((key) => !allowed.has(key))) {
    throw new AiOutputParseError('schema-keys', `JSON phải chứa đúng các trường: ${expected.join(', ')}.`)
  }
}

export function containsProtocolPayload(value: string, contractKeys: readonly string[]): boolean {
  if (/```(?:json|text|txt)?/iu.test(value)) return true
  try {
    const parsed = parseAiJsonObject(value, { allowProseObject: true, limits: { maxBytes: 64 * 1024 } }).value
    return contractKeys.filter((key) => Object.prototype.hasOwnProperty.call(parsed, key)).length >= 2
  } catch {
    return false
  }
}
