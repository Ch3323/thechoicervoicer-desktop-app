import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function OnlinePackSpinner({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn('grid min-h-28 place-items-center', className)}
    >
      <LoaderCircle
        aria-hidden="true"
        className="size-7 text-primary motion-safe:animate-spin"
      />
    </div>
  )
}
