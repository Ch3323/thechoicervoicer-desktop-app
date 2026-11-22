import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { OnlinePackRichText } from '@/components/OnlinePackRichText'
import { getOnlinePackExcerpt } from '@/lib/online-pack-excerpt'

export function OnlinePackDescription({ html }: { html: string }) {
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const excerpt = useMemo(() => getOnlinePackExcerpt(html), [html])

  return (
    <section
      aria-label="Pack description"
      className="rounded-xl border border-border bg-card p-5"
    >
      <h2 className="font-semibold">About this pack</h2>
      <div id={id} className="mt-3">
        <OnlinePackRichText html={expanded ? html : (excerpt ?? html)} />
      </div>
      {excerpt !== undefined && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Read less' : 'Read more'}
        </Button>
      )}
    </section>
  )
}
