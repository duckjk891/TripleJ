'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { GameBridge } from '@/components/game/bridge/GameBridge';
import type {
  SimulationActionMessage,
  SimulationConversationMessage,
  SimulationReflectionMessage,
  SimulationTimeMessage,
} from '@/components/game/services/websocket';
import './ActivityLog.css';

interface LogEntry {
  id: number;
  type: 'action' | 'conversation' | 'reflection' | 'system';
  agentName: string;
  content: string;
  timestamp: string;
}

const AGENT_COLORS = [
  '#e6577e', '#5b8def', '#e5a135', '#43b581',
  '#9b59b6', '#e67e22', '#1abc9c', '#e74c3c',
  '#3498db', '#2ecc71', '#f39c12', '#8e44ad',
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getAgentColor(name: string): string {
  return AGENT_COLORS[hashName(name) % AGENT_COLORS.length];
}

let nextId = 1;

function ActivityLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const gameTimeRef = useRef('09:00');

  const addEntry = useCallback((entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
    setEntries((prev) => {
      const newEntries = [...prev, { ...entry, id: nextId++, timestamp: gameTimeRef.current }];
      // Keep last 200 entries
      if (newEntries.length > 200) {
        return newEntries.slice(-200);
      }
      return newEntries;
    });
  }, []);

  // Auto-scroll logic
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
    };

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  // Subscribe to GameBridge events
  useEffect(() => {
    const bridge = GameBridge.getInstance();

    const unsubAction = bridge.onSimulationAction((msg: SimulationActionMessage) => {
      const name = msg.agent_name || msg.agent_id;
      const location = msg.location ? `(${msg.location}) ` : '';
      addEntry({
        type: 'action',
        agentName: name,
        content: `${location}${msg.action || msg.action_type}`,
      });
    });

    const unsubConversation = bridge.onSimulationConversation((msg: SimulationConversationMessage) => {
      // Add conversation separator
      const agentNames = msg.agents.map((a) => a.name).join(', ');
      addEntry({
        type: 'system',
        agentName: '',
        content: `${agentNames} 대화 시작`,
      });

      // Add each dialogue turn as individual entry
      for (const turn of msg.dialogue) {
        addEntry({
          type: 'conversation',
          agentName: turn.speaker,
          content: turn.text,
        });
      }
    });

    const unsubReflection = bridge.onSimulationReflection((msg: SimulationReflectionMessage) => {
      const name = msg.agent_name || msg.agent_id;
      for (const text of msg.reflections || []) {
        addEntry({
          type: 'reflection',
          agentName: name,
          content: text,
        });
      }
    });

    const unsubTime = bridge.onSimulationTime((msg: SimulationTimeMessage) => {
      const h = String(msg.hour).padStart(2, '0');
      const m = String(msg.minute).padStart(2, '0');
      gameTimeRef.current = `${h}:${m}`;
    });

    return () => {
      unsubAction();
      unsubConversation();
      unsubReflection();
      unsubTime();
    };
  }, [addEntry]);

  return (
    <div className="activity-log">
      <div className="activity-log-header">
        <span className="activity-log-title">활동 기록</span>
        <span className="activity-log-count">{entries.length}</span>
      </div>
      <div className="activity-log-body" ref={scrollRef}>
        {entries.length === 0 && (
          <div className="activity-log-empty">
            시뮬레이션을 시작하면 활동 기록이 여기에 표시됩니다.
          </div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className={`log-entry log-entry--${entry.type}`}>
            {entry.type === 'system' ? (
              <div className="log-system">{entry.content}</div>
            ) : (
              <>
                <div className="log-entry-header">
                  <span
                    className="log-agent-name"
                    style={{ color: getAgentColor(entry.agentName) }}
                  >
                    {entry.agentName}
                  </span>
                  <span className="log-time">{entry.timestamp}</span>
                </div>
                <div className="log-content">
                  {entry.type === 'reflection' && (
                    <span className="log-reflection-icon">💭 </span>
                  )}
                  {entry.content}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ActivityLog;
