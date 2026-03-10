import axios, { AxiosInstance, AxiosResponse } from 'axios';

// API Base URL - can be overridden by environment variable
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Create axios instance with default configuration
const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Request interceptor for adding auth token
api.interceptors.request.use(
  (config) => {
    // Add auth token if available (client-side only)
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('authToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle common errors
    if (error.response?.status === 401) {
      // Unauthorized - clear token and redirect to login
      if (typeof window !== 'undefined') {
        localStorage.removeItem('authToken');
        // Optionally redirect to login page
        // window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ============================================
// Auth API
// ============================================
export const login = (email: string, password: string): Promise<AxiosResponse> =>
  api.post('/api/auth/login', { email, password });

export const register = (
  email: string,
  password: string,
  nickname: string
): Promise<AxiosResponse> =>
  api.post('/api/auth/register', { email, password, nickname });

export const logout = (): Promise<AxiosResponse> =>
  api.post('/api/auth/logout');

// ============================================
// MiniHompi API
// ============================================
export const getHompi = (userId: string): Promise<AxiosResponse> =>
  api.get(`/api/minihompi/${userId}`);

export const getHompiByUsername = (username: string): Promise<AxiosResponse> =>
  api.get(`/api/minihompi/u/${username}`);

export const visitHompi = (userId: string): Promise<AxiosResponse> =>
  api.post(`/api/minihompi/${userId}/visit`);

export const visitHompiByUsername = (username: string): Promise<AxiosResponse> =>
  api.post(`/api/minihompi/u/${username}/visit`);

export const updateHompiSettings = (
  userId: string,
  settings: Record<string, unknown>
): Promise<AxiosResponse> =>
  api.patch(`/api/minihompi/${userId}/settings`, settings);

// ============================================
// Diary API
// ============================================
export const getDiaries = (userId: string): Promise<AxiosResponse> =>
  api.get(`/api/diary/${userId}`);

export const getDiary = (userId: string, diaryId: string): Promise<AxiosResponse> =>
  api.get(`/api/diary/${userId}/${diaryId}`);

export const createDiary = (
  userId: string,
  title: string,
  content: string
): Promise<AxiosResponse> =>
  api.post(`/api/diary/${userId}`, { title, content });

export const updateDiary = (
  userId: string,
  diaryId: string,
  title: string,
  content: string
): Promise<AxiosResponse> =>
  api.put(`/api/diary/${userId}/${diaryId}`, { title, content });

export const deleteDiary = (userId: string, diaryId: string): Promise<AxiosResponse> =>
  api.delete(`/api/diary/${userId}/${diaryId}`);

// ============================================
// Photo API
// ============================================
export const getPhotos = (userId: string): Promise<AxiosResponse> =>
  api.get(`/api/photos/${userId}`);

export const getPhoto = (userId: string, photoId: string): Promise<AxiosResponse> =>
  api.get(`/api/photos/${userId}/${photoId}`);

export const uploadPhoto = (userId: string, formData: FormData): Promise<AxiosResponse> =>
  api.post(`/api/photos/${userId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

export const deletePhoto = (userId: string, photoId: string): Promise<AxiosResponse> =>
  api.delete(`/api/photos/${userId}/${photoId}`);

// ============================================
// Guestbook API
// ============================================
export const getGuestbook = (userId: string): Promise<AxiosResponse> =>
  api.get(`/api/guestbook/${userId}`);

export const writeGuestbook = (
  userId: string,
  nickname: string,
  content: string
): Promise<AxiosResponse> =>
  api.post(`/api/guestbook/${userId}`, { nickname, content });

export const deleteGuestbookEntry = (
  userId: string,
  entryId: string
): Promise<AxiosResponse> =>
  api.delete(`/api/guestbook/${userId}/${entryId}`);

// ============================================
// Users API
// ============================================
export const getUsers = (): Promise<AxiosResponse> =>
  api.get('/api/users');

export const getUser = (userId: string): Promise<AxiosResponse> =>
  api.get(`/api/users/${userId}`);

export const updateUser = (
  userId: string,
  userData: Record<string, unknown>
): Promise<AxiosResponse> =>
  api.patch(`/api/users/${userId}`, userData);

// ============================================
// Friends API
// ============================================
export const getFriends = (userId: number): Promise<AxiosResponse> =>
  api.get(`/api/friends?user_id=${userId}`);

export const addFriend = (userId: number, friendId: number): Promise<AxiosResponse> =>
  api.post('/api/friends', { user_id: userId, friend_id: friendId });

export const removeFriend = (userId: number, friendId: number): Promise<AxiosResponse> =>
  api.delete(`/api/friends/${friendId}?user_id=${userId}`);

// ============================================
// BGM API
// ============================================
export const getBgmList = (): Promise<AxiosResponse> =>
  api.get('/api/bgm');

export const setBgm = (userId: string, bgmId: string): Promise<AxiosResponse> =>
  api.post(`/api/minihompi/${userId}/bgm`, { bgm_id: bgmId });

// Export the axios instance for custom requests
export default api;
