import { reportError } from '@/lib/error-toast'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface CapturedTake {
  blob: Blob
  mimeType: string
  durationSeconds: number
}

type RecordingStatus =
  'idle' | 'requesting' | 'preroll' | 'recording' | 'processing'

interface MicrophoneSettings {
  deviceId: string
  inputVolume: number
  automaticVolume: boolean
  noiseReduction: boolean
  echoCancellation: boolean
  voiceIsolation: boolean
}

const SETTINGS_KEY = 'studio.microphone-settings.v1'
const defaultSettings: MicrophoneSettings = {
  deviceId: '',
  inputVolume: 100,
  automaticVolume: false,
  noiseReduction: true,
  echoCancellation: false,
  voiceIsolation: false,
}
let sessionSettings: MicrophoneSettings | null = null

function readSettings(): MicrophoneSettings {
  try {
    const saved: unknown = JSON.parse(
      window.localStorage.getItem(SETTINGS_KEY) ?? 'null',
    )
    if (!saved || typeof saved !== 'object')
      return sessionSettings ?? defaultSettings
    const value = saved as Record<string, unknown>
    return {
      deviceId:
        typeof value.deviceId === 'string' && value.deviceId.length <= 512
          ? value.deviceId
          : defaultSettings.deviceId,
      inputVolume:
        typeof value.inputVolume === 'number' &&
        Number.isFinite(value.inputVolume) &&
        value.inputVolume >= 25 &&
        value.inputVolume <= 1200
          ? value.inputVolume
          : defaultSettings.inputVolume,
      automaticVolume:
        typeof value.automaticVolume === 'boolean'
          ? value.automaticVolume
          : defaultSettings.automaticVolume,
      noiseReduction:
        typeof value.noiseReduction === 'boolean'
          ? value.noiseReduction
          : defaultSettings.noiseReduction,
      echoCancellation:
        typeof value.echoCancellation === 'boolean'
          ? value.echoCancellation
          : defaultSettings.echoCancellation,
      voiceIsolation:
        typeof value.voiceIsolation === 'boolean'
          ? value.voiceIsolation
          : defaultSettings.voiceIsolation,
    }
  } catch {
    return sessionSettings ?? defaultSettings
  }
}

const candidateTypes = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm',
  'audio/ogg',
  'audio/wav',
]

export function preferredRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return candidateTypes.find((type) => MediaRecorder.isTypeSupported(type))
}

export function useMicrophoneRecorder() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [settings, setSettings] = useState(readSettings)
  const {
    deviceId,
    inputVolume,
    automaticVolume,
    noiseReduction,
    echoCancellation,
    voiceIsolation,
  } = settings
  const [testing, setTesting] = useState(false)
  const [testLevel, setTestLevel] = useState(0)
  const [status, setStatus] = useState<RecordingStatus>('idle')
  const [level, setLevel] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const animationRef = useRef<number | null>(null)
  const limitTimerRef = useRef<number | null>(null)
  const cancelPreRollRef = useRef<(() => void) | null>(null)
  const mountedRef = useRef(true)
  const testStreamRef = useRef<MediaStream | null>(null)
  const testContextRef = useRef<AudioContext | null>(null)
  const testFrameRef = useRef<number | null>(null)

  useEffect(() => {
    sessionSettings = settings
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // Recording still works when browser storage is unavailable.
    }
  }, [settings])

  const setDeviceId = useCallback((value: string) => {
    setSettings((current) => ({ ...current, deviceId: value }))
  }, [])
  const setAutomaticVolume = useCallback((value: boolean) => {
    setSettings((current) => ({ ...current, automaticVolume: value }))
  }, [])
  const setNoiseReduction = useCallback((value: boolean) => {
    setSettings((current) => ({ ...current, noiseReduction: value }))
  }, [])
  const setEchoCancellation = useCallback((value: boolean) => {
    setSettings((current) => ({ ...current, echoCancellation: value }))
  }, [])
  const setVoiceIsolation = useCallback((value: boolean) => {
    setSettings((current) => ({ ...current, voiceIsolation: value }))
  }, [])

  const audioConstraints = useCallback(
    (): MediaTrackConstraints => ({
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      autoGainControl: automaticVolume,
      noiseSuppression: noiseReduction,
      echoCancellation,
    }),
    [deviceId, automaticVolume, noiseReduction, echoCancellation],
  )

  const stopTest = useCallback(() => {
    if (testFrameRef.current !== null)
      cancelAnimationFrame(testFrameRef.current)
    testFrameRef.current = null
    testStreamRef.current?.getTracks().forEach((track) => track.stop())
    testStreamRef.current = null
    if (testContextRef.current) void testContextRef.current.close()
    testContextRef.current = null
    if (mountedRef.current) {
      setTesting(false)
      setTestLevel(0)
    }
  }, [])

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const available = await navigator.mediaDevices.enumerateDevices()
      if (mountedRef.current)
        setDevices(available.filter((device) => device.kind === 'audioinput'))
    } catch (reason) {
      if (mountedRef.current) reportError(reason)
    }
  }, [])

  const startTest = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || status !== 'idle') return
    stopTest()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(),
        video: false,
      })
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      testStreamRef.current = stream
      const context = new AudioContext()
      testContextRef.current = context
      await context.resume()
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      context.createMediaStreamSource(stream).connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      const sample = () => {
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const value of samples) sum += ((value - 128) / 128) ** 2
        if (mountedRef.current)
          setTestLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4))
        testFrameRef.current = requestAnimationFrame(sample)
      }
      setTesting(true)
      testFrameRef.current = requestAnimationFrame(sample)
      void refreshDevices()
    } catch (reason) {
      stopTest()
      reportError(reason)
    }
  }, [audioConstraints, refreshDevices, status, stopTest])

  const cleanupHardware = useCallback(() => {
    if (limitTimerRef.current !== null)
      window.clearTimeout(limitTimerRef.current)
    limitTimerRef.current = null
    if (animationRef.current !== null)
      cancelAnimationFrame(animationRef.current)
    animationRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (contextRef.current) void contextRef.current.close()
    contextRef.current = null
    gainRef.current = null
    if (mountedRef.current) setLevel(0)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const initialScan = window.setTimeout(() => void refreshDevices(), 0)
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
    return () => {
      mountedRef.current = false
      window.clearTimeout(initialScan)
      navigator.mediaDevices?.removeEventListener?.(
        'devicechange',
        refreshDevices,
      )
      cancelPreRollRef.current?.()
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      else cleanupHardware()
      stopTest()
    }
  }, [cleanupHardware, refreshDevices, stopTest])

  const start = useCallback(
    async (
      maxDurationSeconds: number,
      onCompleted: (take: CapturedTake) => void,
      onStarted: () => void,
      onStopped: (automatic: boolean) => void,
      onSample: (elapsedSeconds: number, amplitude: number) => void,
      preRollSeconds = 0,
      onPreRollStart?: () => void,
    ) => {
      if (recorderRef.current?.state === 'recording') return
      if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) {
        reportError('The source clip length is unavailable.')
        return
      }
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === 'undefined'
      ) {
        reportError('Microphone recording is unavailable in this environment.')
        return
      }
      setStatus('requesting')
      stopTest()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints(),
          video: false,
        })
        if (!mountedRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        void refreshDevices()
        const context = new AudioContext()
        contextRef.current = context
        await context.resume()
        const source = context.createMediaStreamSource(stream)
        const gain = context.createGain()
        gain.gain.value = inputVolume / 100
        gainRef.current = gain
        const destination = context.createMediaStreamDestination()
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        if (voiceIsolation) {
          const highpass = context.createBiquadFilter()
          highpass.type = 'highpass'
          highpass.frequency.value = 100
          const lowpass = context.createBiquadFilter()
          lowpass.type = 'lowpass'
          lowpass.frequency.value = 7000
          source.connect(highpass)
          highpass.connect(lowpass)
          lowpass.connect(gain)
        } else source.connect(gain)
        gain.connect(destination)
        gain.connect(analyser)
        const samples = new Uint8Array(analyser.fftSize)
        let lastUpdate = 0
        const updateLevel = (now: number) => {
          analyser.getByteTimeDomainData(samples)
          if (now - lastUpdate > 33 && mountedRef.current) {
            let sum = 0
            for (const sample of samples) sum += ((sample - 128) / 128) ** 2
            const amplitude = Math.min(1, Math.sqrt(sum / samples.length) * 4)
            setLevel(amplitude)
            if (recorderRef.current?.state === 'recording')
              onSample(
                Math.min(
                  maxDurationSeconds,
                  (performance.now() - startedAt) / 1000,
                ),
                amplitude,
              )
            lastUpdate = now
          }
          animationRef.current = requestAnimationFrame(updateLevel)
        }
        const mimeType = preferredRecordingMimeType()
        const recorder = mimeType
          ? new MediaRecorder(destination.stream, { mimeType })
          : new MediaRecorder(destination.stream)
        recorderRef.current = recorder
        const chunks: BlobPart[] = []
        let startedAt = 0
        let failed = false
        let automatic = false
        let stoppedNotified = false
        const notifyStopped = () => {
          if (stoppedNotified) return
          stoppedNotified = true
          onStopped(automatic)
        }
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data)
        }
        recorder.onerror = () => {
          failed = true
          if (mountedRef.current) {
            reportError('Microphone recording failed.')
            setStatus('idle')
          }
          cleanupHardware()
          notifyStopped()
        }
        recorder.onstop = () => {
          cleanupHardware()
          recorderRef.current = null
          notifyStopped()
          if (failed) return
          const actualType = recorder.mimeType || mimeType || ''
          const blob = new Blob(chunks, { type: actualType })
          if (!actualType || blob.size === 0) {
            if (mountedRef.current)
              reportError('The recorder did not produce a supported audio file.')
          } else {
            onCompleted({
              blob,
              mimeType: actualType,
              durationSeconds: Math.min(
                maxDurationSeconds,
                Math.max(0, (performance.now() - startedAt) / 1000),
              ),
            })
          }
          if (mountedRef.current) setStatus('idle')
        }
        if (preRollSeconds > 0) {
          setStatus('preroll')
          onPreRollStart?.()
          const proceed = await new Promise<boolean>((resolve) => {
            const timer = window.setTimeout(() => {
              cancelPreRollRef.current = null
              resolve(true)
            }, preRollSeconds * 1000)
            cancelPreRollRef.current = () => {
              window.clearTimeout(timer)
              cancelPreRollRef.current = null
              resolve(false)
            }
          })
          if (!proceed || !mountedRef.current) {
            cleanupHardware()
            recorderRef.current = null
            if (mountedRef.current) {
              setStatus('idle')
              onStopped(false)
            }
            return
          }
        }
        startedAt = performance.now()
        recorder.start(250)
        animationRef.current = requestAnimationFrame(updateLevel)
        limitTimerRef.current = window.setTimeout(() => {
          if (recorder.state === 'recording') {
            automatic = true
            recorder.stop()
          }
        }, maxDurationSeconds * 1000)
        setStatus('recording')
        onStarted()
      } catch (reason) {
        cleanupHardware()
        recorderRef.current = null
        setStatus('idle')
        reportError(reason)
      }
    },
    [
      audioConstraints,
      cleanupHardware,
      inputVolume,
      refreshDevices,
      stopTest,
      voiceIsolation,
    ],
  )

  const changeInputVolume = useCallback((value: number) => {
    const next = Math.min(1200, Math.max(25, value))
    setSettings((current) => ({ ...current, inputVolume: next }))
    if (gainRef.current) gainRef.current.gain.value = next / 100
  }, [])

  const stop = useCallback(() => {
    if (cancelPreRollRef.current) {
      cancelPreRollRef.current()
      return
    }
    if (recorderRef.current?.state !== 'recording') return
    setStatus('processing')
    recorderRef.current.stop()
  }, [])

  return {
    devices,
    deviceId,
    setDeviceId,
    inputVolume,
    setInputVolume: changeInputVolume,
    automaticVolume,
    setAutomaticVolume,
    noiseReduction,
    setNoiseReduction,
    echoCancellation,
    setEchoCancellation,
    voiceIsolation,
    setVoiceIsolation,
    testing,
    testLevel,
    startTest,
    stopTest,
    status,
    level,
    refreshDevices,
    start,
    stop,
  }
}
