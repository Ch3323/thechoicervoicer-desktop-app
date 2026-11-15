import { useEffect, useState } from 'react'
import { Film } from 'lucide-react'

export function PackThumbnail({
  packId,
  assetRef,
  className = '',
}: {
  packId: string
  assetRef?: string
  className?: string
}) {
  const [asset, setAsset] = useState<{ key: string; url: string } | null>(null)
  const key = `${packId}:${assetRef ?? ''}`
  useEffect(() => {
    if (!assetRef) return
    let active = true
    window.studio.getAssetUrl(packId, assetRef).then(
      (url) => {
        if (active) setAsset({ key, url })
      },
      () => {
        if (active) setAsset(null)
      },
    )
    return () => {
      active = false
    }
  }, [packId, assetRef, key])
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/60 text-primary ${className}`}
    >
      {asset?.key === key ? (
        <img src={asset.url} alt="" className="h-full w-full object-cover" />
      ) : (
        <Film aria-hidden="true" className="size-5" />
      )}
    </span>
  )
}
