import { useContext, useEffect, useState } from 'react'
import { Archive, Download, ListTree } from 'lucide-react'
import type {
  OnlinePackDetails,
  OnlinePackFile,
  OnlinePackListing,
} from '@studio/shared'
import { Button } from '@/components/ui/button'
import { PackPreview } from '@/components/PackPreview'
import { OnlinePackActivity } from '@/components/OnlinePackActivity'
import { OnlinePackInfo } from '@/components/OnlinePackInfo'
import { OnlinePackArchiveDialog } from '@/components/OnlinePackArchiveDialog'
import { OnlinePackDescription } from '@/components/OnlinePackDescription'
import { OnlinePackSpinner } from '@/components/OnlinePackSpinner'
import { PackFavouriteButton } from '@/components/PackFavouriteButton'
import {
  OnlinePackDate,
  OnlinePackRichText,
} from '@/components/OnlinePackRichText'
import { OnlinePackDownloadsContext } from '@/hooks/useOnlinePackDownload'
import { formatBytes } from '@/lib/utils'

export function BrowsePackDetails({
  packId,
  isFavourite,
  onToggleFavourite,
}: {
  packId: number
  isFavourite: boolean
  onToggleFavourite: (pack: OnlinePackListing) => void
}) {
  const [pack, setPack] = useState<OnlinePackDetails | null>()
  const [attempt, setAttempt] = useState(0)
  const [activeImage, setActiveImage] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [archiveFile, setArchiveFile] = useState<OnlinePackFile>()
  const downloads = useContext(OnlinePackDownloadsContext)

  useEffect(() => {
    let ignore = false
    window.studio.getOnlinePack(packId).then(
      (result) => {
        if (!ignore) setPack(result)
      },
      () => {
        if (!ignore) setPack(null)
      },
    )
    return () => {
      ignore = true
    }
  }, [packId, attempt])

  if (pack === undefined)
    return (
      <OnlinePackSpinner
        label="Loading pack details"
        className="min-h-[50dvh]"
      />
    )
  if (pack === null)
    return (
      <div className="p-6 text-center">
        <p role="alert" className="mb-4">
          This GameBanana listing couldn’t be loaded.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              setPack(undefined)
              setAttempt((value) => value + 1)
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    )

  const showListingContent =
    !pack.withholdNotice &&
    (!pack.hasContentNotice || (pack.visibility === 'warn' && revealed))
  const currentImage = pack.images[activeImage]
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold break-words sm:text-4xl">
            {pack.title}
          </h1>
          {pack.submitter && (
            <p className="mt-2 text-sm text-muted-foreground">
              By {pack.submitter}
            </p>
          )}
          {showListingContent && pack.summary && (
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              {pack.summary}
            </p>
          )}
        </div>
        <PackFavouriteButton
          title={pack.title}
          saved={isFavourite}
          onToggle={() =>
            onToggleFavourite({
              ...pack,
              thumbnailUrl: pack.hasContentNotice
                ? undefined
                : pack.images[0]?.url,
            })
          }
        />
      </div>
      {(pack.hasContentNotice || pack.obsolete) && (
        <div className="mt-4 space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
          {pack.obsolete && <p>GameBanana marks this listing as obsolete.</p>}
          {pack.hasContentNotice && (
            <p>
              {pack.ratings.length
                ? `Content notice · ${pack.ratings.join(', ')}`
                : 'This listing has a content notice.'}
            </p>
          )}
          {pack.hasContentNotice && pack.visibility === 'warn' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRevealed(!revealed)}
            >
              {revealed ? 'Hide listing content' : 'Show listing content'}
            </Button>
          )}
          {pack.hasContentNotice && pack.visibility !== 'warn' && (
            <p>The source has restricted this listing’s content.</p>
          )}
        </div>
      )}
      {pack.withholdNotice && (
        <section className="mt-4 space-y-3 rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">Withhold notice</h2>
          <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            <span>GameBanana has restricted this listing.</span>
            {pack.withholdNotice.type && (
              <span className="capitalize">{pack.withholdNotice.type}</span>
            )}
            {pack.withholdNotice.date && (
              <OnlinePackDate timestamp={pack.withholdNotice.date} />
            )}
          </p>
          {pack.withholdNotice.rules.map((rule, index) => (
            <div key={index} className="border-t border-border pt-3">
              {rule.code && (
                <h3 className="text-sm font-medium">{rule.code}</h3>
              )}
              {rule.descriptionHtml && (
                <OnlinePackRichText html={rule.descriptionHtml} />
              )}
              {rule.fixHtml && <OnlinePackRichText html={rule.fixHtml} />}
            </div>
          ))}
        </section>
      )}
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <div className="min-w-0 space-y-5">
          {showListingContent && currentImage && (
            <section aria-label="Pack screenshots">
              <div className="overflow-hidden rounded-xl border border-border">
                <PackPreview
                  src={currentImage.url}
                  alt={
                    currentImage.caption ||
                    `Screenshot ${activeImage + 1} from ${pack.title}`
                  }
                  fit="contain"
                  eager
                />
              </div>
              {currentImage.caption && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {currentImage.caption}
                </p>
              )}
              {pack.images.length > 1 && (
                <div className="mt-2 flex gap-2 overflow-x-auto p-1">
                  {pack.images.map(({ url }, index) => (
                    <button
                      key={`${url}-${index}`}
                      type="button"
                      aria-label={`Show screenshot ${index + 1}`}
                      aria-pressed={activeImage === index}
                      onClick={() => setActiveImage(index)}
                      className="w-20 shrink-0 overflow-hidden rounded-md border border-border focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-primary"
                    >
                      <PackPreview src={url} />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          {showListingContent && pack.descriptionHtml && (
            <OnlinePackDescription html={pack.descriptionHtml} />
          )}
          {showListingContent && <OnlinePackActivity pack={pack} />}
        </div>
        <div className="min-w-0 space-y-5">
          <section
            aria-labelledby="pack-downloads"
            className={`p-5${pack.files.length > 0 ? ' rounded-xl border border-border bg-card' : ''}`}
          >
            <h2 id="pack-downloads" className="text-lg font-semibold">
              Downloads
            </h2>
            {pack.files.length === 0 ? (
              <p className="mt-3 text-center text-sm text-muted-foreground">
                {pack.withholdNotice
                  ? 'Files are unavailable while this listing is withheld.'
                  : 'This listing has no files.'}
              </p>
            ) : (
              <>
                <ul className="mt-4 space-y-3">
                  {pack.files.map((file) => {
                    const canImport = /\.zip$/i.test(file.name)
                    const active = downloads?.downloads.some(
                      (entry) => entry.fileId === file.id && entry.status === 'working',
                    )
                    return (
                      <li
                        key={file.id}
                        className="rounded-none border border-dashed border-border p-3"
                      >
                        <div className="flex items-start gap-2">
                          <Archive
                            aria-hidden="true"
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium break-all">
                              {file.name}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatBytes(file.size)}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                              {file.added && (
                                <OnlinePackDate timestamp={file.added} />
                              )}
                              {file.downloads !== undefined && (
                                <span>
                                  {file.downloads.toLocaleString()} downloads
                                </span>
                              )}
                              {file.scanResult && (
                                <span className="capitalize">
                                  {file.scanResult}
                                </span>
                              )}
                              {file.archived && <span>Archived</span>}
                            </div>
                          </div>
                        </div>
                        {showListingContent && file.descriptionHtml && (
                          <div className="mt-2">
                            <OnlinePackRichText html={file.descriptionHtml} />
                          </div>
                        )}
                        {file.canDownload ? (
                          <div className="mt-3 flex flex-col flex-wrap gap-2">
                            {canImport && (
                              <Button
                                size="sm"
                                aria-label={`Download to app: ${file.name}`}
                                disabled={active}
                                onClick={() => void downloads?.start(packId, file, 'app')}
                              >
                                <Download aria-hidden="true" />
                                Download
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant={canImport ? 'outline' : 'default'}
                              aria-label={`Save to device: ${file.name}`}
                              disabled={active}
                              onClick={() => void downloads?.start(packId, file, 'device')}
                            >
                              Download to device
                            </Button>
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Direct download unavailable
                          </p>
                        )}
                        {showListingContent && file.hasContents && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-2 w-full"
                            aria-label={`View file contents: ${file.name}`}
                            onClick={() => setArchiveFile(file)}
                          >
                            <ListTree aria-hidden="true" /> File contents
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </section>
          <OnlinePackInfo pack={pack} showMirrors={showListingContent} />
        </div>
      </div>
      {archiveFile && (
        <OnlinePackArchiveDialog
          packId={pack.id}
          file={archiveFile}
          onClose={() => setArchiveFile(undefined)}
        />
      )}
    </>
  )
}
