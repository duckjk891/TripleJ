/**
 * OfficeUIScene
 * UI 씬 - 1_oneCompany UIScene.ts 기반으로 복구
 * 시간 표시, 캐릭터 수, 캐릭터 생성 모달, 속도 조절 포함
 */

import Phaser from 'phaser';
import { AVATAR_COLORS } from '../types';
import { getSpawnLocations } from '../config/worldTree';
import { Character } from '../entities/Character';
import { OfficeScene } from './OfficeScene';
import * as api from '../services/api';

export class OfficeUIScene extends Phaser.Scene {
  private createButton!: Phaser.GameObjects.Container;
  private modal: Phaser.GameObjects.Container | null = null;
  private infoPanel: Phaser.GameObjects.Container | null = null;
  private characterCountText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private pauseBtnText!: Phaser.GameObjects.Text;
  private speedBtnTexts: Phaser.GameObjects.Text[] = [];

  // 모달 입력값
  private selectedAvatarColor: string = 'blue';
  private selectedLocation: number = 0;

  // DOM 입력 요소
  private nameInput: HTMLInputElement | null = null;
  private occInput: HTMLInputElement | null = null;

  constructor() {
    super({ key: 'OfficeUIScene' });
  }

  create(): void {
    // [+ 캐릭터 생성] 버튼
    this.createCharacterButton();

    // 시간 표시
    this.createTimeDisplay();

    // 캐릭터 수 표시
    this.createCharacterCountDisplay();

    // 캐릭터 클릭 이벤트 리스닝
    this.events.on('show-character-info', (character: Character) => {
      this.showCharacterInfo(character);
    });

    console.log('OfficeUIScene created');
  }

  private createCharacterButton(): void {
    const buttonWidth = 100;
    const buttonHeight = 28;
    const x = this.cameras.main.width - buttonWidth / 2 - 10;
    const y = buttonHeight / 2 + 10;

    const bg = this.add.graphics();
    bg.fillStyle(0x4a90d9, 1);
    bg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 6);
    bg.lineStyle(1, 0x6bb3f0, 1);
    bg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 6);

    const text = this.add.text(0, 0, '+ 캐릭터 생성', {
      fontSize: '11px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.createButton = this.add.container(x, y, [bg, text]);
    this.createButton.setSize(buttonWidth, buttonHeight);
    this.createButton.setInteractive({ useHandCursor: true });
    this.createButton.setDepth(400);

    this.createButton.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0x5ba0e9, 1);
      bg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 6);
      bg.lineStyle(1, 0x7bc3ff, 1);
      bg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 6);
    });

    this.createButton.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(0x4a90d9, 1);
      bg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 6);
      bg.lineStyle(1, 0x6bb3f0, 1);
      bg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 6);
    });

    this.createButton.on('pointerdown', () => {
      this.showCreateModal();
    });
  }

  private createTimeDisplay(): void {
    // 배경 (컨트롤 포함)
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.6);
    bg.fillRoundedRect(8, 8, 180, 50, 6);
    bg.setDepth(400);

    // 시간 텍스트 (동적 업데이트)
    this.timeText = this.add.text(16, 14, '1일차 오전 6:00', {
      fontSize: '11px',
      color: '#ffffff',
    });
    this.timeText.setDepth(400);

    // 일시정지/재생 버튼
    this.pauseBtnText = this.add.text(16, 34, '||', {
      fontSize: '11px',
      color: '#ffffff',
      backgroundColor: '#555577',
      padding: { x: 4, y: 2 },
    }).setInteractive({ useHandCursor: true });
    this.pauseBtnText.setDepth(400);

    this.pauseBtnText.on('pointerdown', () => {
      const officeScene = this.scene.get('OfficeScene') as OfficeScene;
      if (officeScene.gameTimeManager.getIsPaused()) {
        officeScene.resumeSimulation();
        this.pauseBtnText.setText('||');
      } else {
        officeScene.pauseSimulation();
        this.pauseBtnText.setText('>');
      }
    });

    // 속도 버튼 (x1, x2, x5)
    const speeds = [1, 2, 5];
    speeds.forEach((speed, i) => {
      const isActive = speed === 1;
      const btn = this.add.text(50 + i * 40, 34, `x${speed}`, {
        fontSize: '10px',
        color: isActive ? '#ffffff' : '#888888',
        backgroundColor: isActive ? '#4a90d9' : '#333355',
        padding: { x: 6, y: 2 },
      }).setInteractive({ useHandCursor: true });
      btn.setDepth(400);

      btn.on('pointerdown', () => {
        const officeScene = this.scene.get('OfficeScene') as OfficeScene;
        officeScene.gameTimeManager.setSpeed(speed);
        this.speedBtnTexts.forEach((b, j) => {
          if (j === i) {
            b.setColor('#ffffff');
            b.setBackgroundColor('#4a90d9');
          } else {
            b.setColor('#888888');
            b.setBackgroundColor('#333355');
          }
        });
      });

      this.speedBtnTexts.push(btn);
    });

    // 시간 표시 업데이트 타이머 (500ms)
    this.time.addEvent({
      delay: 500,
      callback: () => this.updateTimeDisplay(),
      loop: true,
    });
  }

  private updateTimeDisplay(): void {
    const officeScene = this.scene.get('OfficeScene') as OfficeScene;
    if (officeScene?.gameTimeManager) {
      this.timeText.setText(officeScene.gameTimeManager.getDisplayTime());
    }
  }

  private createCharacterCountDisplay(): void {
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.6);
    bg.fillRoundedRect(8, 66, 100, 24, 6);
    bg.setDepth(400);

    this.characterCountText = this.add.text(16, 72, '캐릭터: 0', {
      fontSize: '11px',
      color: '#ffffff',
    });
    this.characterCountText.setDepth(400);

    // 캐릭터 수 업데이트 타이머
    this.time.addEvent({
      delay: 1000,
      callback: () => this.updateCharacterCount(),
      loop: true,
    });
  }

  private updateCharacterCount(): void {
    const officeScene = this.scene.get('OfficeScene') as OfficeScene;
    if (officeScene?.characterManager) {
      const count = officeScene.characterManager.getCharacterCount();
      this.characterCountText.setText(`캐릭터: ${count}`);
    }
  }

  private showCreateModal(): void {
    if (this.modal) return;

    const centerX = this.cameras.main.width / 2;
    const centerY = this.cameras.main.height / 2;

    this.modal = this.add.container(centerX, centerY);
    this.modal.setDepth(500);

    // 배경 딤
    const dim = this.add.graphics();
    dim.fillStyle(0x000000, 0.7);
    dim.fillRect(-centerX, -centerY, this.cameras.main.width, this.cameras.main.height);
    dim.setInteractive(
      new Phaser.Geom.Rectangle(-centerX, -centerY, this.cameras.main.width, this.cameras.main.height),
      Phaser.Geom.Rectangle.Contains
    );
    this.modal.add(dim);

    // 모달 패널
    const panelWidth = 280;
    const panelHeight = 260;
    const panel = this.add.graphics();
    panel.fillStyle(0x2d2d44, 1);
    panel.fillRoundedRect(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight, 10);
    panel.lineStyle(2, 0x4a90d9, 1);
    panel.strokeRoundedRect(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight, 10);
    this.modal.add(panel);

    // 제목
    const title = this.add.text(0, -panelHeight / 2 + 20, '캐릭터 생성', {
      fontSize: '16px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.modal.add(title);

    // 아바타 색상 선택
    const avatarLabel = this.add.text(-panelWidth / 2 + 20, -75, '아바타 색상:', {
      fontSize: '11px',
      color: '#aaaaaa',
    });
    this.modal.add(avatarLabel);

    const colorCircles: Phaser.GameObjects.Arc[] = [];
    AVATAR_COLORS.forEach((avatarColor, index) => {
      const circle = this.add.circle(-panelWidth / 2 + 30 + index * 30, -50, 10, avatarColor.color);
      circle.setStrokeStyle(2, this.selectedAvatarColor === avatarColor.id ? 0xffffff : 0x333333);
      circle.setInteractive({ useHandCursor: true });

      circle.on('pointerdown', () => {
        this.selectedAvatarColor = avatarColor.id;
        colorCircles.forEach((c, i) => {
          c.setStrokeStyle(2, AVATAR_COLORS[i].id === avatarColor.id ? 0xffffff : 0x333333);
        });
      });

      colorCircles.push(circle);
      this.modal!.add(circle);
    });

    // 이름 입력 (HTML DOM)
    const nameLabel = this.add.text(-panelWidth / 2 + 20, -25, '이름:', {
      fontSize: '11px',
      color: '#aaaaaa',
    });
    this.modal.add(nameLabel);

    this.createDOMInput('nameInput', centerX - panelWidth / 2 + 20, centerY - 8, panelWidth - 40, '이름을 입력하세요');
    const defaultNames = ['김서연', '박민수', '이지영', '최준호', '정하늘'];
    this.nameInput!.value = defaultNames[Math.floor(Math.random() * defaultNames.length)];

    // 직업 입력 (HTML DOM)
    const occLabel = this.add.text(-panelWidth / 2 + 20, 28, '직업:', {
      fontSize: '11px',
      color: '#aaaaaa',
    });
    this.modal.add(occLabel);

    this.createDOMInput('occInput', centerX - panelWidth / 2 + 20, centerY + 45, panelWidth - 40, '직업을 입력하세요');
    const defaultOccupations = ['개발자', '디자이너', '매니저', '마케터', '연구원'];
    this.occInput!.value = defaultOccupations[Math.floor(Math.random() * defaultOccupations.length)];

    // 시작 위치 선택
    const locLabel = this.add.text(-panelWidth / 2 + 20, 75, '시작 위치:', {
      fontSize: '11px',
      color: '#aaaaaa',
    });
    this.modal.add(locLabel);

    const locBg = this.add.graphics();
    locBg.fillStyle(0x1a1a2e, 1);
    locBg.fillRoundedRect(-panelWidth / 2 + 20, 92, panelWidth - 40, 24, 4);
    this.modal.add(locBg);

    const spawnLocations = getSpawnLocations();
    const locText = this.add.text(0, 104, spawnLocations[this.selectedLocation]?.name || '작업 공간', {
      fontSize: '11px',
      color: '#ffffff',
    }).setOrigin(0.5);
    this.modal.add(locText);

    // 위치 선택 화살표
    const prevLoc = this.add.text(-panelWidth / 2 + 30, 98, '<', {
      fontSize: '14px',
      color: '#4a90d9',
    }).setInteractive({ useHandCursor: true });
    prevLoc.on('pointerdown', () => {
      this.selectedLocation = (this.selectedLocation - 1 + spawnLocations.length) % spawnLocations.length;
      locText.setText(spawnLocations[this.selectedLocation].name);
    });
    prevLoc.on('pointerover', () => prevLoc.setColor('#7bc3ff'));
    prevLoc.on('pointerout', () => prevLoc.setColor('#4a90d9'));
    this.modal.add(prevLoc);

    const nextLoc = this.add.text(panelWidth / 2 - 35, 98, '>', {
      fontSize: '14px',
      color: '#4a90d9',
    }).setInteractive({ useHandCursor: true });
    nextLoc.on('pointerdown', () => {
      this.selectedLocation = (this.selectedLocation + 1) % spawnLocations.length;
      locText.setText(spawnLocations[this.selectedLocation].name);
    });
    nextLoc.on('pointerover', () => nextLoc.setColor('#7bc3ff'));
    nextLoc.on('pointerout', () => nextLoc.setColor('#4a90d9'));
    this.modal.add(nextLoc);

    // 버튼들
    const cancelBtn = this.createModalButton(-50, panelHeight / 2 - 30, '취소', 0x666666, () => {
      this.closeModal();
    });
    this.modal.add(cancelBtn);

    const createBtn = this.createModalButton(50, panelHeight / 2 - 30, '생성', 0x4a90d9, () => {
      const name = this.nameInput?.value || '이름없음';
      const occupation = this.occInput?.value || '직업없음';
      this.createCharacter(name, occupation);
    });
    this.modal.add(createBtn);
  }

  private createDOMInput(
    type: 'nameInput' | 'occInput',
    x: number,
    y: number,
    width: number,
    placeholder: string
  ): void {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.style.position = 'absolute';
    input.style.left = `${x}px`;
    input.style.top = `${y}px`;
    input.style.width = `${width}px`;
    input.style.height = '22px';
    input.style.padding = '3px 8px';
    input.style.fontSize = '11px';
    input.style.border = 'none';
    input.style.borderRadius = '4px';
    input.style.backgroundColor = '#1a1a2e';
    input.style.color = '#ffffff';
    input.style.outline = 'none';
    input.style.fontFamily = 'inherit';

    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.appendChild(input);
    }

    if (type === 'nameInput') this.nameInput = input;
    else if (type === 'occInput') this.occInput = input;
  }

  private removeDOMInputs(): void {
    for (const el of [this.nameInput, this.occInput]) {
      if (el) el.remove();
    }
    this.nameInput = null;
    this.occInput = null;
  }

  private createModalButton(
    x: number,
    y: number,
    label: string,
    color: number,
    onClick: () => void
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);

    const bg = this.add.graphics();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(-40, -14, 80, 28, 6);

    const text = this.add.text(0, 0, label, {
      fontSize: '12px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    container.add([bg, text]);
    container.setSize(80, 28);
    container.setInteractive({ useHandCursor: true });

    container.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(color + 0x222222, 1);
      bg.fillRoundedRect(-40, -14, 80, 28, 6);
    });

    container.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(color, 1);
      bg.fillRoundedRect(-40, -14, 80, 28, 6);
    });

    container.on('pointerdown', onClick);

    return container;
  }

  private createCharacter(name: string, occupation: string): void {
    const officeScene = this.scene.get('OfficeScene') as OfficeScene;
    const spawnLocations = getSpawnLocations();
    const location = spawnLocations[this.selectedLocation] || spawnLocations[0];

    // API 호출 (백엔드 연결 시)
    api.createAgent({
      name,
      occupation,
      avatar_id: this.selectedAvatarColor,
      spawn_location: location.id,
      traits: '',
      backstory: '',
      daily_routine: '',
    }).catch((err) => console.warn('Backend API error (agent create):', err));

    // 로컬 캐릭터 생성
    officeScene.characterManager.createCharacter(
      name,
      occupation,
      this.selectedAvatarColor,
      location.x,
      location.y
    );

    this.closeModal();
    this.updateCharacterCount();
  }

  private closeModal(): void {
    this.removeDOMInputs();
    if (this.modal) {
      this.modal.destroy();
      this.modal = null;
    }
  }

  private showCharacterInfo(character: Character): void {
    // 기존 패널 제거
    if (this.infoPanel) {
      this.infoPanel.destroy();
    }

    const panelWidth = 160;
    const panelHeight = 180;
    const x = this.cameras.main.width - panelWidth - 8;
    const y = 50;

    this.infoPanel = this.add.container(x, y);
    this.infoPanel.setDepth(400);

    // 배경
    const bg = this.add.graphics();
    bg.fillStyle(0x2d2d44, 0.95);
    bg.fillRoundedRect(0, 0, panelWidth, panelHeight, 8);
    bg.lineStyle(2, 0x7b5ea7, 1);
    bg.strokeRoundedRect(0, 0, panelWidth, panelHeight, 8);
    this.infoPanel.add(bg);

    // 닫기 버튼
    const closeBtn = this.add.text(panelWidth - 16, 6, 'x', {
      fontSize: '12px',
      color: '#888888',
    }).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerdown', () => {
      this.infoPanel?.destroy();
      this.infoPanel = null;
    });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ffffff'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#888888'));
    this.infoPanel.add(closeBtn);

    // 아바타
    const avatar = this.add.circle(22, 26, 12, character.avatarColor);
    avatar.setStrokeStyle(2, 0x333333);
    this.infoPanel.add(avatar);

    // 이름
    const nameText = this.add.text(42, 16, character.characterName, {
      fontSize: '12px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    this.infoPanel.add(nameText);

    // 직업
    const occText = this.add.text(42, 30, character.occupation, {
      fontSize: '9px',
      color: '#aaaaaa',
    });
    this.infoPanel.add(occText);

    // 구분선
    const line = this.add.graphics();
    line.lineStyle(1, 0x444466, 1);
    line.moveTo(8, 48);
    line.lineTo(panelWidth - 8, 48);
    line.strokePath();
    this.infoPanel.add(line);

    // 현재 상태
    const statusLabel = this.add.text(8, 54, '상태:', {
      fontSize: '9px',
      color: '#888888',
    });
    this.infoPanel.add(statusLabel);

    const statusText = this.add.text(40, 54, character.currentAction, {
      fontSize: '9px',
      color: '#ffffff',
      wordWrap: { width: panelWidth - 50 },
    });
    this.infoPanel.add(statusText);

    // 위치
    const posLabel = this.add.text(8, 72, '위치:', {
      fontSize: '9px',
      color: '#888888',
    });
    this.infoPanel.add(posLabel);

    const posText = this.add.text(40, 72, character.getCurrentAreaName(), {
      fontSize: '9px',
      color: '#ffffff',
      wordWrap: { width: panelWidth - 50 },
    });
    this.infoPanel.add(posText);

    // 최근 기록
    const historyLabel = this.add.text(8, 94, '최근 기록:', {
      fontSize: '9px',
      color: '#888888',
    });
    this.infoPanel.add(historyLabel);

    const history = character.getMovementHistory();
    const displayHistory = history.slice(0, 3);
    displayHistory.forEach((record, index) => {
      const recordText = this.add.text(
        8,
        108 + index * 14,
        `${record.time} - ${record.action.substring(0, 14)}`,
        {
          fontSize: '8px',
          color: '#cccccc',
        }
      );
      this.infoPanel!.add(recordText);
    });

    // 실시간 업데이트 타이머
    const updateTimer = this.time.addEvent({
      delay: 1000,
      callback: () => {
        if (!this.infoPanel) {
          updateTimer.destroy();
          return;
        }
        statusText.setText(character.currentAction);
        posText.setText(character.getCurrentAreaName());
      },
      loop: true,
    });
  }
}
