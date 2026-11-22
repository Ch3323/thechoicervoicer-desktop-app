import { Film } from 'lucide-react'

export function PackPreview({
  src,
  alt = '',
  fit = 'cover',
  eager = false,
}: {
  src?: string
  alt?: string
  fit?: 'cover' | 'contain'
  eager?: boolean
}) {
  return (
    <div className="relative flex aspect-video items-center justify-center bg-secondary text-muted-foreground">
      <Film aria-hidden="true" className="size-7" />
      {src && (
        <img
          key={src}
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          referrerPolicy="no-referrer"
          className={`absolute inset-0 size-full bg-secondary ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
          onError={(event) => event.currentTarget.classList.add('invisible')}
        />
      )}
    </div>
  )
}
