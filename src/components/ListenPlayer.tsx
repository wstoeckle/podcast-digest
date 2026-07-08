import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RATES,
  SentenceSpeaker,
  isTtsSupported,
  readRate,
  saveRate,
  splitSentences,
  type SpeakerState,
} from '../lib/tts';

export default function ListenPlayer({ text }: { text: string }) {
  const supported = isTtsSupported();
  const sentences = useMemo(() => splitSentences(text), [text]);
  const speakerRef = useRef<SentenceSpeaker | null>(null);
  const [state, setState] = useState<SpeakerState>('idle');
  const [index, setIndex] = useState(0);
  const [rate, setRate] = useState(() => readRate());
  const [voiceURI, setVoiceURI] = useState<string>('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // Set up the speaker once.
  useEffect(() => {
    if (!supported) return;
    const sp = new SentenceSpeaker();
    sp.onState = setState;
    sp.onIndex = setIndex;
    speakerRef.current = sp;
    return () => sp.stop();
  }, [supported]);

  // Keep loaded sentences in sync.
  useEffect(() => {
    speakerRef.current?.load(sentences);
    setIndex(0);
  }, [sentences]);

  // Voices load asynchronously in some browsers.
  useEffect(() => {
    if (!supported) return;
    const load = () => {
      const list = SentenceSpeaker.voices();
      setVoices(list);
      if (!voiceURI) {
        const preferred =
          list.find((v) => v.default && v.lang.startsWith('en')) ??
          list.find((v) => v.lang.startsWith('en')) ??
          list[0];
        if (preferred) setVoiceURI(preferred.voiceURI);
      }
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [supported, voiceURI]);

  if (!supported) {
    return (
      <p className="muted">Read-aloud isn’t available in this browser. Try Safari or Chrome.</p>
    );
  }

  function toggle() {
    const sp = speakerRef.current;
    if (!sp) return;
    if (state === 'playing') sp.pause();
    else if (state === 'paused') sp.resume();
    else sp.start({ rate, ...(voiceURI ? { voiceURI } : {}) }, index);
  }

  function restart() {
    speakerRef.current?.start({ rate, ...(voiceURI ? { voiceURI } : {}) }, 0);
  }

  function onRate(r: number) {
    setRate(r);
    saveRate(r);
    // Rate only applies to new utterances; if playing, restart from current spot.
    if (state !== 'idle') speakerRef.current?.start({ rate: r, ...(voiceURI ? { voiceURI } : {}) }, index);
  }

  return (
    <div>
      <div className="player">
        <button
          className="play"
          onClick={toggle}
          aria-label={state === 'playing' ? 'Pause' : 'Play'}
        >
          {state === 'playing' ? '❚❚' : '▶'}
        </button>
        <button className="btn subtle" onClick={restart} aria-label="Restart">
          ↺
        </button>
        <div className="rate">
          <label>
            Speed{' '}
            <select value={rate} onChange={(e) => onRate(Number(e.target.value))}>
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
          </label>
          {voices.length > 1 && (
            <select
              value={voiceURI}
              onChange={(e) => setVoiceURI(e.target.value)}
              aria-label="Voice"
            >
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {state !== 'idle' && sentences[index] && (
        <p className="speaking" style={{ marginTop: '0.7rem', lineHeight: 1.5 }}>
          <mark>{sentences[index]}</mark>
        </p>
      )}
    </div>
  );
}
