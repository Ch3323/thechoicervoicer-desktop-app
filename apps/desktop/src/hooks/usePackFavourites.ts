import { useEffect, useState } from 'react'
import type { OnlinePackListing } from '@studio/shared'
import { z } from 'zod'

const storageKey = 'studio.online-pack-favourites'
const favourite = z.object({
  id: z.int().positive(),
  title: z.string().min(1),
  submitter: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  hasContentNotice: z.boolean(),
  categoryId: z.int().positive().optional(),
})

function readFavourites(): OnlinePackListing[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(raw)) return []
    const saved = new Map<number, OnlinePackListing>()
    for (const entry of raw) {
      const { data } = favourite.safeParse(entry)
      if (data) saved.set(data.id, data)
    }
    return [...saved.values()]
  } catch {
    return []
  }
}

export function usePackFavourites() {
  const [favourites, setFavourites] = useState(readFavourites)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(favourites))
    } catch {
      // Keep favourites available for the current session if storage is unavailable.
    }
  }, [favourites])

  function toggleFavourite(pack: OnlinePackListing) {
    setFavourites((saved) =>
      saved.some(({ id }) => id === pack.id)
        ? saved.filter(({ id }) => id !== pack.id)
        : [favourite.parse(pack), ...saved],
    )
  }

  return { favourites, toggleFavourite }
}
