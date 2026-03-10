'use client';

import dynamic from 'next/dynamic';
import ActivityLog from './ActivityLog';
import PresetPanel from './PresetPanel';
import './Office.css';

// Dynamically import PhaserGame with no SSR (Phaser requires browser APIs)
const PhaserGame = dynamic(() => import('./PhaserGame'), {
  ssr: false,
  loading: () => (
    <div className="office-game-loading">
      <div className="office-loading-spinner" />
      <p>게임 로딩 중...</p>
    </div>
  ),
});

interface OfficeProps {
  userId?: string;
}

function Office({ userId }: OfficeProps) {
  const handleGameReady = () => {};

  const handleError = (error: string) => {
    console.error('Office game error:', error);
  };

  return (
    <div className="office-container">
      <div className="office-header">
        <h3>나의 사무실</h3>
        <PresetPanel />
        <span className="office-status">근무 중</span>
      </div>
      <div className="office-body">
        <div className="office-game-wrapper">
          <PhaserGame
            onGameReady={handleGameReady}
            onError={handleError}
          />
        </div>
        <ActivityLog />
      </div>
    </div>
  );
}

export default Office;
