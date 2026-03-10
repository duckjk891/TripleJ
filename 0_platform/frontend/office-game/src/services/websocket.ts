/**
 * WebSocket Client for office-game-api
 * Connects to the backend simulation server and dispatches events.
 */

// ── Message Types ──

export interface SimulationActionMessage {
  type: 'simulation_action';
  agent_id: string;
  action_type: string;
  action: string;
  location: string;
  position?: { x: number; y: number } | null;
}

export interface SimulationConversationMessage {
  type: 'simulation_conversation';
  agents: { id: string; name: string }[];
  dialogue: { speaker: string; text: string }[];
}

export interface SimulationReflectionMessage {
  type: 'simulation_reflection';
  agent_id: string;
  reflections: string[];
}

export interface SimulationTimeMessage {
  type: 'simulation_time';
  hour: number;
  minute: number;
  day: number;
  speed: number;
  paused: boolean;
}

export interface WorldObjectsUpdateMessage {
  type: 'world_objects_update';
  objects: { id: string; name: string; state: string }[];
}

export interface StateSyncMessage {
  type: 'state_sync';
  characters: {
    agent_id: string;
    name: string;
    action: string;
    position: { x: number; y: number };
  }[];
}

export type WSMessage =
  | SimulationActionMessage
  | SimulationConversationMessage
  | SimulationReflectionMessage
  | SimulationTimeMessage
  | WorldObjectsUpdateMessage
  | StateSyncMessage;

// ── Connection State ──

export type WSConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// ── Event Callbacks ──

export interface WSEventCallbacks {
  onSimulationAction?: (msg: SimulationActionMessage) => void;
  onSimulationConversation?: (msg: SimulationConversationMessage) => void;
  onSimulationReflection?: (msg: SimulationReflectionMessage) => void;
  onSimulationTime?: (msg: SimulationTimeMessage) => void;
  onWorldObjectsUpdate?: (msg: WorldObjectsUpdateMessage) => void;
  onStateSync?: (msg: StateSyncMessage) => void;
  onConnectionStateChange?: (state: WSConnectionState) => void;
}

// ── WebSocket Client ──

const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;

export class GameWebSocket {
  private ws: WebSocket | null = null;
  private callbacks: WSEventCallbacks = {};
  private connectionState: WSConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private url: string;

  constructor(url?: string) {
    const base = url || this.getDefaultUrl();
    // Convert http(s) to ws(s) if needed
    this.url = base.replace(/^http/, 'ws') + '/ws';
  }

  private getDefaultUrl(): string {
    if (typeof window !== 'undefined') {
      const envUrl = (window as any).__GAME_API_URL
        || (window as any).__NEXT_PUBLIC_GAME_API_URL;
      if (envUrl) return envUrl;
    }
    return 'ws://localhost:8001';
  }

  /** Register event callbacks */
  setCallbacks(callbacks: WSEventCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /** Get current connection state */
  getConnectionState(): WSConnectionState {
    return this.connectionState;
  }

  /** Connect to the WebSocket server */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.intentionalClose = false;
    this.setConnectionState('connecting');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[GameWebSocket] Connected to', this.url);
        this.reconnectAttempts = 0;
        this.setConnectionState('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;
          this.dispatchMessage(msg);
        } catch (err) {
          console.warn('[GameWebSocket] Failed to parse message:', err);
        }
      };

      this.ws.onclose = (event) => {
        console.log('[GameWebSocket] Connection closed:', event.code, event.reason);
        this.ws = null;
        if (!this.intentionalClose) {
          this.setConnectionState('reconnecting');
          this.scheduleReconnect();
        } else {
          this.setConnectionState('disconnected');
        }
      };

      this.ws.onerror = (event) => {
        console.warn('[GameWebSocket] Connection error:', event);
      };
    } catch (err) {
      console.warn('[GameWebSocket] Failed to create WebSocket:', err);
      this.setConnectionState('reconnecting');
      this.scheduleReconnect();
    }
  }

  /** Disconnect from the WebSocket server */
  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.reconnectAttempts = 0;
    this.setConnectionState('disconnected');
  }

  /** Send a JSON message */
  send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('[GameWebSocket] Cannot send, not connected');
    }
  }

  private setConnectionState(state: WSConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.callbacks.onConnectionStateChange?.(state);
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY
    );
    this.reconnectAttempts++;

    console.log(`[GameWebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionalClose) {
        this.connect();
      }
    }, delay);
  }

  private dispatchMessage(msg: WSMessage): void {
    switch (msg.type) {
      case 'simulation_action':
        this.callbacks.onSimulationAction?.(msg);
        break;
      case 'simulation_conversation':
        this.callbacks.onSimulationConversation?.(msg);
        break;
      case 'simulation_reflection':
        this.callbacks.onSimulationReflection?.(msg);
        break;
      case 'simulation_time':
        this.callbacks.onSimulationTime?.(msg);
        break;
      case 'world_objects_update':
        this.callbacks.onWorldObjectsUpdate?.(msg);
        break;
      case 'state_sync':
        this.callbacks.onStateSync?.(msg);
        break;
      default:
        console.warn('[GameWebSocket] Unknown message type:', (msg as any).type);
    }
  }
}
