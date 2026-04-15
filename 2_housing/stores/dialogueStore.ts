import { create } from 'zustand';
import { DialogueNode } from '../types';

interface DialogueState {
  currentScript: DialogueNode[];
  currentNodeIndex: number;
  history: number[];
  isActive: boolean;
  setScript: (script: DialogueNode[]) => void;
  setNodeIndex: (index: number) => void;
  advance: () => void;
  goToNode: (nodeId: number) => void;
  start: (script: DialogueNode[]) => void;
  end: () => void;
}

export const useDialogueStore = create<DialogueState>((set, get) => ({
  currentScript: [],
  currentNodeIndex: 0,
  history: [],
  isActive: false,
  setScript: (currentScript) => set({ currentScript }),
  setNodeIndex: (currentNodeIndex) => set({ currentNodeIndex }),
  advance: () => {
    const { currentScript, currentNodeIndex, history } = get();
    const currentNode = currentScript[currentNodeIndex];
    if (currentNode?.next !== undefined) {
      const nextIdx = currentScript.findIndex((n) => n.id === currentNode.next);
      if (nextIdx !== -1) {
        set({
          currentNodeIndex: nextIdx,
          history: [...history, currentNodeIndex],
        });
      }
    }
  },
  goToNode: (nodeId) => {
    const { currentScript, currentNodeIndex, history } = get();
    const idx = currentScript.findIndex((n) => n.id === nodeId);
    if (idx !== -1) {
      set({
        currentNodeIndex: idx,
        history: [...history, currentNodeIndex],
      });
    }
  },
  start: (script) =>
    set({
      currentScript: script,
      currentNodeIndex: 0,
      history: [],
      isActive: true,
    }),
  end: () =>
    set({
      isActive: false,
      currentScript: [],
      currentNodeIndex: 0,
      history: [],
    }),
}));
