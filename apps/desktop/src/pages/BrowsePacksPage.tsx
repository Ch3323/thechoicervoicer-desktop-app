import { useEffect, useRef, useState, type ComponentProps } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from 'lucide-react'
import {
  Link,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import {
  ONLINE_PACK_PAGE_SIZE,
  ONLINE_PACK_SEARCH_MAX_LENGTH,
  OnlinePackOrderSchema,
  OnlinePackSearchSchema,
  type OnlinePackCategory,
  type OnlinePackListing,
  type OnlinePackOrder,
  type OnlinePackPage,
} from '@studio/shared'
import { Button } from '@/components/ui/button'
import { BrowsePackDetails } from '@/pages/BrowsePackDetails'
import { PackPreview } from '@/components/PackPreview'
import { OnlinePackSpinner } from '@/components/OnlinePackSpinner'
import { PackFavouriteButton } from '@/components/PackFavouriteButton'
import { usePackFavourites } from '@/hooks/usePackFavourites'

function positiveInteger(value: string | null): number | undefined {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

const orderLabels: Record<OnlinePackOrder, string> = {
  oldest: 'Oldest',
  updated: 'Recently updated',
  'title-asc': 'Title A–Z',
  'title-desc': 'Title Z–A',
  'most-liked': 'Most liked',
  'most-downloaded': 'Most downloaded',
}
const favouriteOrders = ['title-asc', 'title-desc'] as const
const titleCollator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
})

function CatalogSelect({
  label,
  ...props
}: Pick<ComponentProps<'select'>, 'value' | 'onChange' | 'children'> & {
  label: string
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-muted-foreground">
      {label}
      <span className="relative">
        <select
          {...props}
          className="h-9 cursor-pointer appearance-none rounded-lg border border-border bg-card pr-9 pl-3 text-foreground focus-visible:outline-2 focus-visible:outline-ring forced-colors:appearance-auto forced-colors:pr-3"
        />
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 forced-colors:hidden"
        />
      </span>
    </label>
  )
}

export function BrowsePacksPage() {
  const { packId } = useParams()
  const [params, setParams] = useSearchParams()
  const page = positiveInteger(params.get('page')) ?? 1
  const categoryId = positiveInteger(params.get('category'))
  const onlyFavourites = params.get('favourites') === '1'
  const searchTerm =
    OnlinePackSearchSchema.safeParse(params.get('q')).data ?? ''
  const requestedOrder = OnlinePackOrderSchema.safeParse(
    params.get('order'),
  ).data
  const order =
    !onlyFavourites || favouriteOrders.some((value) => value === requestedOrder)
      ? requestedOrder
      : undefined
  const query = params.size ? `?${params.toString()}` : ''
  const catalogUrl = `/browse${query}`
  const id = Number(packId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { favourites, toggleFavourite } = usePackFavourites()

  function changeFilter(
    field: 'page' | 'category' | 'favourites' | 'order' | 'q',
    value?: number | string,
  ) {
    const next = new URLSearchParams(params)
    if (field !== 'page') next.delete('page')
    if (value !== undefined && !(field === 'page' && value === 1))
      next.set(field, String(value))
    else next.delete(field)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setParams(next)
  }

  return (
    <div className="studio-app studio-inner-page bg-background text-foreground">
      <div
        key={packId ?? 'catalog'}
        ref={scrollRef}
        className="h-dvh overflow-y-auto"
      >
        <div className="mx-auto max-w-6xl px-6 py-6 sm:px-10">
          <header className="flex items-center border-b border-border pb-4">
            <Button asChild variant="ghost" size="sm">
              <Link to={packId ? catalogUrl : '/'}>
                <ArrowLeft aria-hidden="true" />
                {packId ? 'Browse packs' : 'Home'}
              </Link>
            </Button>
          </header>
          <main className="pt-6">
            {packId === undefined ? (
              <PackCatalog
                page={page}
                categoryId={categoryId}
                order={order}
                onlyFavourites={onlyFavourites}
                searchTerm={searchTerm}
                query={query}
                favourites={favourites}
                onPageChange={(next) => changeFilter('page', next)}
                onCategoryChange={(next) => changeFilter('category', next)}
                onOrderChange={(next) => changeFilter('order', next)}
                onSearchChange={(next) => changeFilter('q', next || undefined)}
                onFavouritesChange={(next) =>
                  changeFilter('favourites', next ? 1 : undefined)
                }
                onToggleFavourite={toggleFavourite}
              />
            ) : /^[1-9]\d*$/.test(packId) && Number.isSafeInteger(id) ? (
              <BrowsePackDetails
                packId={id}
                isFavourite={favourites.some((pack) => pack.id === id)}
                onToggleFavourite={toggleFavourite}
              />
            ) : (
              <p
                role="alert"
                className="p-6 text-center text-sm text-muted-foreground"
              >
                This pack could not be found.
              </p>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

type CatalogState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; result: OnlinePackPage }

function PackCatalog({
  page,
  categoryId,
  order,
  onlyFavourites,
  searchTerm,
  query,
  favourites,
  onPageChange,
  onCategoryChange,
  onOrderChange,
  onSearchChange,
  onFavouritesChange,
  onToggleFavourite,
}: {
  page: number
  categoryId?: number
  order?: OnlinePackOrder
  onlyFavourites: boolean
  searchTerm: string
  query: string
  favourites: OnlinePackListing[]
  onPageChange: (page: number) => void
  onCategoryChange: (category?: number) => void
  onOrderChange: (order?: OnlinePackOrder) => void
  onSearchChange: (term: string) => void
  onFavouritesChange: (onlyFavourites: boolean) => void
  onToggleFavourite: (pack: OnlinePackListing) => void
}) {
  const [categories, setCategories] = useState<OnlinePackCategory[]>([])
  const searchInput = useRef<HTMLInputElement>(null)
  const availableOrders = onlyFavourites
    ? favouriteOrders
    : OnlinePackOrderSchema.options
  useEffect(() => {
    if (searchInput.current) searchInput.current.value = searchTerm
  }, [searchTerm])

  useEffect(() => {
    let active = true
    window.studio.listOnlinePackCategories().then(
      (result) => {
        if (active) setCategories(result)
      },
      () => undefined,
    )
    return () => {
      active = false
    }
  }, [])

  return (
    <>
      <h1 className="text-4xl font-semibold">Browse Dub Packs</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Community packs from GameBanana’s Dub Mode category.
      </p>
      <form
        role="search"
        aria-label="Pack catalog"
        className="mt-4 flex h-10 w-full items-center rounded-lg border border-border bg-card p-1 focus-within:ring-1 focus-within:ring-ring"
        onSubmit={(event) => {
          event.preventDefault()
          const input = searchInput.current
          if (!input) return
          input.value = input.value.trim()
          onSearchChange(input.value)
        }}
      >
        <input
          ref={searchInput}
          type="search"
          aria-label="Search pack titles"
          placeholder="Search pack titles"
          defaultValue={searchTerm}
          maxLength={ONLINE_PACK_SEARCH_MAX_LENGTH}
          className="h-full min-w-0 flex-1 bg-transparent pr-2 pl-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {searchTerm && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear search"
            title="Clear search"
            className="size-7.5 shrink-0 rounded-md"
            onClick={() => {
              onSearchChange('')
              searchInput.current?.focus()
            }}
          >
            <X aria-hidden="true" />
          </Button>
        )}
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          aria-label="Search"
          title="Search"
          className="size-7.5 shrink-0 rounded-md hover:bg-transparent"
        >
          <Search aria-hidden="true" />
        </Button>
      </form>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div role="group" aria-label="Pack collection" className="flex gap-2">
          <Button
            size="sm"
            variant={onlyFavourites ? 'outline' : 'default'}
            aria-pressed={!onlyFavourites}
            onClick={() => onFavouritesChange(false)}
          >
            All packs
          </Button>
          <Button
            size="sm"
            variant={onlyFavourites ? 'default' : 'outline'}
            aria-pressed={onlyFavourites}
            onClick={() => onFavouritesChange(true)}
          >
            Favourites
          </Button>
        </div>
        <div className="flex flex-wrap gap-4">
          <CatalogSelect
            label="Category"
            value={categoryId ?? ''}
            onChange={(event) =>
              onCategoryChange(positiveInteger(event.target.value))
            }
          >
            <option value="">All categories</option>
            {categoryId && !categories.some(({ id }) => id === categoryId) && (
              <option value={categoryId}>Selected category</option>
            )}
            {categories.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </CatalogSelect>
          <CatalogSelect
            label="Order by"
            value={order ?? ''}
            onChange={(event) =>
              onOrderChange(
                OnlinePackOrderSchema.safeParse(event.target.value).data,
              )
            }
          >
            <option value="">
              {onlyFavourites ? 'Recently saved' : 'Newest'}
            </option>
            {availableOrders.map((value) => (
              <option key={value} value={value}>
                {orderLabels[value]}
              </option>
            ))}
          </CatalogSelect>
        </div>
      </div>
      <CatalogResults
        key={`${page}-${categoryId}-${onlyFavourites}-${order}-${searchTerm}`}
        page={page}
        categoryId={categoryId}
        order={order}
        onlyFavourites={onlyFavourites}
        searchTerm={searchTerm}
        query={query}
        favourites={favourites}
        onPageChange={onPageChange}
        onToggleFavourite={onToggleFavourite}
      />
    </>
  )
}

function CatalogResults({
  page,
  categoryId,
  order,
  onlyFavourites,
  searchTerm,
  query,
  favourites,
  onPageChange,
  onToggleFavourite,
}: {
  page: number
  categoryId?: number
  order?: OnlinePackOrder
  onlyFavourites: boolean
  searchTerm: string
  query: string
  favourites: OnlinePackListing[]
  onPageChange: (page: number) => void
  onToggleFavourite: (pack: OnlinePackListing) => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' })

  useEffect(() => {
    if (onlyFavourites) return
    let ignore = false
    const request = window.studio.browseOnlinePacks(
      page,
      categoryId,
      order,
      searchTerm || undefined,
    )
    request.then(
      (result) => {
        if (!ignore) setCatalog({ status: 'ready', result })
      },
      () => {
        if (!ignore) setCatalog({ status: 'error' })
      },
    )
    return () => {
      ignore = true
    }
  }, [page, categoryId, order, onlyFavourites, searchTerm, attempt])

  const searchNeedle = searchTerm.toLowerCase()
  const filteredFavourites = onlyFavourites
    ? favourites.filter(
        (pack) =>
          (!categoryId || pack.categoryId === categoryId) &&
          pack.title.toLowerCase().includes(searchNeedle),
      )
    : []
  if (order === 'title-asc' || order === 'title-desc') {
    const direction = order === 'title-asc' ? 1 : -1
    filteredFavourites.sort(
      (a, b) => direction * titleCollator.compare(a.title, b.title),
    )
  }
  const favouritePages = Math.max(
    1,
    Math.ceil(filteredFavourites.length / ONLINE_PACK_PAGE_SIZE),
  )
  const currentPage = onlyFavourites ? Math.min(page, favouritePages) : page
  const result = onlyFavourites
    ? {
        packs: filteredFavourites.slice(
          (currentPage - 1) * ONLINE_PACK_PAGE_SIZE,
          currentPage * ONLINE_PACK_PAGE_SIZE,
        ),
        hasNextPage: currentPage < favouritePages,
      }
    : catalog.status === 'ready'
      ? catalog.result
      : undefined
  const saved = new Set(favourites.map((pack) => pack.id))
  const emptyMessage = searchTerm
    ? `No ${onlyFavourites ? 'favourites' : 'packs'} match your search.`
    : onlyFavourites
      ? categoryId
        ? 'No favourites in this category.'
        : 'No favourite packs yet.'
      : 'No listings on this page.'

  return (
    <>
      <section aria-label="Pack listings" className="mt-5">
        {!onlyFavourites && catalog.status === 'loading' && (
          <OnlinePackSpinner label="Loading packs" className="min-h-[50dvh]" />
        )}
        {!onlyFavourites && catalog.status === 'error' && (
          <div className="p-6 text-center">
            <p role="alert" className="mb-4 text-sm">
              Couldn’t load the GameBanana listings.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setCatalog({ status: 'loading' })
                setAttempt((value) => value + 1)
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {result &&
          (result.packs.length === 0 ? (
            <p
              role="status"
              className="p-6 text-center text-sm text-muted-foreground"
            >
              {emptyMessage}
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {result.packs.map((pack) => (
                <li key={pack.id} className="relative min-w-0">
                  <Link
                    to={`/browse/${pack.id}${query}`}
                    className="group block h-full overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <PackPreview src={pack.thumbnailUrl} />
                    <div className="p-4">
                      <h2 className="text-base font-semibold break-words group-hover:text-primary">
                        {pack.title}
                      </h2>
                      {pack.submitter && (
                        <p className="mt-1 text-sm break-words text-muted-foreground">
                          By {pack.submitter}
                        </p>
                      )}
                      {pack.hasContentNotice && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Content notice on GameBanana
                        </p>
                      )}
                    </div>
                  </Link>
                  <PackFavouriteButton
                    title={pack.title}
                    saved={saved.has(pack.id)}
                    onToggle={() => onToggleFavourite(pack)}
                    compact
                  />
                </li>
              ))}
            </ul>
          ))}
      </section>
      {result && (!onlyFavourites || currentPage > 1 || result.hasNextPage) && (
        <nav
          aria-label="Catalog pages"
          className="mt-6 flex items-center justify-center gap-2 border-t border-border pt-3"
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous page"
            disabled={currentPage === 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="text-sm tabular-nums">Page {currentPage}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next page"
            disabled={!result.hasNextPage}
            onClick={() => onPageChange(currentPage + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      )}
    </>
  )
}
