import api from './api';

export const generateLyrics = async (params: {
  prompt: string;
  genre?: string;
  mood?: string;
  language?: string;
}) => {
  const response = await api.post('/generate/lyrics/', params);
  return response.data;
};
