import PhaserGame from './PhaserGame';
import './Office.css';

interface OfficeProps {
  userId?: string;
}

function Office({ userId }: OfficeProps) {
  const handleGameReady = () => {
    console.log('Office game ready for user:', userId);
  };

  const handleError = (error: string) => {
    console.error('Office game error:', error);
  };

  return (
    <div className="office-container">
      <div className="office-header">
        <h3>나의 사무실</h3>
        <span className="office-status">근무 중</span>
      </div>
      <div className="office-game-wrapper">
        <PhaserGame
          onGameReady={handleGameReady}
          onError={handleError}
        />
      </div>
    </div>
  );
}

export default Office;
