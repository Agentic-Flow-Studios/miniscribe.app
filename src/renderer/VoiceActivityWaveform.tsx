import { useEffect, useState } from 'react';
import type { TrackKind } from '../capture-types';

interface VoiceActivityWaveformProps {
  isRecording: boolean;
  levels: React.RefObject<Record<TrackKind, number>>;
}

const BAR_MULTIPLIERS = [0.6, 1.0, 1.4, 0.9, 0.5];

export function VoiceActivityWaveform({
  isRecording,
  levels,
}: VoiceActivityWaveformProps): React.ReactNode {
  const [barHeights, setBarHeights] = useState<number[]>([4, 4, 4, 4, 4]);
  const [isActiveSpeech, setIsActiveSpeech] = useState(false);

  useEffect(() => {
    if (!isRecording) {
      setBarHeights([4, 4, 4, 4, 4]);
      setIsActiveSpeech(false);
      return;
    }

    let raf = 0;
    const tick = () => {
      if (!levels.current) return;
      const meLevel = levels.current.me ?? 0;
      const themLevel = levels.current.them ?? 0;
      const combinedPeak = Math.max(meLevel, themLevel);

      // Scale up peak for visual responsiveness (0.0 to 1.0)
      const scaled = Math.min(1, combinedPeak * 3.5);
      const isSpeaking = scaled > 0.08;
      setIsActiveSpeech(isSpeaking);

      setBarHeights((prev) => {
        const next = BAR_MULTIPLIERS.map((mult, idx) => {
          if (!isSpeaking) {
            // Smooth decay back to min height 4px
            return Math.max(4, Math.round(prev[idx] * 0.75));
          }
          // Dynamic height between 5px and 20px
          const target = Math.round(5 + scaled * 15 * mult);
          // Add slight jitter for natural waveform animation
          const jitter = (Math.random() - 0.5) * 3;
          return Math.max(4, Math.min(22, Math.round(target + jitter)));
        });
        return next;
      });

      // VU-style decay
      levels.current.me *= 0.88;
      levels.current.them *= 0.88;

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isRecording, levels]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '3px',
        height: '24px',
        padding: '0 6px',
        borderRadius: '6px',
        backgroundColor: isActiveSpeech
          ? 'rgba(48, 209, 88, 0.12)'
          : 'rgba(255, 255, 255, 0.05)',
        border: isActiveSpeech
          ? '1px solid rgba(48, 209, 88, 0.3)'
          : '1px solid rgba(255, 255, 255, 0.08)',
        transition: 'all 0.2s ease',
      }}
      title={
        isRecording
          ? isActiveSpeech
            ? 'Voice activity detected'
            : 'Listening for voice activity...'
          : 'Idle'
      }
    >
      {barHeights.map((h, i) => (
        <div
          key={i}
          style={{
            width: '3px',
            height: `${h}px`,
            borderRadius: '2px',
            backgroundColor: isActiveSpeech ? '#30d158' : 'rgba(255, 255, 255, 0.3)',
            boxShadow: isActiveSpeech ? '0 0 6px rgba(48, 209, 88, 0.7)' : 'none',
            transition: 'height 0.08s ease, background-color 0.2s ease',
          }}
        />
      ))}
    </div>
  );
}
