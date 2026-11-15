// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

it('allows backing-track Blob URLs in the renderer media policy', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  const mediaSources = /media-src ([^;]+);/.exec(html)?.[1].split(/\s+/)
  expect(mediaSources).toContain('blob:')
})
