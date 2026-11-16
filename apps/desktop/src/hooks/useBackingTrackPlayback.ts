import { useCallback, useEffect, useRef, type RefObject } from 'react'

export function useBackingTrackPlayback(
  backingUrl: string | null,
  volume: number,
  videoRef: RefObject<HTMLVideoElement | null>,
  setError: (message: string) => void,
  enabled: boolean,
) {
  const backingAudioRef = useRef<HTMLAudioElement>(null)
  const backingContextRef = useRef<AudioContext | null>(null)
  const backingGainRef = useRef<GainNode | null>(null)
  const connectedAudioRef = useRef<HTMLAudioElement | null>(null)

  const enableBoost = useCallback(() => {
    const audio = backingAudioRef.current
    if (!audio || typeof AudioContext === 'undefined') return
    if (connectedAudioRef.current === audio) {
      void backingContextRef.current?.resume().catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      return
    }
    try {
      const context = new AudioContext()
      const source = context.createMediaElementSource(audio)
      const gain = context.createGain()
      source.connect(gain)
      gain.connect(context.destination)
      backingContextRef.current = context
      backingGainRef.current = gain
      connectedAudioRef.current = audio
      gain.gain.value = volume / 100
      void context.resume().catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [setError, volume])

  const syncBacking = useCallback(
    (video: HTMLVideoElement) => {
      const audio = backingAudioRef.current
      if (!audio) return
      if (video.paused || video.seeking || video.ended) {
        audio.pause()
        return
      }
      if (volume > 100) enableBoost()
      else if (backingContextRef.current)
        void backingContextRef.current.resume().catch((reason) =>
          setError(reason instanceof Error ? reason.message : String(reason)),
        )
      audio.playbackRate = video.playbackRate
      if (Math.abs(audio.currentTime - video.currentTime) > 0.08)
        audio.currentTime = video.currentTime
      if (audio.paused)
        void audio.play().catch((reason) =>
          setError(reason instanceof Error ? reason.message : String(reason)),
        )
    },
    [enableBoost, setError, volume],
  )

  useEffect(() => {
    const gain = backingGainRef.current
    if (gain) gain.gain.value = volume / 100
    else if (backingAudioRef.current)
      backingAudioRef.current.volume = Math.min(1, volume / 100)
  }, [volume, backingUrl])

  useEffect(() => {
    const video = videoRef.current
    if (enabled && backingUrl && video && !video.paused) syncBacking(video)
  }, [backingUrl, enabled, syncBacking, videoRef])

  useEffect(() => () => {
    backingAudioRef.current?.pause()
    void backingContextRef.current?.close()
    backingContextRef.current = null
    backingGainRef.current = null
    connectedAudioRef.current = null
  }, [backingUrl])

  return { backingAudioRef, syncBacking, enableBoost }
}
