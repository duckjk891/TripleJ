import './ProfileCard.css';

interface ProfileCardProps {
  nickname: string;
  statusMessage: string;
  profileImage: string;
  todayCount: number;
  totalCount: number;
}

function ProfileCard({ nickname, statusMessage, profileImage, todayCount, totalCount }: ProfileCardProps) {
  return (
    <div className="profile-card">
      <div className="profile-image-wrap">
        {profileImage ? (
          <img src={profileImage} alt="profile" className="profile-image" />
        ) : (
          <div className="profile-image-placeholder">
            <span>&#x1f464;</span>
          </div>
        )}
      </div>

      <div className="profile-nickname">{nickname}</div>
      <div className="profile-status">{statusMessage}</div>

      <div className="profile-counter">
        <div className="counter-row">
          <span className="counter-label">TODAY</span>
          <span className="counter-value today">{todayCount}</span>
        </div>
        <div className="counter-row">
          <span className="counter-label">TOTAL</span>
          <span className="counter-value total">{totalCount}</span>
        </div>
      </div>
    </div>
  );
}

export default ProfileCard;
