import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Auth
export const login = (email: string, password: string) =>
  api.post('/api/auth/login', { email, password });

export const register = (email: string, password: string, nickname: string) =>
  api.post('/api/auth/register', { email, password, nickname });

// MiniHompi
export const getHompi = (userId: string) =>
  api.get(`/api/minihompi/${userId}`);

export const getHompiByUsername = (username: string) =>
  api.get(`/api/minihompi/u/${username}`);

export const visitHompi = (userId: string) =>
  api.post(`/api/minihompi/${userId}/visit`);

export const visitHompiByUsername = (username: string) =>
  api.post(`/api/minihompi/u/${username}/visit`);

// Diary
export const getDiaries = (userId: string) =>
  api.get(`/api/diary/${userId}`);

export const createDiary = (userId: string, title: string, content: string) =>
  api.post(`/api/diary/${userId}`, { title, content });

// Photo
export const getPhotos = (userId: string) =>
  api.get(`/api/photos/${userId}`);

export const uploadPhoto = (userId: string, formData: FormData) =>
  api.post(`/api/photos/${userId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

// Guestbook
export const getGuestbook = (userId: string) =>
  api.get(`/api/guestbook/${userId}`);

export const writeGuestbook = (userId: string, nickname: string, content: string) =>
  api.post(`/api/guestbook/${userId}`, { nickname, content });

// Users
export const getUsers = () =>
  api.get('/api/users');

export const getUser = (userId: string) =>
  api.get(`/api/users/${userId}`);

// Friends
export const getFriends = (userId: number) =>
  api.get(`/api/friends?user_id=${userId}`);

export default api;
