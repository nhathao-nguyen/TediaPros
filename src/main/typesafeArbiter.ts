import { request as httpsRequest } from 'node:https'
import { loadTypeSafeKey } from './typesafeKeys'

export interface CandidateLink {
  text: string
  url: string
}

export interface JevArbitrationResult {
  choiceUrl: string | null
  confidence: number
}

/**
 * Sử dụng mô hình System One (Jev) của TypeSafe AI để chọn link chương tiếp theo
 * trong trường hợp thuật toán cục bộ gặp xung đột hoặc link bị giấu dưới dạng nút văn bản mơ hồ.
 */
export async function arbitrateNextChapterWithJev(params: {
  storyTitle: string
  currentUrl: string
  candidates: CandidateLink[]
}): Promise<JevArbitrationResult> {
  const apiKey = await loadTypeSafeKey()
  if (!apiKey || params.candidates.length === 0) {
    return { choiceUrl: null, confidence: 0 }
  }

  // Giới hạn tối đa 15 ứng viên để giữ request siêu nhẹ và phản hồi nhanh (< 50ms)
  const optionsMap: Record<string, string> = {}
  for (const c of params.candidates.slice(0, 15)) {
    optionsMap[c.url] = c.text.slice(0, 80) || 'Next chapter link'
  }
  optionsMap['none'] = 'No link belongs to the next chapter of this story'

  const payload = JSON.stringify({
    state: `Current story: "${params.storyTitle}". Currently at URL: ${params.currentUrl}`,
    model: 'jev-latest',
    questions: {
      next_chapter: {
        type: 'choice',
        instructions: 'Which link leads to the next sequential chapter of this ongoing story? Choose "none" if all links are unrelated or recommendations.',
        criteria: optionsMap
      }
    }
  })

  console.log(`[TypeSafe Jev] Đang phân xử link chương tiếp cho: "${params.storyTitle}" (${params.candidates.length} ứng viên)`)

  return new Promise<JevArbitrationResult>((resolve) => {
    try {
      const req = httpsRequest(
        'https://api.typesafe.ai/v1/systemone',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 8000
        },
        (res) => {
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () => {
            try {
              if (res.statusCode === 200) {
                const data = JSON.parse(body)
                const ans = data?.answers?.next_chapter
                if (ans && ans.choice && ans.choice !== 'none' && ans.confidence >= 0.4) {
                  console.log(`[TypeSafe Jev] Đã chọn link tiếp theo: ${ans.choice} (độ tin cậy ${Math.round(ans.confidence * 100)}%)`)
                  return resolve({ choiceUrl: ans.choice, confidence: ans.confidence })
                }
              }
            } catch {}
            console.log('[TypeSafe Jev] Không tìm thấy link chương tiếp phù hợp hoặc độ tin cậy thấp.')
            resolve({ choiceUrl: null, confidence: 0 })
          })
        }
      )

      req.on('error', () => resolve({ choiceUrl: null, confidence: 0 }))
      req.on('timeout', () => {
        req.destroy()
        resolve({ choiceUrl: null, confidence: 0 })
      })
      req.write(payload)
      req.end()
    } catch {
      resolve({ choiceUrl: null, confidence: 0 })
    }
  })
}

/**
 * Thẩm định xem trang tiếp theo (hoặc link kế tiếp) có thực sự là phần tiếp theo của câu chuyện hay không
 * khi thuật toán URL nghi ngờ bị nhảy cóc hoặc không liên tục.
 */
export async function arbitrateContinuityWithJev(params: {
  storyTitle: string
  previousExcerpt: string
  nextExcerpt: string
}): Promise<boolean> {
  const apiKey = await loadTypeSafeKey()
  if (!apiKey) return false

  const prev = params.previousExcerpt.trim().slice(-400)
  const next = params.nextExcerpt.trim().slice(0, 400)
  const payload = JSON.stringify({
    state: `Story: "${params.storyTitle}"\nPrevious page ending:\n"${prev}"\nNext page beginning / target:\n"${next}"`,
    model: 'jev-latest',
    questions: {
      is_continuation: {
        type: 'noul',
        instructions: 'Does the next excerpt logically continue or belong to the same sequential story as the previous excerpt?'
      }
    }
  })

  console.log(`[TypeSafe Jev] Kiểm tra tính liên tục của mạch truyện: "${params.storyTitle}"`)

  return new Promise<boolean>((resolve) => {
    try {
      const req = httpsRequest(
        'https://api.typesafe.ai/v1/systemone',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 8000
        },
        (res) => {
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () => {
            try {
              if (res.statusCode === 200) {
                const data = JSON.parse(body)
                const ans = data?.answers?.is_continuation
                if (ans && typeof ans.value === 'boolean') {
                  console.log(`[TypeSafe Jev] Kết quả liên tục: ${ans.value ? 'ĐÚNG (tiếp diễn mạch truyện)' : 'SAI (truyện khác)'}`)
                  return resolve(ans.value)
                }
              }
            } catch {}
            resolve(false)
          })
        }
      )

      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
      req.write(payload)
      req.end()
    } catch {
      resolve(false)
    }
  })
}

/**
 * Thẩm định xem bài viết đã kết thúc trọn vẹn chưa khi không còn link Next
 * để tránh việc gắn cờ partial/missing-next-link oan cho những bài đã hết tự nhiên.
 */
export async function arbitrateStoryConclusionWithJev(params: {
  storyTitle: string
  contentEnding: string
}): Promise<boolean> {
  const apiKey = await loadTypeSafeKey()
  if (!apiKey) return false

  const ending = params.contentEnding.trim().slice(-500)
  const payload = JSON.stringify({
    state: `Story: "${params.storyTitle}"\nStory ending passage:\n"${ending}"`,
    model: 'jev-latest',
    questions: {
      is_concluded: {
        type: 'noul',
        instructions: 'Does this passage represent a natural story conclusion or resolution, rather than an abrupt cutoff mid-scene?'
      }
    }
  })

  console.log(`[TypeSafe Jev] Thẩm định kết thúc truyện: "${params.storyTitle}"`)

  return new Promise<boolean>((resolve) => {
    try {
      const req = httpsRequest(
        'https://api.typesafe.ai/v1/systemone',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 8000
        },
        (res) => {
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () => {
            try {
              if (res.statusCode === 200) {
                const data = JSON.parse(body)
                const ans = data?.answers?.is_concluded
                if (ans && typeof ans.value === 'boolean') {
                  console.log(`[TypeSafe Jev] Kết quả kết thúc: ${ans.value ? 'Truyện đã kết thúc trọn vẹn' : 'Truyện chưa hết'}`)
                  return resolve(ans.value)
                }
              }
            } catch {}
            resolve(false)
          })
        }
      )

      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
      req.write(payload)
      req.end()
    } catch {
      resolve(false)
    }
  })
}
