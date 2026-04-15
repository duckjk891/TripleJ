import api from './api';

export const getVoiceModels = async () => {
  const response = await api.get('/kits/voice-models');
  return response.data;
};

export const uploadVoiceReference = async (fileUri: string, fileName: string) => {
  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: 'audio/mpeg',
  } as any);

  const response = await api.post('/voice/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};
