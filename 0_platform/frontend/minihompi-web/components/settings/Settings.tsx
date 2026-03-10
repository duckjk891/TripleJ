'use client';

import { useState } from 'react';
import './Settings.css';

interface SettingsProps {
  username: string;
}

function Settings({ username }: SettingsProps) {
  const [nickname, setNickname] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      alert('설정이 저장되었습니다!');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('설정 저장에 실패했습니다');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-container">
      <h2 className="settings-title">설정</h2>

      <div className="settings-section">
        <h3 className="settings-section-title">프로필</h3>

        <div className="settings-field">
          <label className="settings-label">닉네임</label>
          <input
            type="text"
            className="settings-input"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="닉네임을 입력하세요"
          />
        </div>

        <div className="settings-field">
          <label className="settings-label">상태 메시지</label>
          <input
            type="text"
            className="settings-input"
            value={statusMessage}
            onChange={(e) => setStatusMessage(e.target.value)}
            placeholder="오늘의 기분은?"
          />
        </div>

        <div className="settings-field">
          <label className="settings-label">프로필 이미지</label>
          <button className="settings-btn upload-btn">이미지 업로드</button>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">미니홈피</h3>

        <div className="settings-field">
          <label className="settings-label">테마</label>
          <select className="settings-select">
            <option value="default">기본</option>
            <option value="dark">다크</option>
            <option value="pastel">파스텔</option>
          </select>
        </div>

        <div className="settings-field">
          <label className="settings-label">BGM</label>
          <button className="settings-btn upload-btn">BGM 업로드</button>
        </div>
      </div>

      <div className="settings-actions">
        <button
          className="settings-btn save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '저장 중...' : '변경사항 저장'}
        </button>
      </div>
    </div>
  );
}

export default Settings;
