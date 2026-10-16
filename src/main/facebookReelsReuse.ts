import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, constants } from 'node:fs'
import { copyFile, lstat, rm } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'

async function hash(file: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}

/** Reuse known bytes without downloading again; keep MP4 exports and original files intact. */
export async function reuseReelMp4(source: string, sourceRoot: string, targetRoot: string, stem: string,
  signal: AbortSignal, convert: (input: string, output: string, signal: AbortSignal) => Promise<void>): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(stem)) throw Error('Tên file Reels không hợp lệ.')
  if (signal.aborted) throw Error('Đã hủy tái sử dụng video.')
  const input = await assertContainedRegularFile(source, sourceRoot, 'Video Reels đã tải')
  const target = join(targetRoot, stem + '.mp4')
  await assertContainedParentDirectory(target, targetRoot, 'Video Reels tái sử dụng')
  if (target === input && extname(input).toLowerCase() === '.mp4') return input
  const temp = join(targetRoot, `.${stem}.${randomUUID()}.mp4`)
  await assertContainedParentDirectory(temp, targetRoot, 'Chuyển video Reels')
  let copySource = input
  try {
    if (extname(input).toLowerCase() !== '.mp4') {
      await convert(input, temp, signal)
      copySource = await assertContainedRegularFile(temp, targetRoot, 'Video Reels MP4')
    }
    if (signal.aborted) throw Error('Đã hủy tái sử dụng video.')
    if (!(await lstat(copySource)).size) throw Error('Video Reels rỗng.')
    try { await copyFile(copySource, target, constants.COPYFILE_EXCL) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const safeTarget = await assertContainedRegularFile(target, targetRoot, 'Video Reels có sẵn')
      if (await hash(safeTarget) !== await hash(copySource)) throw Error('File đích đã có nội dung khác; hãy chọn thư mục xuất khác.')
    }
    return assertContainedRegularFile(target, targetRoot, 'Video Reels tái sử dụng')
  } finally { await rm(temp, { force: true }) }
}
