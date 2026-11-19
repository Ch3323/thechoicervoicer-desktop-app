import { reportError } from '@/lib/error-toast'
import { useCallback, useEffect, useRef, type RefObject } from 'react'

export function useDubbingTrackVolume(
  audioRefs: RefObject<Map<string, HTMLAudioElement>>,
  volume: number,
) {
  const contextRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const sourcesRef = useRef(
    new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>(),
  )

  const attachAudio = useCallback((audio: HTMLAudioElement) => {
    const context = contextRef.current
    const gain = gainRef.current
    if (!context || !gain || sourcesRef.current.has(audio)) return
    const source = context.createMediaElementSource(audio)
    source.connect(gain)
    sourcesRef.current.set(audio, source)
    audio.volume = 1
  }, [])

  const enableBoost = useCallback(() => {
    if (typeof AudioContext === 'undefined') return
    try {
      if (!contextRef.current) {
        const context = new AudioContext()
        const gain = context.createGain()
        gain.connect(context.destination)
        contextRef.current = context
        gainRef.current = gain
      }
      gainRef.current!.gain.value = volume / 100
      for (const audio of audioRefs.current.values()) attachAudio(audio)
      void contextRef.current
        .resume()
        .catch(reportError)
    } catch (reason) {
      reportError(reason)
    }
  }, [attachAudio, audioRefs, volume])

  useEffect(() => {
    const gain = gainRef.current
    if (gain) gain.gain.value = volume / 100
    else
      for (const audio of audioRefs.current.values())
        audio.volume = Math.min(1, volume / 100)
  }, [audioRefs, volume])

  useEffect(
    () => () => {
      void contextRef.current?.close()
      contextRef.current = null
      gainRef.current = null
    },
    [],
  )

  return { attachAudio, enableBoost, contextRef }
}
