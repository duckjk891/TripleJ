export class GameTimeManager {
  private totalGameMinutes: number;
  private timeSpeed: number = 1;
  private readonly baseRate: number = 1; // 1x: 실제 1초 = 게임 1분
  private paused: boolean = false;
  private lastRealTime: number;

  constructor(startHour: number = 6) {
    this.totalGameMinutes = startHour * 60;
    this.lastRealTime = Date.now();
  }

  update(): void {
    const now = Date.now();
    if (!this.paused) {
      const elapsedSeconds = (now - this.lastRealTime) / 1000;
      this.totalGameMinutes += elapsedSeconds * this.baseRate * this.timeSpeed;
    }
    this.lastRealTime = now;
  }

  getHour(): number {
    return Math.floor(this.totalGameMinutes / 60) % 24;
  }

  getMinute(): number {
    return Math.floor(this.totalGameMinutes) % 60;
  }

  getDay(): number {
    return Math.floor(this.totalGameMinutes / (24 * 60)) + 1;
  }

  getDisplayTime(): string {
    const day = this.getDay();
    const hour = this.getHour();
    const minute = this.getMinute();
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const displayMinute = minute.toString().padStart(2, '0');
    return `📅 Day ${day}   🕐 ${displayHour}:${displayMinute} ${period}`;
  }

  setSpeed(speed: number): void {
    this.timeSpeed = speed;
  }

  getSpeed(): number {
    return this.timeSpeed;
  }

  pause(): void {
    this.update(); // 현재까지의 시간 반영
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.lastRealTime = Date.now();
  }

  togglePause(): void {
    if (this.paused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  getIsPaused(): boolean {
    return this.paused;
  }
}
