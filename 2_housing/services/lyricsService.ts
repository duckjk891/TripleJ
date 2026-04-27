import api from './api';

export const generateLyrics = async (params: {
  prompt: string;
  genre?: string;
  mood?: string;
  language?: string;
  style?: string;
  duration_minutes?: number;
}) => {
  const response = await api.post('/generate/lyrics/', params);
  return response.data;
};
