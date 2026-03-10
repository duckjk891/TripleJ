import Phaser from 'phaser';
import { AVATAR_COLORS } from '../systems/CharacterManager';
import { getSpawnLocations } from '../config/worldTree';
import { Character } from '../entities/Character';
import { MainScene } from './MainScene';
import * as api from '../services/api';

export class UIScene extends Phaser.Scene {
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
  private traitsInput: HTMLInputElement | null = null;
  private backstoryInput: HTMLTextAreaElement | null = null;
  private routineInput: HTMLInputElement | null = null;

  constructor() {
    super({ key: 'UIScene' });
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

    console.log('UIScene created');
  }

  private createCharacterButton(): void {
    const buttonWidth = 140;
    const buttonHeight = 40;
    const x = this.cameras.main.width - buttonWidth / 2 - 20;
    const y = buttonHeight / 2 + 20;

    const bg = this.add.graphics();
    bg.fillStyle(0x4a90d9, 1);
    bg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    bg.lineStyle(2, 0x6bb3f0, 1);
    bg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);

    const text = this.add.text(0, 0, '+ 캐릭터 생성', {
      fontSize: '16px',
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    this.createButton = this.add.container(x, y, [bg, text]);
    this.createButton.setSize(buttonWidth, buttonHeight);
    this.createButton.setInteractive({ useHandCursor: true });

    this.createButton.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0x5ba0e9, 1);
      bg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
      bg.lineStyle(2, 0x7bc3ff, 1);
      bg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    });

    this.createButton.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(0x4a90d9, 1);
      bg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
      bg.lineStyle(2, 0x6bb3f0, 1);
      bg.strokeRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 8);
    });

    this.createButton.on('pointerdown', () => {
      this.showCreateModal();
    });
  }

  private createTimeDisplay(): void {
    // 배경 (컨트롤 포함 확장)
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.6);
    bg.fillRoundedRect(20, 20, 260, 75, 8);

    // 시간 텍스트 (동적 업데이트)
    this.timeText = this.add.text(35, 30, '📅 Day 1   🕐 6:00 AM', {
      fontSize: '14px',
      color: '#ffffff'
    });

    // 일시정지/재생 버튼
    this.pauseBtnText = this.add.text(35, 58, '⏸', {
      fontSize: '14px',
      color: '#ffffff',
      backgroundColor: '#555577',
      padding: { x: 6, y: 2 }
    }).setInteractive({ useHandCursor: true });

    this.pauseBtnText.on('pointerdown', () => {
      const mainScene = this.scene.get('MainScene') as MainScene;
      if (mainScene.gameTimeManager.getIsPaused()) {
        mainScene.resumeSimulation();
        this.pauseBtnText.setText('⏸');
      } else {
        mainScene.pauseSimulation();
        this.pauseBtnText.setText('▶');
      }
    });

    // 속도 버튼 (1x, 2x, 5x)
    const speeds = [1, 2, 5];
    speeds.forEach((speed, i) => {
      const isActive = speed === 1;
      const btn = this.add.text(80 + i * 50, 58, `x${speed}`, {
        fontSize: '13px',
        color: isActive ? '#ffffff' : '#888888',
        backgroundColor: isActive ? '#4a90d9' : '#333355',
        padding: { x: 8, y: 3 }
      }).setInteractive({ useHandCursor: true });

      btn.on('pointerdown', () => {
        const mainScene = this.scene.get('MainScene') as MainScene;
        mainScene.gameTimeManager.setSpeed(speed);
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
      loop: true
    });
  }

  private updateTimeDisplay(): void {
    const mainScene = this.scene.get('MainScene') as MainScene;
    if (mainScene.gameTimeManager) {
      this.timeText.setText(mainScene.gameTimeManager.getDisplayTime());
    }
  }

  private createCharacterCountDisplay(): void {
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.6);
    bg.fillRoundedRect(20, 105, 140, 35, 8);

    this.characterCountText = this.add.text(35, 115, '👥 캐릭터: 0', {
      fontSize: '14px',
      color: '#ffffff'
    });
  }

  private updateCharacterCount(): void {
    const mainScene = this.scene.get('MainScene') as MainScene;
    const count = mainScene.characterManager.getCharacterCount();
    this.characterCountText.setText(`👥 캐릭터: ${count}`);
  }

  private showCreateModal(): void {
    if (this.modal) return;

    const centerX = this.cameras.main.width / 2;
    const centerY = this.cameras.main.height / 2;

    this.modal = this.add.container(centerX, centerY);

    // 배경 딤
    const dim = this.add.graphics();
    dim.fillStyle(0x000000, 0.7);
    dim.fillRect(-centerX, -centerY, this.cameras.main.width, this.cameras.main.height);
    dim.setInteractive(new Phaser.Geom.Rectangle(-centerX, -centerY, this.cameras.main.width, this.cameras.main.height), Phaser.Geom.Rectangle.Contains);
    this.modal.add(dim);

    // 모달 패널
    const panelWidth = 420;
    const panelHeight = 620;
    const panel = this.add.graphics();
    panel.fillStyle(0x2d2d44, 1);
    panel.fillRoundedRect(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight, 16);
    panel.lineStyle(2, 0x4a90d9, 1);
    panel.strokeRoundedRect(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight, 16);
    this.modal.add(panel);

    // 제목
    const title = this.add.text(0, -panelHeight / 2 + 30, '에이전트 생성', {
      fontSize: '24px',
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    this.modal.add(title);

    // 아바타 색상 선택
    const avatarLabel = this.add.text(-panelWidth / 2 + 30, -130, '아바타 색상:', {
      fontSize: '14px',
      color: '#aaaaaa'
    });
    this.modal.add(avatarLabel);

    let colorX = -panelWidth / 2 + 40;
    const colorCircles: Phaser.GameObjects.Arc[] = [];

    AVATAR_COLORS.forEach((avatarColor, index) => {
      const circle = this.add.circle(colorX + index * 40, -100, 15, avatarColor.color);
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
    const nameLabel = this.add.text(-panelWidth / 2 + 30, -50, '이름:', {
      fontSize: '14px',
      color: '#aaaaaa'
    });
    this.modal.add(nameLabel);

    this.createDOMInput('nameInput', centerX - panelWidth / 2 + 30, centerY - 30, panelWidth - 60, '이름을 입력하세요');
    const defaultNames = ['김서연', '박민수', '이지영', '최준호', '정하늘'];
    this.nameInput!.value = defaultNames[Math.floor(Math.random() * defaultNames.length)];

    // 직업 입력 (HTML DOM)
    const occLabel = this.add.text(-panelWidth / 2 + 30, 20, '직업:', {
      fontSize: '14px',
      color: '#aaaaaa'
    });
    this.modal.add(occLabel);

    this.createDOMInput('occInput', centerX - panelWidth / 2 + 30, centerY + 40, panelWidth - 60, '직업을 입력하세요');
    const defaultOccupations = ['개발자', '디자이너', '매니저', '마케터', '연구원'];
    this.occInput!.value = defaultOccupations[Math.floor(Math.random() * defaultOccupations.length)];

    // 시작 위치 선택
    const locLabel = this.add.text(-panelWidth / 2 + 30, 90, '시작 위치:', {
      fontSize: '14px',
      color: '#aaaaaa'
    });
    this.modal.add(locLabel);

    const locBg = this.add.graphics();
    locBg.fillStyle(0x1a1a2e, 1);
    locBg.fillRoundedRect(-panelWidth / 2 + 30, 110, panelWidth - 60, 35, 6);
    this.modal.add(locBg);

    const spawnLocations = getSpawnLocations();
    const locText = this.add.text(0, 127, spawnLocations[this.selectedLocation].name, {
      fontSize: '14px',
      color: '#ffffff'
    }).setOrigin(0.5);
    this.modal.add(locText);

    // 위치 선택 화살표
    const prevLoc = this.add.text(-panelWidth / 2 + 45, 120, '◀', {
      fontSize: '18px',
      color: '#4a90d9'
    }).setInteractive({ useHandCursor: true });
    prevLoc.on('pointerdown', () => {
      this.selectedLocation = (this.selectedLocation - 1 + spawnLocations.length) % spawnLocations.length;
      locText.setText(spawnLocations[this.selectedLocation].name);
    });
    prevLoc.on('pointerover', () => prevLoc.setColor('#7bc3ff'));
    prevLoc.on('pointerout', () => prevLoc.setColor('#4a90d9'));
    this.modal.add(prevLoc);

    const nextLoc = this.add.text(panelWidth / 2 - 55, 120, '▶', {
      fontSize: '18px',
      color: '#4a90d9'
    }).setInteractive({ useHandCursor: true });
    nextLoc.on('pointerdown', () => {
      this.selectedLocation = (this.selectedLocation + 1) % spawnLocations.length;
      locText.setText(spawnLocations[this.selectedLocation].name);
    });
    nextLoc.on('pointerover', () => nextLoc.setColor('#7bc3ff'));
    nextLoc.on('pointerout', () => nextLoc.setColor('#4a90d9'));
    this.modal.add(nextLoc);

    // ── Phase B 필드 ──

    // 성격 특성
    const traitsLabel = this.add.text(-panelWidth / 2 + 30, 155, '성격 특성:', {
      fontSize: '14px',
      color: '#aaaaaa'
    });
    this.modal.add(traitsLabel);

    this.createDOMInput('traitsInput', centerX - panelWidth / 2 + 30, centerY + 175, panelWidth - 60, '예: 호기심 많고 친절한');
    this.traitsInput!.value = '성실하고 협력적인';

    // 배경 스토리
    const backstoryLabel = this.add.text(-panelWidth / 2 + 30, 215, '배경 스토리 (세미콜론 구분):', {
      fontSize: '14px',
      color: '#aaaaaa'
    });
    this.modal.add(backstoryLabel);

    this.createDOMTextArea(centerX - panelWidth / 2 + 30, centerY + 238, panelWidth - 60, 45, '예: 3년차 개발자; 커피를 좋아함');

    // 일과 패턴
    const routineLabel = this.add.text(-panelWidth / 2 + 30, 298, '일과 패턴:', {
      fontSize: '14px',
      color: '#aaaaaa'
    });
    this.modal.add(routineLabel);

    this.createDOMInput('routineInput', centerX - panelWidth / 2 + 30, centerY + 318, panelWidth - 60, '예: 9시 출근, 점심은 카페에서, 6시 퇴근');
    this.routineInput!.value = '9시 출근, 12시 점심, 6시 퇴근';

    // 버튼들
    const cancelBtn = this.createModalButton(-70, panelHeight / 2 - 50, '취소', 0x666666, () => {
      this.closeModal();
    });
    this.modal.add(cancelBtn);

    const createBtn = this.createModalButton(70, panelHeight / 2 - 50, '생성하기', 0x4a90d9, () => {
      const name = this.nameInput?.value || '이름없음';
      const occupation = this.occInput?.value || '직업없음';
      this.createCharacter(name, occupation);
    });
    this.modal.add(createBtn);
  }

  private createDOMInput(type: 'nameInput' | 'occInput' | 'traitsInput' | 'routineInput', x: number, y: number, width: number, placeholder: string): void {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.style.position = 'absolute';
    input.style.left = `${x}px`;
    input.style.top = `${y}px`;
    input.style.width = `${width}px`;
    input.style.height = '30px';
    input.style.padding = '5px 10px';
    input.style.fontSize = '14px';
    input.style.border = 'none';
    input.style.borderRadius = '6px';
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
    else if (type === 'traitsInput') this.traitsInput = input;
    else if (type === 'routineInput') this.routineInput = input;
  }

  private createDOMTextArea(x: number, y: number, width: number, height: number, placeholder: string): void {
    const textarea = document.createElement('textarea');
    textarea.placeholder = placeholder;
    textarea.style.position = 'absolute';
    textarea.style.left = `${x}px`;
    textarea.style.top = `${y}px`;
    textarea.style.width = `${width}px`;
    textarea.style.height = `${height}px`;
    textarea.style.padding = '5px 10px';
    textarea.style.fontSize = '13px';
    textarea.style.border = 'none';
    textarea.style.borderRadius = '6px';
    textarea.style.backgroundColor = '#1a1a2e';
    textarea.style.color = '#ffffff';
    textarea.style.outline = 'none';
    textarea.style.fontFamily = 'inherit';
    textarea.style.resize = 'none';

    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.appendChild(textarea);
    }

    this.backstoryInput = textarea;
  }

  private removeDOMInputs(): void {
    for (const el of [this.nameInput, this.occInput, this.traitsInput, this.backstoryInput, this.routineInput]) {
      if (el) el.remove();
    }
    this.nameInput = null;
    this.occInput = null;
    this.traitsInput = null;
    this.backstoryInput = null;
    this.routineInput = null;
  }

  private createModalButton(x: number, y: number, label: string, color: number, onClick: () => void): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);

    const bg = this.add.graphics();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(-60, -18, 120, 36, 8);

    const text = this.add.text(0, 0, label, {
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    container.add([bg, text]);
    container.setSize(120, 36);
    container.setInteractive({ useHandCursor: true });

    container.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(color + 0x222222, 1);
      bg.fillRoundedRect(-60, -18, 120, 36, 8);
    });

    container.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(color, 1);
      bg.fillRoundedRect(-60, -18, 120, 36, 8);
    });

    container.on('pointerdown', onClick);

    return container;
  }

  private createCharacter(name: string, occupation: string): void {
    const mainScene = this.scene.get('MainScene') as MainScene;
    const location = getSpawnLocations()[this.selectedLocation];
    const traits = this.traitsInput?.value || '';
    const backstory = this.backstoryInput?.value || '';
    const routine = this.routineInput?.value || '';

    // Phase B 에이전트 API 호출
    api.createAgent({
      name,
      occupation,
      avatar_id: this.selectedAvatarColor,
      spawn_location: location.id,
      traits,
      backstory,
      daily_routine: routine,
    }).catch(err => console.warn('Backend API error (agent create):', err));

    // Phase A 캐릭터도 로컬에 생성 (프론트엔드 시뮬레이션용)
    mainScene.characterManager.createCharacter(
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

    const panelWidth = 300;
    const panelHeight = 560;
    const x = this.cameras.main.width - panelWidth - 20;
    const y = 100;

    this.infoPanel = this.add.container(x, y);

    // 배경
    const bg = this.add.graphics();
    bg.fillStyle(0x2d2d44, 0.95);
    bg.fillRoundedRect(0, 0, panelWidth, panelHeight, 12);
    bg.lineStyle(2, 0x4a90d9, 1);
    bg.strokeRoundedRect(0, 0, panelWidth, panelHeight, 12);
    this.infoPanel.add(bg);

    // 닫기 버튼
    const closeBtn = this.add.text(panelWidth - 25, 10, '✕', {
      fontSize: '18px',
      color: '#888888'
    }).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerdown', () => {
      this.infoPanel?.destroy();
      this.infoPanel = null;
    });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ffffff'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#888888'));
    this.infoPanel.add(closeBtn);

    // 아바타
    const avatar = this.add.circle(40, 45, 20, character.avatarColor);
    avatar.setStrokeStyle(2, 0x333333);
    this.infoPanel.add(avatar);

    // 이름
    const nameText = this.add.text(70, 30, character.characterName, {
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold'
    });
    this.infoPanel.add(nameText);

    // 직업
    const occText = this.add.text(70, 52, character.occupation, {
      fontSize: '12px',
      color: '#aaaaaa'
    });
    this.infoPanel.add(occText);

    // 구분선 1
    const line1 = this.add.graphics();
    line1.lineStyle(1, 0x444466, 1);
    line1.moveTo(15, 80);
    line1.lineTo(panelWidth - 15, 80);
    line1.strokePath();
    this.infoPanel.add(line1);

    // 현재 상태
    const statusLabel = this.add.text(15, 90, '📍 상태:', {
      fontSize: '13px',
      color: '#888888'
    });
    this.infoPanel.add(statusLabel);

    const statusText = this.add.text(75, 90, character.currentAction, {
      fontSize: '13px',
      color: '#ffffff'
    });
    this.infoPanel.add(statusText);

    // 위치 (영역 이름으로)
    const posLabel = this.add.text(15, 115, '📌 위치:', {
      fontSize: '13px',
      color: '#888888'
    });
    this.infoPanel.add(posLabel);

    const areaName = character.getCurrentAreaName();
    const posText = this.add.text(75, 115, areaName, {
      fontSize: '13px',
      color: '#ffffff'
    });
    this.infoPanel.add(posText);

    // 구분선 2
    const line2 = this.add.graphics();
    line2.lineStyle(1, 0x444466, 1);
    line2.moveTo(15, 145);
    line2.lineTo(panelWidth - 15, 145);
    line2.strokePath();
    this.infoPanel.add(line2);

    // 이동 기록
    const historyLabel = this.add.text(15, 155, '📜 최근 기록', {
      fontSize: '13px',
      color: '#888888'
    });
    this.infoPanel.add(historyLabel);

    const history = character.getMovementHistory();
    if (history.length === 0) {
      const noHistory = this.add.text(25, 180, '기록 없음', {
        fontSize: '11px',
        color: '#666666'
      });
      this.infoPanel.add(noHistory);
    } else {
      const displayHistory = history.slice(0, 5);
      displayHistory.forEach((record, index) => {
        const recordText = this.add.text(25, 180 + index * 18, `${record.time} - ${record.action}`, {
          fontSize: '11px',
          color: '#cccccc'
        });
        this.infoPanel!.add(recordText);
      });
    }

    // ── Phase B: 에이전트 정보 (비동기 로드) ──
    const agentInfoY = 180 + Math.min(history.length, 5) * 18 + 10;

    const line3 = this.add.graphics();
    line3.lineStyle(1, 0x444466, 1);
    line3.moveTo(15, agentInfoY);
    line3.lineTo(panelWidth - 15, agentInfoY);
    line3.strokePath();
    this.infoPanel.add(line3);

    // 에이전트 계획/기억을 백엔드에서 로드
    const agentPlanLabel = this.add.text(15, agentInfoY + 10, '📋 현재 계획', {
      fontSize: '13px',
      color: '#888888'
    });
    this.infoPanel.add(agentPlanLabel);

    const planText = this.add.text(25, agentInfoY + 30, '로딩 중...', {
      fontSize: '11px',
      color: '#666666',
      wordWrap: { width: panelWidth - 50 }
    });
    this.infoPanel.add(planText);

    const memoryLabel = this.add.text(15, agentInfoY + 80, '🧠 최근 기억', {
      fontSize: '13px',
      color: '#888888'
    });
    this.infoPanel.add(memoryLabel);

    const memoryText = this.add.text(25, agentInfoY + 100, '로딩 중...', {
      fontSize: '11px',
      color: '#666666',
      wordWrap: { width: panelWidth - 50 }
    });
    this.infoPanel.add(memoryText);

    // B-11: 최근 반성 섹션
    const reflectionLabel = this.add.text(15, agentInfoY + 160, '💭 최근 반성', {
      fontSize: '13px',
      color: '#888888'
    });
    this.infoPanel.add(reflectionLabel);

    const reflectionText = this.add.text(25, agentInfoY + 180, '로딩 중...', {
      fontSize: '11px',
      color: '#666666',
      wordWrap: { width: panelWidth - 50 }
    });
    this.infoPanel.add(reflectionText);

    // 에이전트 데이터 비동기 로드
    this.loadAgentInfo(character.characterName, planText, memoryText, reflectionText);

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
      loop: true
    });
  }

  private loadAgentInfo(
    characterName: string,
    planText: Phaser.GameObjects.Text,
    memoryText: Phaser.GameObjects.Text,
    reflectionText: Phaser.GameObjects.Text,
  ): void {
    api.getAgents()
      .then(agents => {
        const agent = agents.find(a => a.name === characterName);
        if (!agent) {
          planText.setText('에이전트 데이터 없음');
          memoryText.setText('');
          reflectionText.setText('');
          return;
        }

        // 계획 표시
        if (agent.daily_plan && agent.daily_plan.length > 0) {
          const planLines = agent.daily_plan.slice(0, 4).map(
            p => `${p.start}-${p.end} ${p.desc}`
          );
          planText.setText(planLines.join('\n')).setColor('#cccccc');
        } else {
          planText.setText('계획 없음');
        }

        // 기억 표시 (observation/plan만 - reflection 분리)
        if (agent.recent_memories && agent.recent_memories.length > 0) {
          const nonReflections = agent.recent_memories.filter(m => m.type !== 'reflection');
          const memLines = nonReflections.slice(0, 3).map(
            m => `[${m.importance}] ${m.content.substring(0, 40)}...`
          );
          memoryText.setText(memLines.length > 0 ? memLines.join('\n') : '기억 없음').setColor('#cccccc');
        } else {
          memoryText.setText('기억 없음');
        }

        // B-11: 반성 표시
        if (agent.recent_reflections && agent.recent_reflections.length > 0) {
          const refLines = agent.recent_reflections.map(
            r => `[${r.importance}] ${r.content.substring(0, 50)}...`
          );
          reflectionText.setText(refLines.join('\n')).setColor('#d4a8ff');
        } else {
          reflectionText.setText('반성 없음');
        }
      })
      .catch(() => {
        planText.setText('백엔드 연결 안됨');
        memoryText.setText('');
        reflectionText.setText('');
      });
  }
}
