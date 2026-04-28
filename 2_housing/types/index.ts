export type DirectorType = 'artist' | 'lyricist' | 'composer' | 'image' | 'video';

export interface Director {
  id: string;
  name: string;
  role: string;
  portrait: any;
  sprite: any;
}

export interface DialogueChoice {
  text: string;
  next: number;
  action?: string;
}

export interface DialogueNode {
  id: number;
  speaker: string;
  text: string;
  choices?: DialogueChoice[];
  next?: number;
  action?: string;
}

export interface LyricsParams {
  genre: string;
  mood: string;
  content: string;
  tempo: string;
  language: string;
  duration: number;
  hasRap: boolean;
}

export interface MusicParams {
  lyrics: string;
  title?: string;
  genre: string;
  mood: string;
  tempo: string;
  vocal: string;
  vocalStyle: string;
  model: 'suno' | 'wondera';
  referenceFile?: string;
  style?: string;
  referenceStyle?: string;
  bpm?: string;
  musicalKey?: string;
  negativeTags?: string;
  personaModel?: '' | 'style' | 'voice';
  isDuet?: boolean;
  subVocal?: string;
  subVocalStyle?: string;
}

export type GenerationStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed';

export interface GenerationResult {
  id: string;
  status: GenerationStatus;
  resultUrl?: string;
  error?: string;
  progress?: number;
}
