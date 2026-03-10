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
import { GameBridge } from '../bridge/GameBridge';
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
  private traitsInput: HTMLInputElement | null = null;
  private backstoryInput: HTMLTextAreaElement | null = null;
  private dailyRoutineInput: HTMLInputElement | null = null;

  // 시뮬레이션 상태
  private isSimulationRunning: boolean = false;
  private simButton: Phaser.GameObjects.Container | null = null;
  private simButtonText: Phaser.GameObjects.Text | null = null;

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

    // 시뮬레이션 제어 버튼
    this.createSimulationButton();

    // Save/Load 버튼
    this.createSaveLoadButtons();

    // 캐릭터 클릭 이벤트 리스닝
    this.events.on('show-character-info', (character: Character) => {
      this.showCharacterInfo(character);
    });

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

    // 모달 패널 (캔버스 320px 안에 맞춤)
    const panelWidth = 280;
    const panelHeight = 300;
    const panelTop = -panelHeight / 2;
    const panel = this.add.graphics();
    panel.fillStyle(0x2d2d44, 1);
    panel.fillRoundedRect(-panelWidth / 2, panelTop, panelWidth, panelHeight, 10);
    panel.lineStyle(2, 0x4a90d9, 1);
    panel.strokeRoundedRect(-panelWidth / 2, panelTop, panelWidth, panelHeight, 10);
    this.modal.add(panel);

    // 모달 내 Y 위치 추적
    let yPos = panelTop + 12;

    // 제목
    const title = this.add.text(0, yPos, '캐릭터 생성', {
      fontSize: '12px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.modal.add(title);
    yPos += 18;

    // 아바타 색상 선택
    const avatarLabel = this.add.text(-panelWidth / 2 + 16, yPos, '아바타:', {
      fontSize: '9px',
      color: '#aaaaaa',
    });
    this.modal.add(avatarLabel);
    yPos += 12;

    const colorCircles: Phaser.GameObjects.Arc[] = [];
    AVATAR_COLORS.forEach((avatarColor, index) => {
      const circle = this.add.circle(-panelWidth / 2 + 24 + index * 24, yPos, 7, avatarColor.color);
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
    yPos += 14;

    // 이름 입력
    const nameLabel = this.add.text(-panelWidth / 2 + 16, yPos, '이름:', {
      fontSize: '9px',
      color: '#aaaaaa',
    });
    this.modal.add(nameLabel);
    yPos += 12;

    this.createDOMInput('nameInput', centerX - panelWidth / 2 + 16, centerY + yPos, panelWidth - 32, '이름을 입력하세요');
    const defaultNames = ['김서연', '박민수', '이지영', '최준호', '정하늘'];
    this.nameInput!.value = defaultNames[Math.floor(Math.random() * defaultNames.length)];
    yPos += 20;

    // 직업 입력
    const occLabel = this.add.text(-panelWidth / 2 + 16, yPos, '직업:', {
      fontSize: '9px',
      color: '#aaaaaa',
    });
    this.modal.add(occLabel);
    yPos += 12;

    this.createDOMInput('occInput', centerX - panelWidth / 2 + 16, centerY + yPos, panelWidth - 32, '직업을 입력하세요');
    const defaultOccupations = ['개발자', '디자이너', '매니저', '마케터', '연구원'];
    this.occInput!.value = defaultOccupations[Math.floor(Math.random() * defaultOccupations.length)];
    yPos += 20;

    // 성격 (traits)
    const traitsLabel = this.add.text(-panelWidth / 2 + 16, yPos, '성격:', {
      fontSize: '9px',
      color: '#aaaaaa',
    });
    this.modal.add(traitsLabel);
    yPos += 12;

    this.createDOMInput('traitsInput', centerX - panelWidth / 2 + 16, centerY + yPos, panelWidth - 32, '예: 창의적, 꼼꼼한');
    yPos += 20;

    // 배경 (backstory)
    const backstoryLabel = this.add.text(-panelWidth / 2 + 16, yPos, '배경:', {
      fontSize: '9px',
      color: '#aaaaaa',
    });
    this.modal.add(backstoryLabel);
    yPos += 12;

    this.createDOMTextarea('backstoryInput', centerX - panelWidth / 2 + 16, centerY + yPos, panelWidth - 32, 28, '예: 2년차 개발자, 커피를 좋아함');
    yPos += 32;

    // 일과 (daily_routine)
    const routineLabel = this.add.text(-panelWidth / 2 + 16, yPos, '일과:', {
      fontSize: '9px',
      color: '#aaaaaa',
    });
    this.modal.add(routineLabel);
    yPos += 12;

    this.createDOMInput('dailyRoutineInput', centerX - panelWidth / 2 + 16, centerY + yPos, panelWidth - 32, '예: 코딩, 코드리뷰, 팀미팅');
    yPos += 20;

    // 시작 위치 선택
    const locLabel = this.add.text(-panelWidth / 2 + 16, yPos, '위치:', {
      fontSize: '9px',
      color: '#aaaaaa',
    });
    this.modal.add(locLabel);
    yPos += 12;

    const locBg = this.add.graphics();
    locBg.fillStyle(0x1a1a2e, 1);
    locBg.fillRoundedRect(-panelWidth / 2 + 16, yPos, panelWidth - 32, 18, 4);
    this.modal.add(locBg);

    const spawnLocations = getSpawnLocations();
    const locText = this.add.text(0, yPos + 9, spawnLocations[this.selectedLocation]?.name || '작업 공간', {
      fontSize: '9px',
      color: '#ffffff',
    }).setOrigin(0.5);
    this.modal.add(locText);

    const prevLoc = this.add.text(-panelWidth / 2 + 24, yPos + 3, '<', {
      fontSize: '10px',
      color: '#4a90d9',
    }).setInteractive({ useHandCursor: true });
    prevLoc.on('pointerdown', () => {
      this.selectedLocation = (this.selectedLocation - 1 + spawnLocations.length) % spawnLocations.length;
      locText.setText(spawnLocations[this.selectedLocation].name);
    });
    prevLoc.on('pointerover', () => prevLoc.setColor('#7bc3ff'));
    prevLoc.on('pointerout', () => prevLoc.setColor('#4a90d9'));
    this.modal.add(prevLoc);

    const nextLoc = this.add.text(panelWidth / 2 - 30, yPos + 3, '>', {
      fontSize: '10px',
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
    const btnY = panelTop + panelHeight - 22;
    const cancelBtn = this.createModalButton(-50, btnY, '취소', 0x666666, () => {
      this.closeModal();
    });
    this.modal.add(cancelBtn);

    const createBtn = this.createModalButton(50, btnY, '생성', 0x4a90d9, () => {
      const name = this.nameInput?.value || '이름없음';
      const occupation = this.occInput?.value || '직업없음';
      const traits = this.traitsInput?.value || '';
      const backstory = this.backstoryInput?.value || '';
      const dailyRoutine = this.dailyRoutineInput?.value || '';
      this.createCharacter(name, occupation, traits, backstory, dailyRoutine);
    });
    this.modal.add(createBtn);
  }

  /**
   * Convert game coordinates to screen pixel coordinates relative to canvas parent.
   */
  private gameToScreen(gameX: number, gameY: number, gameW?: number, gameH?: number) {
    const canvas = this.sys.game.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    const parentRect = canvas.parentElement?.getBoundingClientRect();

    const scaleX = canvasRect.width / this.cameras.main.width;
    const scaleY = canvasRect.height / this.cameras.main.height;

    const offsetX = canvasRect.left - (parentRect?.left || 0);
    const offsetY = canvasRect.top - (parentRect?.top || 0);

    return {
      x: offsetX + gameX * scaleX,
      y: offsetY + gameY * scaleY,
      w: gameW ? gameW * scaleX : undefined,
      h: gameH ? gameH * scaleY : undefined,
      scaleX,
      scaleY,
    };
  }

  private createDOMInput(
    type: 'nameInput' | 'occInput' | 'traitsInput' | 'dailyRoutineInput',
    x: number,
    y: number,
    width: number,
    placeholder: string
  ): void {
    const screen = this.gameToScreen(x, y, width, 20);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.style.position = 'absolute';
    input.style.left = `${screen.x}px`;
    input.style.top = `${screen.y}px`;
    input.style.width = `${screen.w}px`;
    input.style.height = `${screen.h}px`;
    input.style.padding = '2px 6px';
    input.style.fontSize = `${Math.round(10 * screen.scaleY)}px`;
    input.style.border = 'none';
    input.style.borderRadius = '4px';
    input.style.backgroundColor = '#1a1a2e';
    input.style.color = '#ffffff';
    input.style.outline = 'none';
    input.style.fontFamily = 'inherit';
    input.style.zIndex = '10';

    const parent = this.sys.game.canvas.parentElement;
    if (parent) {
      parent.appendChild(input);
    }

    if (type === 'nameInput') this.nameInput = input;
    else if (type === 'occInput') this.occInput = input;
    else if (type === 'traitsInput') this.traitsInput = input;
    else if (type === 'dailyRoutineInput') this.dailyRoutineInput = input;
  }

  private createDOMTextarea(
    type: 'backstoryInput',
    x: number,
    y: number,
    width: number,
    height: number,
    placeholder: string
  ): void {
    const screen = this.gameToScreen(x, y, width, height);

    const textarea = document.createElement('textarea');
    textarea.placeholder = placeholder;
    textarea.style.position = 'absolute';
    textarea.style.left = `${screen.x}px`;
    textarea.style.top = `${screen.y}px`;
    textarea.style.width = `${screen.w}px`;
    textarea.style.height = `${screen.h}px`;
    textarea.style.padding = '2px 6px';
    textarea.style.fontSize = `${Math.round(10 * screen.scaleY)}px`;
    textarea.style.border = 'none';
    textarea.style.borderRadius = '4px';
    textarea.style.backgroundColor = '#1a1a2e';
    textarea.style.color = '#ffffff';
    textarea.style.outline = 'none';
    textarea.style.fontFamily = 'inherit';
    textarea.style.resize = 'none';
    textarea.style.zIndex = '10';

    const parent = this.sys.game.canvas.parentElement;
    if (parent) {
      parent.appendChild(textarea);
    }

    if (type === 'backstoryInput') this.backstoryInput = textarea;
  }

  private removeDOMInputs(): void {
    const elements: (HTMLElement | null)[] = [
      this.nameInput,
      this.occInput,
      this.traitsInput,
      this.backstoryInput,
      this.dailyRoutineInput,
    ];
    for (const el of elements) {
      if (el) el.remove();
    }
    this.nameInput = null;
    this.occInput = null;
    this.traitsInput = null;
    this.backstoryInput = null;
    this.dailyRoutineInput = null;
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

  private async createCharacter(
    name: string,
    occupation: string,
    traits: string = '',
    backstory: string = '',
    dailyRoutine: string = ''
  ): Promise<void> {
    const officeScene = this.scene.get('OfficeScene') as OfficeScene;
    const spawnLocations = getSpawnLocations();
    const location = spawnLocations[this.selectedLocation] || spawnLocations[0];

    let agentId: string | undefined;

    // API 호출 (백엔드 연결 시)
    try {
      const agent = await api.createAgent({
        name,
        occupation,
        avatar_id: this.selectedAvatarColor,
        spawn_location: location.id,
        traits,
        backstory,
        daily_routine: dailyRoutine,
      });
      agentId = agent.id;
    } catch {
      // agent create failed
    }

    // 로컬 캐릭터 생성 (agentId 전달)
    officeScene.characterManager.createCharacter(
      name,
      occupation,
      this.selectedAvatarColor,
      location.x,
      location.y,
      agentId
    );

    this.closeModal();
    this.updateCharacterCount();
  }

  private createSimulationButton(): void {
    const buttonWidth = 90;
    const buttonHeight = 22;
    const x = 200;
    const y = 20;

    const bg = this.add.graphics();
    bg.fillStyle(0x228822, 1);
    bg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 4);

    this.simButtonText = this.add.text(0, 0, '> 시뮬레이션', {
      fontSize: '10px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.simButton = this.add.container(x, y, [bg, this.simButtonText]);
    this.simButton.setSize(buttonWidth, buttonHeight);
    this.simButton.setInteractive({ useHandCursor: true });
    this.simButton.setDepth(400);

    this.simButton.on('pointerdown', () => {
      this.toggleSimulation(bg, buttonWidth, buttonHeight);
    });

    this.simButton.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(this.isSimulationRunning ? 0xbb3333 : 0x33aa33, 1);
      bg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 4);
    });

    this.simButton.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(this.isSimulationRunning ? 0x882222 : 0x228822, 1);
      bg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 4);
    });
  }

  private async toggleSimulation(
    bg: Phaser.GameObjects.Graphics,
    buttonWidth: number,
    buttonHeight: number
  ): Promise<void> {
    try {
      if (this.isSimulationRunning) {
        await api.stopAutoSimulation();
        this.isSimulationRunning = false;
        this.simButtonText?.setText('> 시뮬레이션');
        bg.clear();
        bg.fillStyle(0x228822, 1);
        bg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 4);
      } else {
        await api.startAutoSimulation();
        this.isSimulationRunning = true;
        this.simButtonText?.setText('[] 중지');
        bg.clear();
        bg.fillStyle(0x882222, 1);
        bg.fillRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 4);
      }
    } catch {
      // simulation toggle failed
    }
  }

  private createSaveLoadButtons(): void {
    const y = 46;
    const btnHeight = 20;

    // Save 버튼
    const saveBg = this.add.graphics();
    saveBg.fillStyle(0x555577, 1);
    saveBg.fillRoundedRect(-30, -btnHeight / 2, 60, btnHeight, 4);
    const saveText = this.add.text(0, 0, '저장', {
      fontSize: '9px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const saveBtn = this.add.container(200, y, [saveBg, saveText]);
    saveBtn.setSize(60, btnHeight);
    saveBtn.setInteractive({ useHandCursor: true });
    saveBtn.setDepth(400);
    saveBtn.on('pointerdown', async () => {
      try {
        await api.saveSimulation();
        saveText.setText('저장됨!');
        this.time.delayedCall(1500, () => saveText.setText('저장'));
      } catch {
        // save failed
      }
    });

    // Load 버튼
    const loadBg = this.add.graphics();
    loadBg.fillStyle(0x555577, 1);
    loadBg.fillRoundedRect(-30, -btnHeight / 2, 60, btnHeight, 4);
    const loadText = this.add.text(0, 0, '불러오기', {
      fontSize: '9px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const loadBtn = this.add.container(270, y, [loadBg, loadText]);
    loadBtn.setSize(60, btnHeight);
    loadBtn.setInteractive({ useHandCursor: true });
    loadBtn.setDepth(400);
    loadBtn.on('pointerdown', async () => {
      try {
        await api.loadSimulation();
        loadText.setText('완료!');
        this.time.delayedCall(1500, () => loadText.setText('불러오기'));
      } catch {
        // load failed
      }
    });
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

    const officeScene = this.scene.get('OfficeScene') as OfficeScene;
    const agentId = officeScene.characterManager.getAgentIdByCharacterId(character.characterId);

    const panelWidth = 180;
    const panelHeight = agentId ? 280 : 180;
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

    // 에이전트 정보 (backend 연결 시)
    if (agentId) {
      let agentInfoY = 152;

      // 구분선
      const line2 = this.add.graphics();
      line2.lineStyle(1, 0x444466, 1);
      line2.moveTo(8, agentInfoY);
      line2.lineTo(panelWidth - 8, agentInfoY);
      line2.strokePath();
      this.infoPanel.add(line2);
      agentInfoY += 8;

      // 현재 계획
      const planLabel = this.add.text(8, agentInfoY, '계획:', {
        fontSize: '9px',
        color: '#888888',
      });
      this.infoPanel.add(planLabel);
      agentInfoY += 14;

      const planText = this.add.text(8, agentInfoY, '로딩 중...', {
        fontSize: '8px',
        color: '#cccccc',
        wordWrap: { width: panelWidth - 16 },
      });
      this.infoPanel.add(planText);
      agentInfoY += 28;

      // 기억
      const memLabel = this.add.text(8, agentInfoY, '최근 기억:', {
        fontSize: '9px',
        color: '#888888',
      });
      this.infoPanel.add(memLabel);
      agentInfoY += 14;

      const memText = this.add.text(8, agentInfoY, '로딩 중...', {
        fontSize: '8px',
        color: '#cccccc',
        wordWrap: { width: panelWidth - 16 },
      });
      this.infoPanel.add(memText);

      // 비동기로 에이전트 정보 가져오기
      this.fetchAgentInfo(agentId, planText, memText);
    }

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

  private async fetchAgentInfo(
    agentId: string,
    planText: Phaser.GameObjects.Text,
    memText: Phaser.GameObjects.Text
  ): Promise<void> {
    // Fetch plan
    try {
      const plan = await api.getAgentPlan(agentId) as any;
      if (plan && planText.active) {
        const planStr = plan.current_plan || plan.desc || JSON.stringify(plan).substring(0, 60);
        planText.setText(planStr.substring(0, 80));
      }
    } catch {
      if (planText.active) planText.setText('-');
    }

    // Fetch memories
    try {
      const memories = await api.getAgentMemories(agentId, 5) as any[];
      if (memories && memories.length > 0 && memText.active) {
        const memStr = memories
          .slice(0, 3)
          .map((m: any) => (m.content || m.text || '').substring(0, 30))
          .join('\n');
        memText.setText(memStr || '-');
      } else if (memText.active) {
        memText.setText('-');
      }
    } catch {
      if (memText.active) memText.setText('-');
    }
  }
}
