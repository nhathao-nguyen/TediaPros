import { isAbsolute, normalize, relative, dirname } from 'node:path'
import { lstat, stat, realpath } from 'node:fs/promises'

/**
 * Validate that a file exists, is a regular file (not directory or symlink/reparse point),
 * and is strictly contained within root directory without escaping.
 */
export async function assertContainedRegularFile(
  candidate: string,
  root: string,
  label: string
): Promise<string> {
  if (!isAbsolute(candidate) || !isAbsolute(root)) {
    throw new Error(`${label}: đường dẫn phải là tuyệt đối (candidate=${candidate}, root=${root}).`)
  }

  let rootReal: string
  try {
    rootReal = await realpath(root)
  } catch (err) {
    throw new Error(`${label}: thư mục gốc không tồn tại hoặc không hợp lệ: ${(err as Error).message}`)
  }

  let candLstat
  try {
    candLstat = await lstat(candidate)
  } catch (err) {
    throw new Error(`${label}: file không tồn tại: ${(err as Error).message}`)
  }

  if (candLstat.isSymbolicLink()) {
    throw new Error(`${label}: không chấp nhận symbolic link hoặc reparse point.`)
  }

  let candStat
  try {
    candStat = await stat(candidate)
  } catch (err) {
    throw new Error(`${label}: không thể kiểm tra stat file: ${(err as Error).message}`)
  }

  if (!candStat.isFile()) {
    throw new Error(`${label}: đường dẫn không phải là file thông thường (regular file).`)
  }

  let candReal: string
  try {
    candReal = await realpath(candidate)
  } catch (err) {
    throw new Error(`${label}: không thể resolve realpath: ${(err as Error).message}`)
  }

  const rel = relative(rootReal, candReal)
  if (!rel || rel === '..' || rel.startsWith('..' + '/') || rel.startsWith('..' + '\\') || isAbsolute(rel)) {
    throw new Error(`${label}: file nằm ngoài thư mục gốc cho phép (${rootReal}).`)
  }

  return normalize(candReal)
}

/**
 * Validate that a candidate target path's existing ancestor directory does not escape root
 * and contains no symlinks.
 */
export async function assertContainedParentDirectory(
  candidate: string,
  root: string,
  label: string
): Promise<string> {
  if (!isAbsolute(candidate) || !isAbsolute(root)) {
    throw new Error(`${label}: đường dẫn phải là tuyệt đối.`)
  }
  let rootReal: string
  try {
    rootReal = await realpath(root)
  } catch (err) {
    throw new Error(`${label}: thư mục gốc không tồn tại: ${(err as Error).message}`)
  }

  let parent = dirname(candidate)
  let parentReal: string | null = null
  while (parent) {
    try {
      const st = await lstat(parent)
      if (st.isSymbolicLink()) {
        throw new Error(`${label}: phát hiện symbolic link trong cây thư mục: ${parent}`)
      }
      parentReal = await realpath(parent)
      break
    } catch {
      const next = dirname(parent)
      if (next === parent) break
      parent = next
    }
  }

  if (!parentReal) {
    throw new Error(`${label}: không tìm thấy thư mục cha hợp lệ.`)
  }

  const rel = relative(rootReal, parentReal)
  if (rel === '..' || rel.startsWith('..' + '/') || rel.startsWith('..' + '\\') || isAbsolute(rel)) {
    throw new Error(`${label}: thư mục cha nằm ngoài thư mục gốc cho phép.`)
  }

  return rootReal
}
