import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMicrophoneRecorder } from '@/hooks/useMicrophoneRecorder'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('microphone recording limit', () => {
  it('stops at the source length and sends one completed take for automatic saving', async () => {
    vi.useFakeTimers()
    const stopTrack = vi.fn()
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: stopTrack }],
    }))
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: async () => [],
        getUserMedia,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    class FakeAudioContext {
      resume = async () => undefined
      close = async () => undefined
      createMediaStreamSource = () => ({ connect: () => undefined })
      createGain = () => ({ gain: { value: 1 }, connect: () => undefined })
      createMediaStreamDestination = () => ({ stream: {} })
      createAnalyser = () => ({
        fftSize: 1024,
        getByteTimeDomainData: (samples: Uint8Array) => samples.fill(160),
      })
    }
    class FakeMediaRecorder {
      static isTypeSupported = () => true
      state: RecordingState = 'inactive'
      mimeType = 'audio/webm'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      onerror: (() => void) | null = null
      start() {
        this.state = 'recording'
      }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({
          data: new Blob(['audio'], { type: 'audio/webm' }),
        })
        this.onstop?.()
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    const onCompleted = vi.fn()
    const onStarted = vi.fn()
    const onStopped = vi.fn()
    const onSample = vi.fn()
    const onPreRollStart = vi.fn()
    const { result, unmount } = renderHook(() => useMicrophoneRecorder())
    act(() => {
      result.current.setAutomaticVolume(true)
      result.current.setNoiseReduction(false)
      result.current.setEchoCancellation(true)
    })
    await act(async () => {
      void result.current.start(
        1.5,
        onCompleted,
        onStarted,
        onStopped,
        onSample,
        1,
        onPreRollStart,
      )
    })
    expect(onPreRollStart).toHaveBeenCalledOnce()
    expect(result.current.status).toBe('preroll')
    expect(onStarted).not.toHaveBeenCalled()
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        autoGainControl: true,
        noiseSuppression: false,
        echoCancellation: true,
      },
      video: false,
    })
    act(() => vi.advanceTimersByTime(999))
    expect(onStarted).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))
    expect(onStarted).toHaveBeenCalledOnce()
    expect(result.current.status).toBe('recording')
    act(() => vi.advanceTimersByTime(1500))
    expect(onSample).toHaveBeenCalled()
    expect(onSample.mock.calls.some(([, amplitude]) => amplitude > 0)).toBe(
      true,
    )
    expect(onStopped).toHaveBeenCalledWith(true)
    expect(onCompleted).toHaveBeenCalledOnce()
    expect(onCompleted.mock.calls[0][0]).toMatchObject({
      mimeType: 'audio/webm',
      durationSeconds: 1.5,
    })
    expect(stopTrack).toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    unmount()
  })
})
