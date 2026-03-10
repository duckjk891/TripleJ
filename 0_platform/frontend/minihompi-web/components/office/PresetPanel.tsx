'use client';

import { useEffect, useState, useCallback } from 'react';
import * as api from '@/components/game/services/api';
import './PresetPanel.css';

function PresetPanel() {
  const [presets, setPresets] = useState<string[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchPresets = useCallback(async () => {
    try {
      const res = await api.getPresets();
      setPresets(res.presets);
    } catch {
      // backend not ready
    }
  }, []);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  const handleLoad = async (presetName: string) => {
    if (loading) return;
    setLoading(presetName);
    setMessage(null);
    try {
      const res = await api.loadPreset(presetName);
      const names = res.agents.map((a) => a.name).join(', ');
      setMessage(`${names} (${res.agents.length}명 생성됨)`);
      // state_sync 요청으로 게임에 반영
      const { GameBridge } = await import('@/components/game/bridge/GameBridge');
      const bridge = GameBridge.getInstance();
      if (bridge.isBackendConnected) {
        (bridge as any).gameWebSocket?.send({ type: 'request_state' });
      }
    } catch (err: any) {
      setMessage(`오류: ${err.message}`);
    } finally {
      setLoading(null);
      setTimeout(() => setMessage(null), 4000);
    }
  };

  if (presets.length === 0) return null;

  return (
    <div className="preset-panel">
      <span className="preset-label">프리셋:</span>
      <div className="preset-buttons">
        {presets.map((name, i) => (
          <button
            key={name}
            className={`preset-btn ${loading === name ? 'preset-btn--loading' : ''}`}
            onClick={() => handleLoad(name)}
            disabled={loading !== null}
            title={name}
          >
            {loading === name ? '...' : `설정 ${i + 1}`}
          </button>
        ))}
      </div>
      {message && <span className="preset-message">{message}</span>}
    </div>
  );
}

export default PresetPanel;
