export function listingLink(href: string): URL | null {
  const text = href.trim()
  if (!text || text.startsWith('#')) return null
  const url = URL.parse(text, 'https://gamebanana.com')
  if (
    !url ||
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href.length > 2048
  )
    return null
  return url
}
