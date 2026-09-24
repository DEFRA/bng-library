import { describe, expect, it } from 'vitest'
import {
  PUBLISHED_METRIC_TEMPLATE,
  downloadPublishedTemplate,
  isPublishedTemplate
} from '../src/workbook-writer/published-template.mjs'

const fakeFetch =
  (body, { ok = true, status = 200 } = {}) =>
  async () => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    arrayBuffer: async () => Buffer.from(body)
  })

describe('the published metric template', () => {
  it('is pinned to a GOV.UK asset by version and checksum', () => {
    expect(PUBLISHED_METRIC_TEMPLATE.url).toMatch(
      /^https:\/\/assets\.publishing\.service\.gov\.uk\/.+\.xlsx$/
    )
    expect(PUBLISHED_METRIC_TEMPLATE.url).toContain(
      PUBLISHED_METRIC_TEMPLATE.fileName
    )
    expect(PUBLISHED_METRIC_TEMPLATE.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a download that is not the pinned release', async () => {
    await expect(
      downloadPublishedTemplate({ fetch: fakeFetch('not the workbook') })
    ).rejects.toThrow(/checksum mismatch/)
    expect(isPublishedTemplate(Buffer.from('not the workbook'))).toBe(false)
  })

  it('reports a failed download', async () => {
    await expect(
      downloadPublishedTemplate({
        fetch: fakeFetch('', { ok: false, status: 404 })
      })
    ).rejects.toThrow(/404/)
  })
})
