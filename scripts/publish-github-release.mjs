import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const owner = 'nhathao-nguyen'
const repo = 'TediaPros'
const tag = 'runtime-v1'

const tokenArgIdx = process.argv.indexOf('--token')
const token = (tokenArgIdx >= 0 ? process.argv[tokenArgIdx + 1] : null) || process.env.GITHUB_TOKEN || process.env.GH_TOKEN

if (!token) {
  console.log(`
========================================================================
HƯỚNG DẪN TẠO RELEASE TRÊN GITHUB CHO REPO ${owner}/${repo}:
========================================================================

Cách 1: Chạy tự động qua script (Cần GitHub Token):
  node scripts/publish-github-release.mjs --token <github_personal_access_token>

Cách 2: Upload trực tiếp trên giao diện GitHub Web (1 phút):
  1. Mở trình duyệt vào trang:
     https://github.com/${owner}/${repo}/releases/new
  2. Điền:
     - Tag name: runtime-v1
     - Release title: Runtime Bundles v1
  3. Kéo thả 2 tệp trong thư mục:
     • D:\\nhathao\\codex\\tool\\neeyut-blao\\release-artifacts\\runtime-manifest.json
     • D:\\nhathao\\codex\\tool\\neeyut-blao\\release-artifacts\\whisper-cpp-win32-x64.zip
  4. Bấm "Publish release".
========================================================================
`)
  process.exit(0)
}

async function uploadAsset(uploadUrlTemplate, filePath, fileName, token) {
  const uploadUrl = uploadUrlTemplate.replace(/\{(\?.*)?\}$/, '') + `?name=${encodeURIComponent(fileName)}`
  const fileStat = await stat(filePath)
  const fileBuffer = await readFile(filePath)

  console.log(`[Upload] Đang tải lên ${fileName} (${(fileStat.size / (1024 * 1024)).toFixed(2)} MB)...`)
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': fileName.endsWith('.json') ? 'application/json' : 'application/zip',
      'Content-Length': String(fileStat.size)
    },
    body: fileBuffer
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Upload ${fileName} thất bại (${res.status}): ${txt}`)
  }

  const asset = await res.json()
  console.log(`✓ Upload thành công ${fileName} -> ${asset.browser_download_url}`)
}

async function main() {
  console.log(`[Release] Đang kết nối GitHub API để tạo Release "${tag}" cho ${owner}/${repo}...`)

  // 1. Kiểm tra release đã tồn tại chưa
  let release = null
  const checkRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json'
    }
  })

  if (checkRes.ok) {
    release = await checkRes.json()
    console.log(`[Release] Release "${tag}" đã tồn tại (ID: ${release.id}).`)
  } else {
    // Tạo mới release
    const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: 'main',
        name: 'Runtime Bundles v1 (Whisper.cpp & Core Engines)',
        body: 'Official lazy-install runtime bundles and manifest for TediaPros on Windows/macOS/Linux.',
        draft: false,
        prerelease: false
      })
    })

    if (!createRes.ok) {
      const errText = await createRes.text()
      throw new Error(`Tạo release thất bại (${createRes.status}): ${errText}`)
    }

    release = await createRes.json()
    console.log(`[Release] Đã tạo thành công Release "${tag}" (ID: ${release.id})!`)
  }

  const artifactsDir = resolve('release-artifacts')
  const files = [
    { name: 'runtime-manifest.json', path: join(artifactsDir, 'runtime-manifest.json') },
    { name: 'whisper-cpp-win32-x64.zip', path: join(artifactsDir, 'whisper-cpp-win32-x64.zip') }
  ]

  for (const f of files) {
    // Xóa asset cũ nếu đã có trùng tên
    if (Array.isArray(release.assets)) {
      const existing = release.assets.find((a) => a.name === f.name)
      if (existing) {
        console.log(`[Release] Xóa asset cũ ${f.name} (ID: ${existing.id})...`)
        await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${existing.id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json'
          }
        })
      }
    }
    await uploadAsset(release.upload_url, f.path, f.name, token)
  }

  console.log('\n======================================================')
  console.log(`✓ HOÀN TẤT PHÁT HÀNH RELEASE: ${release.html_url}`)
  console.log('Từ bây giờ bất kỳ máy mới nào clone repo hoặc cài app đều có thể tải tự động khi bấm nút [Cài đặt]!')
  console.log('======================================================')
}

main().catch((err) => {
  console.error('[Release] Lỗi:', err)
  process.exit(1)
})
