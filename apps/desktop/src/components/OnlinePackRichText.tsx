import { createElement, useMemo, type ReactNode } from 'react'
import { reportError } from '@/lib/error-toast'
import { blockedOnlinePackTags } from '@/lib/online-pack-excerpt'
import { listingLink } from '@/lib/online-pack-links'

const textTags = new Set([
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h2',
  'h3',
  'h4',
  'h5',
  'hr',
  'i',
  'kbd',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
])
export function OnlinePackLink({
  url,
  children,
}: {
  url: URL
  children: ReactNode
}) {
  return (
    <a
      href={url.href}
      className="text-primary underline underline-offset-2"
      onClick={(event) => {
        event.preventDefault()
        void window.studio.openOnlinePackLink(url.href).catch(reportError)
      }}
    >
      {children}
    </a>
  )
}

function listingNodes(parent: ParentNode): ReactNode[] {
  return Array.from(parent.childNodes, (node, key) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent
    if (!(node instanceof Element)) return null
    const tag = node.localName
    if (blockedOnlinePackTags.has(tag)) return null
    if (tag === 'img') {
      const url = listingLink(node.getAttribute('src') ?? '')
      if (url?.origin !== 'https://images.gamebanana.com')
        return node.getAttribute('alt')
      return (
        <img
          key={key}
          src={url.href}
          alt={node.getAttribute('alt') ?? ''}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )
    }
    if (tag === 'iframe' || tag === 'video' || tag === 'audio') {
      const url = listingLink(node.getAttribute('src') ?? '')
      return url ? (
        <OnlinePackLink key={key} url={url}>
          Open embedded media
        </OnlinePackLink>
      ) : null
    }

    const children = listingNodes(node)
    if (tag === 'a') {
      const url = listingLink(node.getAttribute('href') ?? '')
      return url ? (
        <OnlinePackLink key={key} url={url}>
          {children.length ? children : url.hostname}
        </OnlinePackLink>
      ) : (
        <span key={key}>{children}</span>
      )
    }
    if (tag === 'br' || tag === 'hr') return createElement(tag, { key })
    return createElement(textTags.has(tag) ? tag : 'span', { key }, children)
  })
}

export function OnlinePackRichText({ html }: { html: string }) {
  const content = useMemo(() => {
    const template = document.createElement('template')
    template.innerHTML = html
    return listingNodes(template.content)
  }, [html])
  return (
    <div className="online-pack-rich-text text-sm leading-6 break-words text-muted-foreground">
      {content}
    </div>
  )
}

export function OnlinePackDate({ timestamp }: { timestamp: number }) {
  const date = new Date(timestamp * 1000)
  if (!Number.isFinite(date.getTime())) return null
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleDateString(undefined, { dateStyle: 'medium' })}
    </time>
  )
}
