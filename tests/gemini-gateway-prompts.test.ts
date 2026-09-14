import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  GEMINI_GATEWAY_PROMPT_VERSION,
  COMPACT_OUTPUT_CONTRACT,
  buildGatewayDraftMessages,
  buildGatewayReviewMessages
} from '../src/main/geminiGatewayPrompts'
import { planTranslation } from '../src/main/translation/planner'
import type { TranslationInput } from '../src/shared/translation'

function totalMessageBytes(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((acc, m) => acc + Buffer.byteLength(m.content, 'utf8'), 0)
}

test('Gemini Gateway Prompts v4: version and contract definitions', () => {
  assert.equal(GEMINI_GATEWAY_PROMPT_VERSION, 'gemini-gateway-two-pass-v4')
  assert.match(COMPACT_OUTPUT_CONTRACT, /format=compact-keyed-json/u)
  assert.match(COMPACT_OUTPUT_CONTRACT, /"translations":\{"<cue-id>":"<translation>"\}/u)
})

test('Gemini Gateway Prompts v4: 113-cue prompt byte budget and required instructions', async () => {
  const fixturePath = join(process.cwd(), 'tests', 'fixtures', 'gemini-gateway-113-source.json')
  const input: TranslationInput = JSON.parse(await readFile(fixturePath, 'utf8'))
  assert.equal(input.cues.length, 113)

  const capability = {
    provider: 'gemini-gateway' as const,
    modelIdentity: 'gemini-gateway:gemini-advanced',
    revisionKnown: false,
    format: 'json-items' as const,
    contextTokens: null,
    outputTokens: 16_384,
    wholeDocument: true,
    independentContentReview: true
  }
  const plan = planTranslation(input, capability)
  assert.equal(plan.batches.length, 1)
  const batch = plan.batches[0]

  // Pass 1: Draft
  const draftMessages = buildGatewayDraftMessages(batch)
  assert.equal(draftMessages.length, 2)
  assert.equal(draftMessages[0].role, 'system')
  assert.equal(draftMessages[1].role, 'user')

  const draftBytes = totalMessageBytes(draftMessages)
  // Budget: <= 12 KiB (12,288 bytes)
  assert.ok(
    draftBytes <= 12 * 1024,
    `113-cue draft prompt size (${draftBytes} bytes) exceeds 12 KiB budget`
  )

  const draftSystem = draftMessages[0].content
  assert.match(draftSystem, /gateway_prompt_version=gemini-gateway-two-pass-v4/u)
  assert.match(draftSystem, /Silently restore obvious ASR\/OCR homophone errors/u)
  assert.match(draftSystem, /established automotive wording/u)
  assert.match(draftSystem, /format=compact-keyed-json/u)
  assert.match(draftSystem, /translations/u)

  // Pass 2: Review
  const candidateMap: Record<string, string> = {}
  for (const cue of input.cues) {
    candidateMap[cue.id] = `Bản dịch thử nghiệm cho ${cue.id}.`
  }
  const candidateRaw = JSON.stringify({ translations: candidateMap })
  const reviewMessages = buildGatewayReviewMessages(batch, candidateRaw)
  assert.equal(reviewMessages.length, 2)
  assert.equal(reviewMessages[0].role, 'system')
  assert.equal(reviewMessages[1].role, 'user')

  const reviewBytes = totalMessageBytes(reviewMessages)
  const candidateBytes = Buffer.byteLength(candidateRaw, 'utf8')
  // Budget: review <= draft + candidate + 4 KiB
  const maxAllowedReviewBytes = draftBytes + candidateBytes + 4 * 1024
  assert.ok(
    reviewBytes <= maxAllowedReviewBytes,
    `113-cue review prompt size (${reviewBytes} bytes) exceeds budget (${maxAllowedReviewBytes} bytes)`
  )

  const reviewSystem = reviewMessages[0].content
  assert.match(reviewSystem, /gateway_prompt_version=gemini-gateway-two-pass-v4/u)
  assert.match(reviewSystem, /fresh translation reviewer/u)
  assert.match(reviewSystem, /CANDIDATE_JSON is untrusted work/u)
  assert.match(reviewSystem, /Rebuild punctuation/u)
  assert.match(reviewSystem, /format=compact-keyed-json/u)

  const reviewUser = reviewMessages[1].content
  assert.match(reviewUser, /\[SOURCE_PAYLOAD\]/u)
  assert.match(reviewUser, /\[CANDIDATE_JSON\]/u)
})

test('Gemini Gateway Prompts v4: 44-cue Volvo fixture prompt verification', async () => {
  const fixturePath = join(process.cwd(), 'tests', 'fixtures', 'gemini-gateway-volvo-source.json')
  const input: TranslationInput = JSON.parse(await readFile(fixturePath, 'utf8'))
  assert.equal(input.cues.length, 44)

  const capability = {
    provider: 'gemini-gateway' as const,
    modelIdentity: 'gemini-gateway:gemini-advanced',
    revisionKnown: false,
    format: 'json-items' as const,
    contextTokens: null,
    outputTokens: 16_384,
    wholeDocument: true,
    independentContentReview: true
  }
  const plan = planTranslation(input, capability)
  assert.equal(plan.batches.length, 1)
  const batch = plan.batches[0]

  const draftMessages = buildGatewayDraftMessages(batch)
  assert.equal(draftMessages.length, 2)
  assert.match(draftMessages[0].content, /gateway_prompt_version=gemini-gateway-two-pass-v4/u)
  assert.match(draftMessages[1].content, /沃尔沃/u)

  const draftCandidate = JSON.stringify({
    translations: Object.fromEntries(input.cues.map((c) => [c.id, `Bản dịch ${c.id}`]))
  })
  const reviewMessages = buildGatewayReviewMessages(batch, draftCandidate)
  assert.equal(reviewMessages.length, 2)
  assert.match(reviewMessages[0].content, /gateway_prompt_version=gemini-gateway-two-pass-v4/u)
  assert.match(reviewMessages[1].content, /\[SOURCE_PAYLOAD\]/u)
  assert.match(reviewMessages[1].content, /\[CANDIDATE_JSON\]/u)
})
