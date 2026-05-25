/**
 * BeatTrackView (v44)
 *
 * Renders a WaveSurfer waveform overlaid with beat / downbeat markers and
 * an optional metronome. Polls the backend beat-extraction status endpoint
 * until the result is ready, then displays the visualization.
 *
 * Source can be either:
 *   - a Suno generation: sourceType="generation", sourceId=<gen_id>
 *   - an uploaded track:  sourceType="track",       sourceId=<track_id>
 *
 * The audio URL is fully external; this component never builds a backend URL
 * directly — callers pass `audioUrl` (typically derived from helpers like
 * api.generationStreamUrl()).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import {
  FiPlay,
  FiPause,
  FiZoomIn,
  FiZoomOut,
  FiRefreshCw,
  FiVolume2,
  FiVolumeX,
} from 'react-icons/fi';

import * as api from '../api';
import Metronome from '../utils/metronome';
import './BeatTrackView.css';

const POLL_INTERVAL_MS_DEFAULT = 3000;
const ESTIMATE_TOTAL_SEC = 25;       // rough completion estimate for progress bar
const ZOOM_LABEL_THRESHOLD = 2.0;    // hide "1 2 3 4" labels below this zoom

export default function BeatTrackView({
  audioUrl,
  sourceType,            // "generation" | "track"
  sourceId,
  pollIntervalMs = POLL_INTERVAL_MS_DEFAULT,
}) {
  // ── Beat data state ──
  const [status, setStatus] = useState('pending'); // pending|running|completed|failed
  const [tempo, setTempo] = useState(null);
  const [beats, setBeats] = useState([]);
  const [downbeats, setDownbeats] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [startedAt, setStartedAt] = useState(null);

  // ── Player state ──
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoom, setZoom] = useState(1);                   // 1..4
  const [metronomeOn, setMetronomeOn] = useState(true);
  const [metronomeVolume, setMetronomeVolume] = useState(0.3);
  const [retrying, setRetrying] = useState(false);

  const waveContainerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const metronomeRef = useRef(null);
  const pollTimerRef = useRef(null);

  // ── Polling ──
  useEffect(() => {
    if (!sourceType || !sourceId) return undefined;

    let cancelled = false;
    const poll = async () => {
      try {
        const fetcher =
          sourceType === 'generation'
            ? api.getGenerationBeats
            : api.getTrackBeats;
        const { data } = await fetcher(sourceId);
        if (cancelled) return;
        setStatus(data.status || 'pending');
        setTempo(data.tempo ?? null);
        setBeats(Array.isArray(data.beats) ? data.beats : []);
        setDownbeats(Array.isArray(data.downbeats) ? data.downbeats : []);
        setErrorMsg(data.error || null);
        setStartedAt(data.started_at || null);

        if (data.status === 'completed' || data.status === 'failed') {
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        }
      } catch (e) {
        // 4xx/5xx — keep polling but surface message
        if (!cancelled) {
          setErrorMsg(e?.response?.data?.error || '비트 정보를 불러오지 못했습니다.');
        }
      }
    };

    poll(); // immediate
    pollTimerRef.current = setInterval(poll, pollIntervalMs);
    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [sourceType, sourceId, pollIntervalMs]);

  // ── WaveSurfer setup (only after status === completed) ──
  useEffect(() => {
    if (status !== 'completed' || !audioUrl || !waveContainerRef.current) {
      return undefined;
    }

    const ws = WaveSurfer.create({
      container: waveContainerRef.current,
      waveColor: '#9aa1ad',
      progressColor: '#7c4dff',
      cursorColor: '#ff4081',
      cursorWidth: 2,
      height: 96,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      url: audioUrl,
    });

    wavesurferRef.current = ws;

    const onReady = () => setDuration(ws.getDuration() || 0);
    const onPlay = () => {
      setPlaying(true);
      if (metronomeRef.current && metronomeOn) metronomeRef.current.start();
    };
    const onPause = () => {
      setPlaying(false);
      if (metronomeRef.current) metronomeRef.current.stop();
    };
    const onFinish = () => {
      setPlaying(false);
      if (metronomeRef.current) metronomeRef.current.stop();
    };
    const onAudioProcess = (t) => {
      setCurrentTime(t);
      if (metronomeRef.current && metronomeOn) metronomeRef.current.tick(t);
    };
    const onSeeking = (t) => {
      setCurrentTime(t);
    };

    ws.on('ready', onReady);
    ws.on('play', onPlay);
    ws.on('pause', onPause);
    ws.on('finish', onFinish);
    ws.on('audioprocess', onAudioProcess);
    ws.on('seeking', onSeeking);

    return () => {
      try {
        ws.un('ready', onReady);
        ws.un('play', onPlay);
        ws.un('pause', onPause);
        ws.un('finish', onFinish);
        ws.un('audioprocess', onAudioProcess);
        ws.un('seeking', onSeeking);
        ws.destroy();
      } catch {
        // ignore destroy errors
      }
      wavesurferRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, audioUrl]);

  // ── Apply zoom ──
  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws || status !== 'completed') return;
    try {
      // pixels-per-second base 50; multiplied by zoom level 1..4
      ws.zoom(50 * zoom);
    } catch {
      // ignore
    }
  }, [zoom, status]);

  // ── Metronome lifecycle ──
  useEffect(() => {
    if (status !== 'completed') return undefined;
    metronomeRef.current = new Metronome();
    metronomeRef.current.setBeats(beats, downbeats);
    metronomeRef.current.setVolume(metronomeOn ? metronomeVolume : 0);
    return () => {
      if (metronomeRef.current) {
        metronomeRef.current.destroy();
        metronomeRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Update metronome data when beats arrive after init
  useEffect(() => {
    if (metronomeRef.current) {
      metronomeRef.current.setBeats(beats, downbeats);
    }
  }, [beats, downbeats]);

  useEffect(() => {
    if (metronomeRef.current) {
      metronomeRef.current.setVolume(metronomeOn ? metronomeVolume : 0);
    }
    if (!metronomeOn && metronomeRef.current) {
      metronomeRef.current.stop();
    } else if (metronomeOn && playing && metronomeRef.current) {
      metronomeRef.current.start();
    }
  }, [metronomeOn, metronomeVolume, playing]);

  // ── Marker positions (memoized) ──
  const markers = useMemo(() => {
    if (!duration || !beats.length) return { regular: [], down: [] };
    const downSet = new Set(downbeats.map((t) => Number(t.toFixed(3))));
    const regular = [];
    const down = [];
    let downCounter = 0;
    let beatCounter = 0;
    for (const t of beats) {
      const pct = (t / duration) * 100;
      if (pct < 0 || pct > 100) continue;
      const isDown = downSet.has(Number(t.toFixed(3)));
      if (isDown) {
        downCounter += 1;
        beatCounter = 1;
        down.push({ time: t, pct, label: '1', barNumber: downCounter });
      } else {
        beatCounter = beatCounter + 1 || 2;
        regular.push({ time: t, pct, label: String(Math.min(beatCounter, 8)) });
      }
    }
    return { regular, down };
  }, [beats, downbeats, duration]);

  // ── Handlers ──
  const handlePlayPause = () => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    if (ws.isPlaying()) ws.pause();
    else ws.play();
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const fetcher =
        sourceType === 'generation'
          ? api.retryGenerationBeats
          : api.retryTrackBeats;
      await fetcher(sourceId);
      setStatus('pending');
      setErrorMsg(null);
      setBeats([]);
      setDownbeats([]);
      setTempo(null);
      // restart polling
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        try {
          const f =
            sourceType === 'generation'
              ? api.getGenerationBeats
              : api.getTrackBeats;
          const { data } = await f(sourceId);
          setStatus(data.status || 'pending');
          setTempo(data.tempo ?? null);
          setBeats(Array.isArray(data.beats) ? data.beats : []);
          setDownbeats(Array.isArray(data.downbeats) ? data.downbeats : []);
          setErrorMsg(data.error || null);
          if (data.status === 'completed' || data.status === 'failed') {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        } catch {
          // ignore
        }
      }, pollIntervalMs);
    } catch (e) {
      setErrorMsg(e?.response?.data?.error || '재시도에 실패했습니다.');
    } finally {
      setRetrying(false);
    }
  };

  // ── Loading / progress estimate ──
  const elapsedSec = useMemo(() => {
    if (!startedAt) return 0;
    try {
      return Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 1000);
    } catch {
      return 0;
    }
  }, [startedAt]);
  const progressPct = Math.min(95, Math.round((elapsedSec / ESTIMATE_TOTAL_SEC) * 100));

  // ── Render branches ──
  if (!sourceType || !sourceId) return null;

  if (status === 'pending' || status === 'running') {
    return (
      <div className="beat-track-view beat-track-view--loading">
        <div className="beat-track-view__header">
          <span className="beat-track-view__title">비트 분석</span>
          <span className="beat-track-view__status-badge beat-track-view__status-badge--loading">
            비트 추출 중
          </span>
        </div>
        <div className="beat-track-view__loading-body">
          <div className="beat-track-view__spinner" />
          <div className="beat-track-view__loading-text">
            비트 추출 중입니다… 약 15초 정도 소요됩니다.
          </div>
          <div className="beat-track-view__progress-bar">
            <div
              className="beat-track-view__progress-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="beat-track-view beat-track-view--failed">
        <div className="beat-track-view__header">
          <span className="beat-track-view__title">비트 분석</span>
          <span className="beat-track-view__status-badge beat-track-view__status-badge--failed">
            실패
          </span>
        </div>
        <div className="beat-track-view__error-body">
          <div className="beat-track-view__error-text">
            비트 추출에 실패했습니다.
            {errorMsg && <span className="beat-track-view__error-detail"> ({errorMsg})</span>}
          </div>
          <button
            type="button"
            className="beat-track-view__retry-btn"
            onClick={handleRetry}
            disabled={retrying}
          >
            <FiRefreshCw /> {retrying ? '재시도 중…' : '다시 시도'}
          </button>
        </div>
      </div>
    );
  }

  // status === 'completed'
  return (
    <div className="beat-track-view">
      <div className="beat-track-view__header">
        <span className="beat-track-view__title">비트 분석</span>
        <span className="beat-track-view__tempo-badge">
          {tempo ? `${tempo.toFixed(1)} BPM` : 'BPM —'} · 4/4 · 비트 {beats.length} / 다운비트{' '}
          {downbeats.length}
        </span>
      </div>

      <div className="beat-track-view__wave-wrapper">
        <div ref={waveContainerRef} className="beat-track-view__wave" />
        <div className="beat-track-view__markers">
          {markers.regular.map((m, i) => (
            <div
              key={`r-${i}`}
              className="beat-track-view__marker beat-track-view__marker--regular"
              style={{ left: `${m.pct}%` }}
            >
              {zoom >= ZOOM_LABEL_THRESHOLD && (
                <span className="beat-track-view__marker-label">{m.label}</span>
              )}
            </div>
          ))}
          {markers.down.map((m, i) => (
            <div
              key={`d-${i}`}
              className="beat-track-view__marker beat-track-view__marker--downbeat"
              style={{ left: `${m.pct}%` }}
            >
              {zoom >= ZOOM_LABEL_THRESHOLD && (
                <span className="beat-track-view__marker-label beat-track-view__marker-label--downbeat">
                  1
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="beat-track-view__time-row">
        <span>{fmtTime(currentTime)}</span>
        <span>{fmtTime(duration)}</span>
      </div>

      <div className="beat-track-view__controls">
        <button
          type="button"
          className="beat-track-view__btn beat-track-view__btn--primary"
          onClick={handlePlayPause}
        >
          {playing ? <FiPause /> : <FiPlay />}
          <span>{playing ? '일시정지' : '재생'}</span>
        </button>

        <div className="beat-track-view__zoom-group">
          <FiZoomOut />
          <input
            type="range"
            min="1"
            max="4"
            step="0.25"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="beat-track-view__zoom-slider"
            aria-label="확대"
          />
          <FiZoomIn />
          <span className="beat-track-view__zoom-value">{zoom.toFixed(1)}x</span>
        </div>

        <div className="beat-track-view__metronome-group">
          <button
            type="button"
            className={`beat-track-view__btn ${metronomeOn ? 'beat-track-view__btn--on' : ''}`}
            onClick={() => setMetronomeOn((v) => !v)}
          >
            {metronomeOn ? <FiVolume2 /> : <FiVolumeX />}
            <span>메트로놈</span>
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={metronomeVolume}
            onChange={(e) => setMetronomeVolume(parseFloat(e.target.value))}
            className="beat-track-view__volume-slider"
            disabled={!metronomeOn}
            aria-label="메트로놈 볼륨"
          />
        </div>
      </div>
    </div>
  );
}

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
