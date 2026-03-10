# Music Platform

Korean music streaming platform with chart rankings, album browsing, artist pages, playlists, and song search.

## Tech Stack

**Backend**
- Python 3.8+ (FastAPI + Uvicorn)
- SQLite
- JWT authentication (PyJWT) + bcrypt password hashing

**Frontend**
- React + React Router
- Vite
- Axios
- react-icons

## Getting Started

### Prerequisites
- Python 3.8+
- Node.js 18+

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

Server starts at `http://localhost:4000`. Database is auto-created and seeded with sample data on first run.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Dev server starts at `http://localhost:3001`.

For production build:

```bash
npm run build
npm run preview
```

## API Endpoints

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/charts/top100` | TOP 100 daily chart |
| GET | `/api/charts/genre/:genre` | Genre chart |
| GET | `/api/songs` | Song list (pagination, genre filter) |
| GET | `/api/songs/search?q=keyword` | Search songs by title or artist |
| GET | `/api/songs/:id` | Song detail |
| GET | `/api/albums` | Album list |
| GET | `/api/albums/latest` | Latest albums |
| GET | `/api/albums/:id` | Album detail with tracks |
| GET | `/api/artists` | Artist list |
| GET | `/api/artists/:id` | Artist detail |
| GET | `/api/artists/:id/albums` | Artist albums |
| GET | `/api/artists/:id/songs` | Artist top songs |
| POST | `/api/auth/register` | Register (`email`, `password`, `nickname`) |
| POST | `/api/auth/login` | Login (`email`, `password`) |

### Authenticated (Bearer token required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/me` | Current user info |
| GET | `/api/likes` | My liked songs |
| POST | `/api/likes/:songId` | Like a song |
| DELETE | `/api/likes/:songId` | Unlike a song |
| GET | `/api/playlists` | My playlists |
| POST | `/api/playlists` | Create playlist |
| GET | `/api/playlists/:id` | Playlist detail |
| PUT | `/api/playlists/:id` | Update playlist |
| DELETE | `/api/playlists/:id` | Delete playlist |
| POST | `/api/playlists/:id/songs` | Add song to playlist |
| DELETE | `/api/playlists/:id/songs/:songId` | Remove song from playlist |

## Pages

- **Main** - Featured charts, latest albums, popular artists
- **Chart** - TOP 100 with rank display
- **Search** - Song/artist search
- **Album Detail** - Album info with track list
- **Artist Detail** - Artist profile with albums and top songs
- **Playlist** - User playlists management
- **Login / Register** - Authentication

## Sample Accounts

| Email | Password |
|-------|----------|
| test@test.com | password123 |
| test2@test.com | password123 |
