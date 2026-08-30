import type { JSX } from 'react'
import { useState } from 'react'

const POLYFORM_NC_SUMMARY = `PolyForm Noncommercial License 1.0.0

Copyright (c) 2026 NeeyuBL
Required Notice: Copyright NeeyuBL (https://github.com/NeeyuBL/neeyut-blao)

• Được phép: dùng / sửa / chia sẻ cho mục đích PHI THƯƠNG MẠI
  (cá nhân, học tập, nghiên cứu, tổ chức phi lợi nhuận theo định nghĩa license).
• Bắt buộc: giữ LICENSE (hoặc URL) và dòng Required Notice khi phân phối lại.
• Không được: dùng thương mại (bán, SaaS, tích hợp sản phẩm thương mại…)
  trừ khi có thỏa thuận riêng với NeeyuBL.

Toàn văn: https://polyformproject.org/licenses/noncommercial/1.0.0
File trong repo: LICENSE · NOTICE`

// MIT bat buoc giu nguyen thong bao ban quyen cua tac gia goc
const DOUYIN_MIT = `MIT License

Copyright (c) 2026 jiji262

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

interface ThirdParty {
  group: string
  name: string
  license: string
  link: string | null
  copyright?: string
  notice?: string
}

// Giay phep lay tu sieu du lieu goi / the model, KHONG suy doan.
// Xem ban day du o THIRD-PARTY-NOTICES.txt trong kho ma nguon.
const G_TOOL = 'Công cụ tải về khi cần'
const G_LIB = 'Thư viện xử lý âm thanh'
const G_MODEL = 'Model AI'
const G_GPU = 'Tăng tốc GPU (chỉ máy NVIDIA)'

const THIRD_PARTY: ThirdParty[] = [
  {
    group: G_TOOL,
    name: 'ffmpeg',
    license: 'LGPL / GPL',
    link: 'https://ffmpeg.org/legal.html'
  },
  {
    group: G_TOOL,
    name: 'Bộ tải xuống mã nguồn mở',
    license: 'Unlicense (phạm vi công cộng)',
    link: null
  },
  {
    group: G_TOOL,
    name: 'Bộ tải Douyin',
    license: 'MIT',
    link: null,
    copyright: 'Copyright (c) 2026 jiji262',
    notice: DOUYIN_MIT
  },
  {
    group: G_TOOL,
    name: 'Video2X',
    license: 'AGPL-3.0',
    link: 'https://github.com/k4yt3x/video2x',
    copyright: 'Copyright (C) K4YT3X and contributors'
  },

  {
    group: G_LIB,
    name: 'Faster-Whisper',
    license: 'MIT',
    link: 'https://github.com/SYSTRAN/faster-whisper',
    copyright: 'SYSTRAN & Guillaume Klein'
  },
  {
    group: G_LIB,
    name: 'CTranslate2',
    license: 'MIT',
    link: 'https://github.com/OpenNMT/CTranslate2',
    copyright: 'OpenNMT contributors'
  },
  {
    group: G_LIB,
    name: 'ONNX Runtime',
    license: 'MIT',
    link: 'https://github.com/microsoft/onnxruntime',
    copyright: 'Microsoft Corporation'
  },

  {
    group: G_MODEL,
    name: 'OpenAI Whisper Models',
    license: 'MIT',
    link: 'https://github.com/openai/whisper',
    copyright: 'OpenAI'
  },
  {
    group: G_GPU,
    name: 'NVIDIA cuBLAS & cuDNN',
    license: 'NVIDIA CUDA EULA / cuDNN SLA',
    link: 'https://docs.nvidia.com/cuda/eula/',
    copyright: 'NVIDIA Corporation'
  }
]

const GROUPS = [G_TOOL, G_LIB, G_MODEL, G_GPU]

/** 1 o giay phep dang accordion: bam vao tieu de moi so ra noi dung. */
function LicCard({
  title,
  badge,
  badgeTone = 'default',
  defaultOpen = false,
  children
}: {
  title: string
  badge?: string
  badgeTone?: 'default' | 'accent'
  defaultOpen?: boolean
  children: React.ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`lic-card ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="lic-card-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="lic-card-title">{title}</span>
        {badge && <span className={`lic-badge ${badgeTone}`}>{badge}</span>}
        <span className="lic-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="lic-card-body">{children}</div>}
    </div>
  )
}

export default function License(): JSX.Element {
  return (
    <div className="lic-view">
      <div className="lic-intro">
        <h2 className="lic-head">Giấy phép & Bản quyền</h2>
        <p className="lic-lead">
          T-blao sử dụng giấy phép nguồn mở phi thương mại cho mã nguồn chính, kết hợp với các công
          cụ mã nguồn mở được phát hành theo các giấy phép tương ứng.
        </p>
      </div>

      <LicCard
        title="T-blao — Mã nguồn chính"
        badge="PolyForm Noncommercial 1.0.0"
        badgeTone="accent"
        defaultOpen={true}
      >
        <pre className="lic-pre">{POLYFORM_NC_SUMMARY}</pre>
        <div className="lic-links">
          <button
            type="button"
            className="lic-link-btn"
            onClick={() =>
              (window.api || (window as any).tblao).openExternal('https://polyformproject.org/licenses/noncommercial/1.0.0')
            }
          >
            Đọc toàn văn giấy phép PolyForm Noncommercial ↗
          </button>
          <button
            type="button"
            className="lic-link-btn"
            onClick={() => (window.api || (window as any).tblao).openExternal('https://github.com/NeeyuBL/neeyut-blao')}
          >
            Mã nguồn trên GitHub ↗
          </button>
        </div>
      </LicCard>

      <LicCard title="Thành phần & Công cụ của bên thứ ba" defaultOpen={false}>
        <p className="lic-sublead">
          Các công cụ và model AI dưới đây được tải về máy theo nhu cầu khi sử dụng tính năng tương
          ứng. Chúng tôi giữ nguyên toàn bộ thông báo bản quyền và giấy phép của tác giả gốc.
        </p>

        {GROUPS.map((g) => {
          const list = THIRD_PARTY.filter((t) => t.group === g)
          if (list.length === 0) return null
          return (
            <div key={g} className="lic-group">
              <div className="lic-group-title">{g}</div>
              <div className="lic-grid">
                {list.map((t) => (
                  <div key={t.name} className="lic-item">
                    <div className="lic-item-head">
                      <span className="lic-item-name">{t.name}</span>
                      <span className="lic-item-lic">{t.license}</span>
                    </div>
                    {t.copyright && <div className="lic-item-cr">{t.copyright}</div>}
                    {t.link && (
                      <button
                        type="button"
                        className="lic-item-link"
                        onClick={() => (window.api || (window as any).tblao).openExternal(t.link!)}
                      >
                        Trang chủ / Giấy phép ↗
                      </button>
                    )}
                    {t.notice && <pre className="lic-notice-pre">{t.notice}</pre>}
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        <div className="lic-footer-note">
          Chi tiết đầy đủ xem tệp <code>THIRD-PARTY-NOTICES.txt</code> trong thư mục cài đặt ứng
          dụng.
        </div>
      </LicCard>
    </div>
  )
}
