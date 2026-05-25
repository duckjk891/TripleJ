import { Platform } from 'react-native';
import api from './api';

export const getVoiceModels = async () => {
  const response = await api.get('/kits/voice-models');
  return response.data;
};

export const uploadVoiceReference = async (fileUri: string, fileName: string) => {
  const formData = new FormData();
  if (Platform.OS === 'web') {
    // web: 표준 Web FormData는 Blob/File 객체만 받음
    const res = await fetch(fileUri);
    const blob = await res.blob();
    formData.append('file', blob, fileName);
  } else {
    // native: RN 확장 문법
    formData.append('file', {
      uri: fileUri,
      name: fileName,
      type: 'audio/mpeg',
    } as any);
  }

  const response = await api.post('/voice/upload', formData, {
    // web에서는 boundary 자동 추가되도록 헤더 미지정
    headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};
