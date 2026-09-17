import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSourceEvidencePack,
  compactRestorationEvidence,
  buildRestorationDraftPayload,
  buildRestorationReviewPayload,
  validateRestorationDraft,
  validateRestorationReview,
  applyRestorationPipeline,
  calculateRestorationCandidateDigest,
  measureRestorationQuality,
  type SourceCue,
  type SourceEvidencePack,
  type RestorationDraftResult,
  type RestorationReviewResult
} from '../src/main/translation/sourceRestoration'

test('compact OCR keeps local evidence identity, distinct readings, cue boundaries and review refs', () => {
  const cues: SourceCue[] = [{ id: 'c1', start: 0, end: 2, text: '一' }, { id: 'c2', start: 2, end: 4, text: '二' }]
  const pack = buildSourceEvidencePack({ cues, ocrFrames: [
    { timestamp: 0, end: 0.1, lines: [{ text: '沃尔沃', confidence: 0.8 }] },
    { timestamp: 0.1, end: 0.2, lines: [{ text: '沃尔沃', confidence: 0.95 }] },
    { timestamp: 0.2, end: 0.3, lines: [{ text: '窝耳窝', confidence: 0.6 }] },
    { timestamp: 2.1, end: 2.2, lines: [{ text: '沃尔沃', confidence: 0.99 }] }
  ] })
  const before = JSON.stringify(pack)
  const compact = compactRestorationEvidence(pack.items)
  assert.deepEqual(compact.map((item) => item.id), ['ocr_1', 'ocr_2', 'ocr_3'])
  assert.deepEqual(compact[0].matchingCueIds, ['c1'])
  assert.equal(compact[0].start, 0.1)
  assert.equal(compact[0].end, 0.2)
  const draft: RestorationDraftResult = {
    schemaVersion: 'restoration-translation-v1', evidenceDigest: pack.evidenceDigest,
    sourceEdits: [{ id: 'c1', text: '沃尔沃', kind: 'entity', evidenceRefs: ['ocr_0'] }],
    sentenceEndIds: ['c2'], entities: [], items: [{ id: 'c1', target: 'Volvo' }, { id: 'c2', target: 'Hai' }]
  }
  const review = JSON.parse(buildRestorationReviewPayload({ evidencePack: pack, targetLang: 'vi', draft }))
  assert.ok(review.evidenceItems.some((item: { id: string }) => item.id === 'ocr_0'))
  validateRestorationDraft(draft, cues, pack)
  assert.equal(JSON.stringify(pack), before)
  assert.deepEqual(JSON.parse(buildRestorationDraftPayload({ evidencePack: pack, targetLang: 'vi', cues })).cues, cues)
})

test('dense per-frame OCR no longer inflates the prompt for an unchanged subtitle', () => {
  const cues: SourceCue[] = [{ id: 'c1', start: 0, end: 50, text: '花样游泳' }]
  const pack = buildSourceEvidencePack({ cues, ocrFrames: Array.from({ length: 400 }, (_, i) => ({
    timestamp: i / 8, end: (i + 1) / 8,
    lines: [{ text: '花样游泳', confidence: 0.987654321, boundingBox: { x: 135, y: 1395, width: 814, height: 54 } }]
  })) })
  const payload = buildRestorationDraftPayload({ evidencePack: pack, cues, targetLang: 'vi' })
  assert.equal(JSON.parse(payload).evidenceItems.length, 1)
  assert.ok(payload.length < JSON.stringify(pack.items).length / 10)
  assert.equal(pack.items.length, 400)
})

test('buildSourceEvidencePack formats audio and OCR evidence correctly', () => {
  const cues: SourceCue[] = [
    { id: 'c1', start: 0, end: 2.5, text: '这辆窝耳窝非常不错' },
    { id: 'c2', start: 2.6, end: 5.0, text: '动力表现很充沛' }
  ]

  const ocrFrames = [
    {
      timestamp: 1.0,
      lines: [
        { text: '沃尔沃 XC90 试驾', confidence: 0.95, boundingBox: { x: 100, y: 200, width: 300, height: 50 } }
      ]
    },
    {
      timestamp: 4.0,
      lines: [
        { text: 'B6 智雅豪华版', confidence: 0.92, boundingBox: { x: 100, y: 200, width: 250, height: 50 } }
      ]
    }
  ]

  const pack = buildSourceEvidencePack({
    audioMeta: { durationSeconds: 5.0, sampleRate: 16000, channels: 1, format: 'wav', sha256: 'a'.repeat(64) },
    ocrFrames,
    cues
  })

  assert.ok(pack.digest.length > 0)
  assert.equal(pack.items.length, 3)
  const ocrItems = pack.items.filter((item) => item.type === 'ocr')
  assert.equal(ocrItems[0].text, '沃尔沃 XC90 试驾')
  assert.ok(ocrItems[0].matchingCueIds.includes('c1'))
  assert.deepEqual(ocrItems[0].region, { x: 100, y: 200, width: 300, height: 50 })
  assert.equal(ocrItems[1].text, 'B6 智雅豪华版')
  assert.ok(ocrItems[1].matchingCueIds.includes('c2'))
  assert.equal(pack.items.some((item) => item.type === 'audio'), true)
})

test('validateRestorationDraft enforces 1:1 cue cardinality and validates evidence refs', () => {
  const cues: SourceCue[] = [
    { id: 'c1', start: 0, end: 2, text: '第一句' },
    { id: 'c2', start: 2, end: 4, text: '第二句' }
  ]

  const pack = buildSourceEvidencePack({
    cues,
    ocrFrames: [{ timestamp: 1, lines: [{ text: '第一句 正确', confidence: 0.9 }] }]
  })

  // 1. Missing cue
  assert.throws(() => {
    validateRestorationDraft(
      JSON.stringify({
        schemaVersion: 'restoration-translation-v1',
        evidenceDigest: pack.evidenceDigest,
        items: [{ id: 'c1', target: 'First sentence' }],
        sourceEdits: [],
        entities: [],
        sentenceEndIds: ['c1']
      }),
      cues,
      pack
    )
  }, /không khớp với số cue nguồn/)

  // 2. Extra cue
  assert.throws(() => {
    validateRestorationDraft(
      JSON.stringify({
        schemaVersion: 'restoration-translation-v1',
        evidenceDigest: pack.evidenceDigest,
        items: [
          { id: 'c1', target: 'First' },
          { id: 'c2', target: 'Second' },
          { id: 'c3', target: 'Extra' }
        ],
        sourceEdits: [],
        entities: [],
        sentenceEndIds: ['c2']
      }),
      cues,
      pack
    )
  }, /không khớp với số cue nguồn/)

  // 3. Valid draft with source edits and evidence
  const validDraftJson = JSON.stringify({
    schemaVersion: 'restoration-translation-v1',
    evidenceDigest: pack.evidenceDigest,
    items: [
      { id: 'c1', target: 'Câu thứ nhất đã sửa' },
      { id: 'c2', target: 'Câu thứ hai giữ nguyên' }
    ],
    sourceEdits: [
      {
        id: 'c1',
        text: '第一句 正确',
        kind: 'ocr_alignment',
        evidenceRefs: ['ocr_0']
      }
    ],
    entities: [
      {
        source: '第一句',
        target: 'Câu thứ nhất',
        sourceCueIds: ['c1'],
        evidenceRefs: ['ocr_0']
      }
    ],
    sentenceEndIds: ['c1', 'c2']
  })

  const draft = validateRestorationDraft(validDraftJson, cues, pack)
  assert.equal(draft.items.length, 2)
  assert.equal(draft.sourceEdits.length, 1)
  assert.equal(draft.sourceEdits[0].id, 'c1')
  assert.equal(draft.sourceEdits[0].text, '第一句 正确')
  assert.deepEqual(draft.sourceEdits[0].evidenceRefs, ['ocr_0'])

  assert.throws(() => validateRestorationDraft({
    schemaVersion: 'restoration-translation-v1',
    evidenceDigest: pack.evidenceDigest,
    items: [{ id: 'c1', target: 'A' }, { id: 'c1', target: 'B' }],
    sentenceEndIds: [],
    sourceEdits: [],
    entities: []
  }, cues, pack), /trùng|duplicate/iu)

  assert.throws(() => validateRestorationDraft({
    schemaVersion: 'restoration-translation-v1',
    evidenceDigest: pack.evidenceDigest,
    items: [{ id: 'c1', target: 'A' }, { id: 'c2', target: 'B' }],
    sentenceEndIds: [],
    sourceEdits: [{ id: 'c1', text: 'Sửa không căn cứ', kind: 'semantic', evidenceRefs: ['unknown-evidence'] }],
    entities: []
  }, cues, pack), /evidence|bằng chứng/iu)

  assert.throws(() => validateRestorationDraft({
    schemaVersion: 'restoration-translation-v1',
    evidenceDigest: pack.evidenceDigest,
    items: [{ id: 'c1', target: 'A' }, { id: 'c2', target: 'B' }],
    sentenceEndIds: [],
    sourceEdits: [{ id: 'c1', text: 'Sửa không căn cứ', kind: 'semantic', evidenceRefs: [] }],
    entities: []
  }, cues, pack), /evidence|bằng chứng/iu)
})

test('validateRestorationDraft accepts only the observed Gateway cueId source-edit alias', () => {
  const cues: SourceCue[] = [{ id: 'c1', start: 0, end: 2, text: '窝耳窝 XC90' }]
  const pack = buildSourceEvidencePack({
    cues,
    ocrFrames: [{ timestamp: 1, lines: [{ text: '沃尔沃 XC90', confidence: 0.99 }] }]
  })
  const base = {
    schemaVersion: 'restoration-translation-v1',
    evidenceDigest: pack.evidenceDigest,
    sentenceEndIds: ['c1'],
    entities: [],
    items: [{ id: 'c1', target: 'Volvo XC90' }]
  }

  const draft = validateRestorationDraft({
    ...base,
    sourceEdits: [{ cueId: 'c1', text: '沃尔沃 XC90', evidenceRefs: ['ocr_0'] }]
  }, cues, pack)

  assert.deepEqual(draft.sourceEdits, [{
    id: 'c1',
    text: '沃尔沃 XC90',
    kind: 'semantic',
    evidenceRefs: ['ocr_0']
  }])

  assert.throws(() => validateRestorationDraft({
    ...base,
    sourceEdits: [{ cueId: 'c1', text: '沃尔沃 XC90', evidenceRefs: ['ocr_0'], confidence: 0.99 }]
  }, cues, pack), /schema/iu)
})

test('entity evidence may cover several source cues with one local reference per cue', () => {
  const cues: SourceCue[] = [
    { id: 'c1', start: 0, end: 1, text: '发胶' },
    { id: 'c2', start: 2, end: 3, text: '抹发胶' }
  ]
  const pack = buildSourceEvidencePack({ cues, ocrFrames: [
    { timestamp: 0.2, end: 0.3, lines: [{ text: '发胶', confidence: 0.9 }] },
    { timestamp: 2.2, end: 2.3, lines: [{ text: '发胶', confidence: 0.92 }] }
  ] })
  const draft = validateRestorationDraft({
    schemaVersion: 'restoration-translation-v1', evidenceDigest: pack.evidenceDigest,
    sourceEdits: [], sentenceEndIds: ['c2'],
    entities: [{ source: '发胶', target: 'keo xịt tóc', sourceCueIds: ['c1', 'c2'], evidenceRefs: ['ocr_0', 'ocr_1'] }],
    items: [{ id: 'c1', target: 'Keo xịt tóc' }, { id: 'c2', target: 'Bôi keo xịt tóc' }]
  }, cues, pack)
  assert.deepEqual(draft.entities[0].sourceCueIds, ['c1', 'c2'])
  assert.deepEqual(draft.entities[0].evidenceRefs, ['ocr_0', 'ocr_1'])
})

test('validateRestorationReview validates reviewer decisions and structure', () => {
  const cues: SourceCue[] = [
    { id: 'c1', start: 0, end: 2, text: '第一句' }
  ]
  const pack = buildSourceEvidencePack({ cues, ocrFrames: [{ timestamp: 1, lines: [{ text: '第一句', confidence: 0.99 }] }] })
  const draft: RestorationDraftResult = {
    schemaVersion: 'restoration-translation-v1',
    items: [{ id: 'c1', target: 'Sentence 1' }],
    sourceEdits: [],
    entities: [],
    sentenceEndIds: ['c1']
  }

  const validReviewJson = JSON.stringify({
    schemaVersion: 'restoration-review-v1',
    candidateDigest: calculateRestorationCandidateDigest(draft),
    reviewedCueIds: ['c1'],
    status: 'approved',
    confidenceScore: 0.95,
    reviewerNotes: 'Bản dịch chính xác và bảo toàn thực thể',
    groupAssessments: [
      {
        groupId: 'grp_0',
        cueIds: ['c1'],
        status: 'approved',
        reason: 'Khớp với ngữ cảnh âm thanh'
      }
    ],
    findings: [],
    replacements: []
  })

  const review = validateRestorationReview(validReviewJson, draft, pack)
  assert.equal(review.status, 'approved')
  assert.equal(review.confidenceScore, 0.95)
  assert.equal(review.groupAssessments.length, 1)

  assert.throws(() => validateRestorationReview({
    schemaVersion: 'restoration-review-v1',
    candidateDigest: 'stale-digest',
    reviewedCueIds: ['c1'],
    status: 'approved',
    confidenceScore: 0.95,
    reviewerNotes: 'stale',
    groupAssessments: [{ groupId: 'grp_0', cueIds: ['c1'], status: 'approved', reason: 'ok' }],
    findings: [],
    replacements: []
  }, draft, pack), /digest/iu)

  assert.throws(() => validateRestorationReview({
    schemaVersion: 'restoration-review-v1',
    candidateDigest: calculateRestorationCandidateDigest(draft),
    reviewedCueIds: [],
    status: 'approved',
    confidenceScore: 0.95,
    reviewerNotes: 'empty review',
    groupAssessments: [],
    findings: [],
    replacements: []
  }, draft, pack), /reviewed|nhóm|group|bao phủ/iu)
})

test('applyRestorationPipeline applies validated edits and preserves 100% timestamps & IDs', () => {
  const cues: SourceCue[] = [
    { id: 'c1', start: 0.5, end: 3.2, text: '窝耳窝 XC90' },
    { id: 'c2', start: 3.5, end: 6.8, text: '一亿两千万橡树' },
    { id: 'c3', start: 7.0, end: 9.5, text: '原声完全正确' }
  ]

  const draft: RestorationDraftResult = {
    schemaVersion: 'restoration-translation-v1',
    items: [
      { id: 'c1', target: 'Volvo XC90' },
      { id: 'c2', target: '120 triệu điểm ảnh' },
      { id: 'c3', target: 'Âm thanh gốc hoàn toàn đúng' }
    ],
    sourceEdits: [
      { id: 'c1', text: '沃尔沃 XC90', kind: 'homophone', evidenceRefs: ['ocr_0'] },
      { id: 'c2', text: '一亿两千万像素', kind: 'homophone', evidenceRefs: [] }
    ],
    entities: [
      { source: '沃尔沃', target: 'Volvo', sourceCueIds: ['c1'], evidenceRefs: ['ocr_0'] }
    ],
    sentenceEndIds: ['c2', 'c3']
  }

  const review: RestorationReviewResult = {
    schemaVersion: 'restoration-review-v1',
    candidateDigest: calculateRestorationCandidateDigest(draft),
    reviewedCueIds: ['c1', 'c2', 'c3'],
    status: 'approved',
    confidenceScore: 0.98,
    reviewerNotes: 'Đã chuẩn hóa danh từ riêng Volvo và pixel',
    groupAssessments: [
      { groupId: 'grp_0', cueIds: ['c1', 'c2'], status: 'approved', reason: 'Tốt' },
      { groupId: 'grp_1', cueIds: ['c3'], status: 'approved', reason: 'Tốt' }
    ],
    findings: [],
    replacements: []
  }

  const result = applyRestorationPipeline({ cues, draft, review })

  assert.equal(result.restoredCues.length, 3)
  // Check timestamps and IDs preserved exactly
  assert.equal(result.restoredCues[0].id, 'c1')
  assert.equal(result.restoredCues[0].start, 0.5)
  assert.equal(result.restoredCues[0].end, 3.2)
  assert.equal(result.restoredCues[0].text, '沃尔沃 XC90')

  assert.equal(result.restoredCues[1].id, 'c2')
  assert.equal(result.restoredCues[1].start, 3.5)
  assert.equal(result.restoredCues[1].end, 6.8)
  assert.equal(result.restoredCues[1].text, '一亿两千万像素')

  assert.equal(result.restoredCues[2].id, 'c3')
  assert.equal(result.restoredCues[2].start, 7.0)
  assert.equal(result.restoredCues[2].end, 9.5)
  assert.equal(result.restoredCues[2].text, '原声完全正确')

  // Translated items
  assert.equal(result.translatedItems.length, 3)
  assert.equal(result.translatedItems[0].target, 'Volvo XC90')
  assert.equal(result.translatedItems[0].isSentenceEnd, false)
  assert.equal(result.translatedItems[1].isSentenceEnd, true)
  assert.equal(result.translatedItems[2].isSentenceEnd, true)
})

test('applyRestorationPipeline rolls back group edits when group review is rejected', () => {
  const cues: SourceCue[] = [
    { id: 'c1', start: 0, end: 2, text: 'Câu gốc' }
  ]

  const draft: RestorationDraftResult = {
    schemaVersion: 'restoration-translation-v1',
    items: [{ id: 'c1', target: 'Đã sửa sai' }],
    sourceEdits: [{ id: 'c1', text: 'Sửa bừa', kind: 'semantic', evidenceRefs: [] }],
    entities: [],
    sentenceEndIds: ['c1']
  }

  const review: RestorationReviewResult = {
    schemaVersion: 'restoration-review-v1',
    candidateDigest: calculateRestorationCandidateDigest(draft),
    reviewedCueIds: ['c1'],
    status: 'needs_adjustment',
    confidenceScore: 0.4,
    reviewerNotes: 'Nhóm dịch sai ngữ nghĩa',
    groupAssessments: [
      { groupId: 'grp_0', cueIds: ['c1'], status: 'rejected', reason: 'Không khớp ngữ cảnh' }
    ],
    findings: [],
    replacements: []
  }

  assert.throws(() => applyRestorationPipeline({ cues, draft, review }), /rejected|từ chối/iu)
})

test('applyRestorationPipeline rejects a partial adjustment group and does not claim unavailable quality metrics', () => {
  const cues: SourceCue[] = [
    { id: 'c1', start: 0, end: 1, text: 'Nguồn 1' },
    { id: 'c2', start: 1, end: 2, text: 'Nguồn 2' }
  ]
  const draft: RestorationDraftResult = {
    schemaVersion: 'restoration-translation-v1',
    items: [{ id: 'c1', target: 'Đích 1' }, { id: 'c2', target: 'Đích 2' }],
    sourceEdits: [],
    entities: [],
    sentenceEndIds: ['c2']
  }
  const partialReview: RestorationReviewResult = {
    schemaVersion: 'restoration-review-v1',
    candidateDigest: calculateRestorationCandidateDigest(draft),
    reviewedCueIds: ['c1', 'c2'],
    status: 'needs_adjustment',
    confidenceScore: 0.5,
    reviewerNotes: 'needs both cues',
    groupAssessments: [{ groupId: 'g', cueIds: ['c1', 'c2'], status: 'needs_adjustment', reason: 'repair together' }],
    findings: [],
    replacements: [{ groupId: 'g', sourceEdits: [], items: [{ id: 'c1', target: 'Chỉ sửa một nửa' }] }]
  }
  assert.throws(() => applyRestorationPipeline({ cues, draft, review: partialReview }), /toàn bộ|atomic|group|một phần/iu)

  const approved: RestorationReviewResult = {
    ...partialReview,
    status: 'approved',
    groupAssessments: [{ groupId: 'g', cueIds: ['c1', 'c2'], status: 'approved', reason: 'ok' }],
    replacements: []
  }
  const result = applyRestorationPipeline({ cues, draft, review: approved })
  assert.equal(result.metrics.accuracyRate, null)
  assert.equal(result.metrics.corruptedCleanCues, null)
})

test('measureRestorationQuality evaluates 44-cue Volvo real scenario with zero corruption', () => {
  const originalCues: SourceCue[] = []
  const groundTruthCleanCues: SourceCue[] = []

  for (let i = 1; i <= 44; i++) {
    const id = `cue_${i}`
    const start = (i - 1) * 3
    const end = start + 2.5

    let asrText = `这是关于汽车评测的第 ${i} 句详细说明，车辆行驶质感非常平顺稳定。`
    let cleanText = asrText

    if (i === 5) {
      // Homophone error 1: 沃尔沃 -> 窝耳窝
      asrText = '今天我们试驾的这辆窝耳窝XC90搭载了双增压系统。'
      cleanText = '今天我们试驾的这辆沃尔沃XC90搭载了双增压系统。'
    } else if (i === 12) {
      // Homophone error 2: 像素 -> 橡树
      asrText = '中控大屏配备了一亿两千万橡树超清显示面板。'
      cleanText = '中控大屏配备了一亿两千万像素超清显示面板。'
    } else if (i === 28) {
      // Entity error 3: 领克 -> 领客
      asrText = '底盘架构与同平台的领客09有很多相似之处。'
      cleanText = '底盘架构与同平台的领克09有很多相似之处。'
    }

    originalCues.push({ id, start, end, text: asrText })
    groundTruthCleanCues.push({ id, start, end, text: cleanText })
  }

  // Model restored cues (properly repaired the 3 errors, kept 41 other cues clean)
  const restoredCues = originalCues.map((cue) => {
    if (cue.id === 'cue_5') {
      return { ...cue, text: '今天我们试驾的这辆沃尔沃XC90搭载了双增压系统。' }
    }
    if (cue.id === 'cue_12') {
      return { ...cue, text: '中控大屏配备了一亿两千万像素超清显示面板。' }
    }
    if (cue.id === 'cue_28') {
      return { ...cue, text: '底盘架构与同平台的领克09有很多相似之处。' }
    }
    return { ...cue }
  })

  const knownAsrErrors = [
    { id: 'cue_5', errorPattern: '窝耳窝', expectedFix: '沃尔沃' },
    { id: 'cue_12', errorPattern: '橡树', expectedFix: '像素' },
    { id: 'cue_28', errorPattern: '领客', expectedFix: '领克' }
  ]

  const report = measureRestorationQuality({
    originalCues,
    restoredCues,
    groundTruthCleanCues,
    knownAsrErrors
  })

  assert.equal(report.totalCues, 44)
  assert.equal(report.knownErrorsEvaluated, 3)
  assert.equal(report.fixedAsrErrors, 3)
  assert.equal(report.corruptedCleanCues, 0, 'Phải bảo toàn 100% câu đúng, không được sửa sai câu đúng!')
  assert.equal(report.droppedCues, 0, 'Tuyệt đối không được làm rơi rụng cue!')
  assert.equal(report.cueIdIntegrity, true, 'Cue ID phải bảo toàn 100%!')
  assert.equal(report.timestampsIntegrity, true, 'Timestamps [start, end] phải bảo toàn 100%!')
  assert.equal(report.accuracyRate, 1.0)
})
