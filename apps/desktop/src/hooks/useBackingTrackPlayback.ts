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

  const syncBacking = useCallback(
    (video: HTMLVideoElement) => {
      const audio = backingAudioRef.current
      if (!audio) return
      audio.playbackRate = video.playbackRate
      void (async () => {
        if (backingContextRef.current) await backingContextRef.current.resume()
        if (video.paused || backingAudioRef.current !== audio) return
        audio.currentTime = video.currentTime
        await audio.play()
      })().catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
    },
    [setError],
  )

  useEffect(() => {
    const audio = backingAudioRef.current
    if (!enabled || !audio || typeof AudioContext === 'undefined') return
    let context: AudioContext | null = null
    try {
      context = new AudioContext()
      const activeContext = context
      const source = activeContext.createMediaElementSource(audio)
      const gain = activeContext.createGain()
      source.connect(gain)
      gain.connect(activeContext.destination)
      backingContextRef.current = activeContext
      backingGainRef.current = gain
      return () => {
        audio.pause()
        source.disconnect()
        gain.disconnect()
        backingContextRef.current = null
        backingGainRef.current = null
        void activeContext.close()
      }
    } catch {
      if (context) void context.close()
    }
  }, [backingUrl, enabled])

  useEffect(() => {
    const gain = backingGainRef.current
    if (gain) gain.gain.value = volume / 100
    else if (backingAudioRef.current)
      backingAudioRef.current.volume = Math.min(1, volume / 100)
  }, [volume, backingUrl, enabled])

  useEffect(() => {
    const video = videoRef.current
    if (enabled && backingUrl && video && !video.paused) syncBacking(video)
  }, [backingUrl, enabled, syncBacking, videoRef])

  return { backingAudioRef, syncBacking }
}
