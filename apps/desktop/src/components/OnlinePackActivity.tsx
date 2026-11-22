import { useEffect, useState } from 'react'
import type {
  OnlinePackActivityKind,
  OnlinePackActivityPage,
  OnlinePackDetails,
} from '@studio/shared'
import { Button } from '@/components/ui/button'
import { OnlinePackSpinner } from '@/components/OnlinePackSpinner'
import {
  OnlinePackDate,
  OnlinePackRichText,
} from '@/components/OnlinePackRichText'

const sections: { kind: OnlinePackActivityKind; label: string }[] = [
  { kind: 'updates', label: 'Updates' },
  { kind: 'comments', label: 'Comments' },
  { kind: 'issues', label: 'Issues' },
  { kind: 'todos', label: 'To-dos' },
]

export function OnlinePackActivity({ pack }: { pack: OnlinePackDetails }) {
  const [section, setSection] = useState<OnlinePackActivityKind>(
    pack.counts.updates ? 'updates' : 'comments',
  )
  return (
    <section
      aria-label="Pack activity"
      className="rounded-xl border border-border bg-card p-5 has-[>[data-empty]]:border-0 has-[>[data-empty]]:bg-transparent"
    >
      <div
        role="group"
        aria-label="Activity sections"
        className="flex flex-wrap gap-2 border-b border-border pb-4"
      >
        {sections.map(({ kind, label }) => {
          const count = kind === 'issues' ? undefined : pack.counts[kind]
          return (
            <Button
              key={kind}
              size="sm"
              variant={section === kind ? 'default' : 'outline'}
              aria-pressed={section === kind}
              onClick={() => setSection(kind)}
            >
              {label}
              {count === undefined ? '' : ` (${count})`}
            </Button>
          )
        })}
      </div>
      <ActivityFeed key={section} packId={pack.id} kind={section} />
    </section>
  )
}

function ActivityFeed({
  packId,
  kind,
  parent,
}: {
  packId: number
  kind: OnlinePackActivityKind
  parent?: number
}) {
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<OnlinePackActivityPage | null>()

  useEffect(() => {
    let active = true
    window.studio.getOnlinePackActivity(packId, kind, page, parent).then(
      (next) => {
        if (active) setResult(next)
      },
      () => {
        if (active) setResult(null)
      },
    )
    return () => {
      active = false
    }
  }, [packId, kind, page, parent, attempt])

  return (
    <div
      className="mt-4"
      data-empty={result === null || result?.entries.length === 0 ? '' : undefined}
    >
      {result === undefined && (
        <OnlinePackSpinner label="Loading pack activity" />
      )}
      {result === null && (
        <div className="text-center">
          <p role="alert" className="text-sm">
            This section couldn’t be loaded.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => {
              setResult(undefined)
              setAttempt((value) => value + 1)
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {result && (
        <>
          {result.entries.length ? (
            <ul className="space-y-4">
              {result.entries.map((entry) => (
                <ActivityEntry
                  key={entry.id}
                  packId={packId}
                  entry={entry}
                  showReplies={kind === 'comments'}
                />
              ))}
            </ul>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              No {parent ? 'replies' : kind === 'todos' ? 'to-dos' : kind} to
              show.
            </p>
          )}
          {(page > 1 || result.hasNextPage) && (
            <div className="mt-4 flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 1}
                onClick={() => {
                  setResult(undefined)
                  setPage(page - 1)
                }}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {page}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={!result.hasNextPage}
                onClick={() => {
                  setResult(undefined)
                  setPage(page + 1)
                }}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ActivityEntry({
  packId,
  entry,
  showReplies,
}: {
  packId: number
  entry: OnlinePackActivityPage['entries'][number]
  showReplies: boolean
}) {
  const [repliesOpen, setRepliesOpen] = useState(false)
  return (
    <li className="rounded-lg border border-border p-4">
      {entry.title && <h3 className="font-semibold">{entry.title}</h3>}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {entry.author && <span>{entry.author}</span>}
        {entry.added && <OnlinePackDate timestamp={entry.added} />}
        {entry.version && <span>{entry.version}</span>}
        {entry.state && <span className="capitalize">{entry.state}</span>}
      </div>
      {entry.bodyHtml && (
        <div className="mt-2">
          <OnlinePackRichText html={entry.bodyHtml} />
        </div>
      )}
      {entry.changes.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {entry.changes.map(({ category, text }, index) => (
            <li key={index}>
              <strong className="text-foreground">{category}</strong> {text}
            </li>
          ))}
        </ul>
      )}
      {!!entry.files?.length && (
        <div className="mt-3 text-sm">
          <h4 className="font-medium">Files in this update</h4>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {entry.files.map((file, index) => (
              <li key={index} className="break-all">
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showReplies && Boolean(entry.replyCount) && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          aria-expanded={repliesOpen}
          onClick={() => setRepliesOpen(!repliesOpen)}
        >
          {repliesOpen ? 'Hide replies' : `Show replies (${entry.replyCount})`}
        </Button>
      )}
      {repliesOpen && (
        <ActivityFeed packId={packId} kind="comments" parent={entry.id} />
      )}
    </li>
  )
}
