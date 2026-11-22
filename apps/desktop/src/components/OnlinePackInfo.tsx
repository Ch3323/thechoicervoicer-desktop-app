import type { OnlinePackDetails } from '@studio/shared'
import {
  OnlinePackDate,
  OnlinePackLink,
  OnlinePackRichText,
} from '@/components/OnlinePackRichText'
import { listingLink } from '@/lib/online-pack-links'

export function OnlinePackInfo({
  pack,
  showMirrors,
}: {
  pack: OnlinePackDetails
  showMirrors: boolean
}) {
  const metadata = [
    ['Game', pack.game],
    ['Category', pack.category],
    ['Version', pack.version],
    [
      'Submitted',
      pack.added ? <OnlinePackDate timestamp={pack.added} /> : undefined,
    ],
    [
      'Updated',
      pack.updated ? <OnlinePackDate timestamp={pack.updated} /> : undefined,
    ],
    ['Views', pack.counts.views?.toLocaleString()],
    ['Downloads', pack.counts.downloads?.toLocaleString()],
    ['Likes', pack.counts.likes?.toLocaleString()],
    ['Subscribers', pack.counts.subscribers?.toLocaleString()],
  ] as const
  const mirrors = showMirrors
    ? pack.mirrors.map(listingLink).filter((url) => url !== null)
    : []
  return (
    <>
      {mirrors.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">Alternate file sources</h2>
          <ul className="mt-3 space-y-2 text-sm break-all">
            {mirrors.map((url, index) => (
              <li key={index}>
                <OnlinePackLink url={url}>
                  {url.hostname}
                  {url.pathname !== '/' ? url.pathname : ''}
                </OnlinePackLink>
              </li>
            ))}
          </ul>
        </section>
      )}
      {metadata.some(([, value]) => value !== undefined) && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">Listing details</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {metadata.map(([label, value]) =>
              value === undefined ? null : (
                <div
                  key={label}
                  className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-words">{value}</dd>
                </div>
              ),
            )}
          </dl>
          {pack.tags.length > 0 && (
            <ul aria-label="Tags" className="mt-4 flex flex-wrap gap-2">
              {pack.tags.map((tag, index) => (
                <li
                  key={index}
                  className="max-w-full rounded-md bg-secondary px-2 py-1 text-xs break-words"
                >
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {(pack.credits.length > 0 || pack.studios.length > 0) && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">Credits</h2>
          {pack.credits.map(({ group, authors }, index) => (
            <div key={index} className="mt-3 text-sm">
              {group && <h3 className="font-medium">{group}</h3>}
              <ul className="mt-1 space-y-1 text-muted-foreground">
                {authors.map(({ name, role }, authorIndex) => (
                  <li key={authorIndex} className="break-words">
                    {name}
                    {role && ` · ${role}`}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {pack.studios.length > 0 && (
            <div className="mt-3 text-sm">
              <h3 className="font-medium">Contributing studios</h3>
              <p className="mt-1 text-muted-foreground">
                {pack.studios.join(', ')}
              </p>
            </div>
          )}
        </section>
      )}
      {(pack.licenseHtml || pack.permissions.length > 0) && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">License</h2>
          {pack.licenseHtml && (
            <div className="mt-3">
              <OnlinePackRichText html={pack.licenseHtml} />
            </div>
          )}
          {pack.permissions.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer">Usage permissions</summary>
              {pack.permissions.map(({ label, terms }) => (
                <div key={label} className="mt-3">
                  <h3 className="font-medium">{label}</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                    {terms.map((term, index) => (
                      <li key={index}>{term}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </details>
          )}
        </section>
      )}
    </>
  )
}
