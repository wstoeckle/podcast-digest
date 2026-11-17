import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

export interface EpisodeAudioHandle {
  /** Jump to `seconds` and play; docks the player to the bottom of the screen. */
  seek(seconds: number): void;
}

/**
 * The episode's own audio, streamed from the feed. Timestamps in the outline,
 * quotes and cited answers call seek(); once playing, the player docks to the
 * bottom of the screen so it stays in reach while you read.
 */
const EpisodeAudio = forwardRef<EpisodeAudioHandle, { src: string }>(function EpisodeAudio(
  { src },
  ref,
) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [docked, setDocked] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      seek(seconds: number) {
        const a = audio.current;
        if (!a) return;
        a.currentTime = seconds;
        setDocked(true);
        void a.play().catch(() => {
          /* autoplay blocked: the controls are there to press play */
        });
      },
    }),
    [],
  );

  function close() {
    audio.current?.pause();
    setDocked(false);
  }

  return (
    <section className="panel" aria-label="Full episode audio">
      <div className="digest-h">Full episode</div>
      {docked && (
        <p className="muted audio-note">Playing in the bar at the bottom of the screen.</p>
      )}
      <div className={docked ? 'audio-bar docked' : 'audio-bar'}>
        <audio ref={audio} src={src} controls preload="none" onPlay={() => setDocked(true)} />
        {docked && (
          <button className="icon-btn" onClick={close} aria-label="Stop and close the player">
            ✕
          </button>
        )}
      </div>
    </section>
  );
});

export default EpisodeAudio;
