import { Heart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function PackFavouriteButton({
  title,
  saved,
  onToggle,
  compact = false,
}: {
  title: string
  saved: boolean
  onToggle: () => void
  compact?: boolean
}) {
  const label = saved ? 'Remove from favourites' : 'Add to favourites'
  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? 'icon' : 'sm'}
      aria-pressed={saved}
      aria-label={`${label}: ${title}`}
      title={label}
      className={cn(
        compact && 'absolute top-3 right-3 size-9 bg-card hover:bg-card',
        saved && 'text-primary',
      )}
      onClick={onToggle}
    >
      <Heart
        aria-hidden="true"
        className={saved ? 'fill-current' : undefined}
      />
      {!compact && label}
    </Button>
  )
}
