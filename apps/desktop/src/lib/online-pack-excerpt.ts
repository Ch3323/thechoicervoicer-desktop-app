export const blockedOnlinePackTags = new Set([
  'script',
  'style',
  'object',
  'svg',
  'math',
  'form',
  'template',
])

const previewLength = 650
const previewLineBreakCost = 80
const lineBreakTags = new Set([
  'blockquote',
  'br',
  'div',
  'h2',
  'h3',
  'h4',
  'h5',
  'hr',
  'li',
  'p',
  'pre',
  'tr',
])

export function getOnlinePackExcerpt(html: string): string | undefined {
  const template = document.createElement('template')
  template.innerHTML = html
  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    (node) => {
      if (node instanceof Element && blockedOnlinePackTags.has(node.localName))
        return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  )
  let remaining = previewLength
  let lastText: Text | undefined
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Element && lineBreakTags.has(node.localName))
      remaining -= previewLineBreakCost
    if (!(node instanceof Text) || !node.data.trim()) continue

    if (node.length > remaining) {
      const remainder = document.createRange()
      if (remaining <= 0 && lastText) {
        remainder.setStart(lastText, lastText.length)
      } else {
        const prefix = node.data.slice(0, Math.max(0, remaining))
        const wordBreak = prefix.search(/\s+\S*$/)
        lastText = node
        remainder.setStart(node, wordBreak > 0 ? wordBreak : prefix.length)
      }
      remainder.setEnd(template.content, template.content.childNodes.length)
      remainder.deleteContents()
      lastText.data = `${lastText.data.trimEnd()}…`
      return template.innerHTML
    }
    remaining -= node.length
    lastText = node
  }
  return undefined
}
