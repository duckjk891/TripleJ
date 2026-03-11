#!/usr/bin/env python3
"""
Music Platform API - Comprehensive Test Script
Tests all new and existing endpoints against a running server at http://localhost:8001.
Usage: python test_api.py
"""

import sys
import uuid
import struct
import wave
import io
import zlib
import requests

BASE_URL = "http://localhost:8001"
RESULTS = []
TOKEN = None
USER_ID = None
TEST_EMAIL = f"tester_{uuid.uuid4().hex[:8]}@test.com"
TEST_PASSWORD = "testpass123"
TEST_NICKNAME = "TestUser"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log(test_name, passed, status_code=None, msg=""):
    tag = "PASS" if passed else "FAIL"
    sc = f" [{status_code}]" if status_code else ""
    detail = f" - {msg}" if msg else ""
    print(f"  [{tag}]{sc} {test_name}{detail}")
    RESULTS.append({"name": test_name, "passed": passed})


def get(path, params=None, headers=None, **kwargs):
    return requests.get(f"{BASE_URL}{path}", params=params, headers=headers, timeout=10, **kwargs)


def post(path, json=None, headers=None, **kwargs):
    return requests.post(f"{BASE_URL}{path}", json=json, headers=headers, timeout=10, **kwargs)


def put(path, json=None, headers=None):
    return requests.put(f"{BASE_URL}{path}", json=json, headers=headers, timeout=10)


def delete(path, headers=None):
    return requests.delete(f"{BASE_URL}{path}", headers=headers, timeout=10)


def auth_headers(token=None):
    t = token or TOKEN
    return {"Authorization": f"Bearer {t}"} if t else {}


def create_test_wav():
    """Create a minimal 0.5-second silent WAV file in memory."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(44100)
        w.writeframes(b"\x00\x00" * 22050)  # 0.5s silence
    buf.seek(0)
    return buf


def create_test_png():
    """Create a minimal 1x1 red PNG file in memory."""
    def _chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)  # 1x1 RGB
    raw_row = b"\x00\xff\x00\x00"  # filter=none, R=255 G=0 B=0
    idat_data = zlib.compress(raw_row)

    png = signature + _chunk(b"IHDR", ihdr_data) + _chunk(b"IDAT", idat_data) + _chunk(b"IEND", b"")
    return io.BytesIO(png)


# ---------------------------------------------------------------------------
# Test groups
# ---------------------------------------------------------------------------

def test_health():
    print("\n[1] Health Check")
    try:
        r = get("/api/health")
        ok = r.status_code == 200 and r.json().get("status") == "ok"
        log("GET /api/health", ok, r.status_code)
        return ok
    except requests.ConnectionError:
        log("GET /api/health", False, msg="Server not reachable")
        return False


def test_register():
    global TOKEN, USER_ID
    print("\n[2] Auth - Register")
    r = post("/api/auth/register", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
        "nickname": TEST_NICKNAME,
    })
    ok = r.status_code == 201
    data = r.json()
    if ok and "token" in data:
        TOKEN = data["token"]
        USER_ID = data.get("user", {}).get("id")
        log("POST /api/auth/register", True, r.status_code, f"user_id={USER_ID}")
    else:
        log("POST /api/auth/register", False, r.status_code, str(data))
    return ok


def test_register_duplicate():
    print("\n[2b] Auth - Register duplicate")
    r = post("/api/auth/register", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
        "nickname": TEST_NICKNAME,
    })
    ok = r.status_code == 409
    log("POST /api/auth/register (duplicate)", ok, r.status_code)


def test_login():
    global TOKEN
    print("\n[3] Auth - Login")
    r = post("/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
    })
    ok = r.status_code == 200
    data = r.json()
    if ok and "token" in data:
        TOKEN = data["token"]
        log("POST /api/auth/login", True, r.status_code)
    else:
        log("POST /api/auth/login", False, r.status_code, str(data))


def test_login_wrong_password():
    print("\n[3b] Auth - Login wrong password")
    r = post("/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": "wrongpass",
    })
    ok = r.status_code == 401
    log("POST /api/auth/login (wrong pw)", ok, r.status_code)


def test_me():
    print("\n[4] Auth - Me")
    r = get("/api/auth/me", headers=auth_headers())
    ok = r.status_code == 200
    data = r.json()
    if ok:
        ok = data.get("email") == TEST_EMAIL
        log("GET /api/auth/me", ok, r.status_code, f"email={data.get('email')}")
    else:
        log("GET /api/auth/me", False, r.status_code, str(data))


def test_me_no_token():
    print("\n[4b] Auth - Me without token")
    r = get("/api/auth/me")
    ok = r.status_code == 401
    log("GET /api/auth/me (no token)", ok, r.status_code)


def test_create_artist():
    """NEW endpoint: POST /api/artists"""
    print("\n[5] Artist - Create")
    r = post("/api/artists", json={
        "name": "TestArtist",
        "genre": "록",
    }, headers=auth_headers())
    ok = r.status_code == 201
    data = r.json()
    artist_id = data.get("id") if ok else None
    log("POST /api/artists", ok, r.status_code, f"artist_id={artist_id}")
    return artist_id


def test_create_album(artist_id):
    """NEW endpoint: POST /api/albums"""
    print("\n[6] Album - Create")
    r = post("/api/albums", json={
        "title": "TestAlbum",
        "artist_id": artist_id,
        "genre": "록",
    }, headers=auth_headers())
    ok = r.status_code == 201
    data = r.json()
    album_id = data.get("id") if ok else None
    log("POST /api/albums", ok, r.status_code, f"album_id={album_id}")
    return album_id


def test_upload_song(artist_id, album_id):
    """NEW endpoint: POST /api/songs/upload"""
    print("\n[7] Song - Upload")
    wav = create_test_wav()
    files = {"file": ("test_song.wav", wav, "audio/wav")}
    data = {
        "title": "TestSong",
        "artist_id": str(artist_id),
    }
    if album_id:
        data["album_id"] = str(album_id)

    r = requests.post(
        f"{BASE_URL}/api/songs/upload",
        files=files,
        data=data,
        headers=auth_headers(),
        timeout=30,
    )
    ok = r.status_code == 201
    rdata = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    song_id = rdata.get("id") if ok else None
    log("POST /api/songs/upload", ok, r.status_code, f"song_id={song_id}")
    return song_id


def test_stream_song(song_id):
    """NEW endpoint: GET /api/songs/stream/{song_id}"""
    print("\n[8] Song - Stream")
    r = get(f"/api/songs/stream/{song_id}", stream=True)
    ct = r.headers.get("content-type", "")
    ok = r.status_code == 200 and "audio" in ct
    log("GET /api/songs/stream/{song_id}", ok, r.status_code, f"Content-Type={ct}")
    r.close()


def test_like_song(song_id):
    print("\n[9] Like - Add")
    r = post(f"/api/likes/{song_id}", headers=auth_headers())
    ok = r.status_code == 201
    log(f"POST /api/likes/{song_id}", ok, r.status_code)


def test_like_check(song_id):
    """NEW endpoint: GET /api/likes/check"""
    print("\n[10] Like - Check")
    r = get("/api/likes/check", params={"song_ids": song_id}, headers=auth_headers())
    ok = r.status_code == 200
    data = r.json() if ok else {}
    liked_ids = data.get("liked_ids", [])
    has_song = song_id in liked_ids
    log("GET /api/likes/check (liked)", ok and has_song, r.status_code,
        f"liked_ids={liked_ids}, expected {song_id} in list")


def test_unlike_song(song_id):
    print("\n[11] Like - Remove")
    r = delete(f"/api/likes/{song_id}", headers=auth_headers())
    ok = r.status_code == 200
    log(f"DELETE /api/likes/{song_id}", ok, r.status_code)


def test_like_check_after_unlike(song_id):
    """Verify song is no longer liked."""
    print("\n[12] Like - Check after unlike")
    r = get("/api/likes/check", params={"song_ids": song_id}, headers=auth_headers())
    ok = r.status_code == 200
    data = r.json() if ok else {}
    liked_ids = data.get("liked_ids", [])
    not_liked = song_id not in liked_ids
    log("GET /api/likes/check (unliked)", ok and not_liked, r.status_code,
        f"liked_ids={liked_ids}, expected empty")


def test_create_playlist():
    print("\n[13] Playlist - Create")
    r = post("/api/playlists", json={
        "title": "TestPlaylist",
        "description": "Test description",
        "is_public": True,
    }, headers=auth_headers())
    ok = r.status_code == 201
    data = r.json()
    pl_id = data.get("id") if ok else None
    log("POST /api/playlists", ok, r.status_code, f"playlist_id={pl_id}")
    return pl_id


def test_add_song_to_playlist(pl_id, song_id):
    print("\n[14] Playlist - Add song")
    r = post(f"/api/playlists/{pl_id}/songs", json={"song_id": song_id}, headers=auth_headers())
    ok = r.status_code == 201
    log(f"POST /api/playlists/{pl_id}/songs", ok, r.status_code)


def test_get_playlist(pl_id, expected_song_id):
    print("\n[15] Playlist - Get (with songs)")
    r = get(f"/api/playlists/{pl_id}", headers=auth_headers())
    ok = r.status_code == 200
    data = r.json() if ok else {}
    songs = data.get("songs", [])
    has_song = any(s.get("id") == expected_song_id for s in songs)
    log(f"GET /api/playlists/{pl_id}", ok and has_song, r.status_code,
        f"songs count={len(songs)}, has expected song={has_song}")


def test_upload_image(album_id):
    """NEW endpoint: POST /api/upload/image"""
    print("\n[16] Image - Upload")
    png = create_test_png()
    files = {"file": ("test.png", png, "image/png")}
    data = {"type": "album", "id": str(album_id)}

    r = requests.post(
        f"{BASE_URL}/api/upload/image",
        files=files,
        data=data,
        headers=auth_headers(),
        timeout=10,
    )
    ok = r.status_code == 201
    rdata = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    url = rdata.get("file_url", "")
    log("POST /api/upload/image", ok, r.status_code, f"file_url={url}")


# ---------------------------------------------------------------------------
# Existing API regression tests
# ---------------------------------------------------------------------------

def test_existing_apis():
    print("\n=== Existing API Regression Tests ===")

    # Songs
    print("\n[R1] Songs - List")
    r = get("/api/songs")
    ok = r.status_code == 200 and "songs" in r.json()
    log("GET /api/songs", ok, r.status_code)

    print("\n[R2] Songs - List with genre filter")
    r = get("/api/songs", params={"genre": "발라드"})
    ok = r.status_code == 200
    data = r.json()
    if ok and data.get("songs"):
        all_ballad = all(s.get("genre") == "발라드" for s in data["songs"])
        log("GET /api/songs?genre=발라드", all_ballad, r.status_code, f"count={len(data['songs'])}")
    else:
        log("GET /api/songs?genre=발라드", ok, r.status_code)

    print("\n[R3] Songs - Search")
    r = get("/api/songs/search", params={"q": "Shine"})
    ok = r.status_code == 200 and "songs" in r.json()
    log("GET /api/songs/search?q=Shine", ok, r.status_code, f"count={len(r.json().get('songs', []))}")

    print("\n[R4] Songs - Search empty query")
    r = get("/api/songs/search")
    ok = r.status_code == 400
    log("GET /api/songs/search (no q)", ok, r.status_code)

    print("\n[R5] Songs - Get by ID")
    r = get("/api/songs/1")
    ok = r.status_code == 200 and r.json().get("id") == 1
    log("GET /api/songs/1", ok, r.status_code)

    print("\n[R6] Songs - Get non-existent")
    r = get("/api/songs/99999")
    ok = r.status_code == 404
    log("GET /api/songs/99999", ok, r.status_code)

    # Albums
    print("\n[R7] Albums - List")
    r = get("/api/albums")
    ok = r.status_code == 200 and "albums" in r.json()
    log("GET /api/albums", ok, r.status_code, f"count={len(r.json().get('albums', []))}")

    print("\n[R8] Albums - Latest")
    r = get("/api/albums/latest")
    ok = r.status_code == 200 and isinstance(r.json(), list)
    log("GET /api/albums/latest", ok, r.status_code, f"count={len(r.json())}")

    print("\n[R9] Albums - Get by ID")
    r = get("/api/albums/1")
    ok = r.status_code == 200 and "songs" in r.json()
    log("GET /api/albums/1", ok, r.status_code, f"songs={len(r.json().get('songs', []))}")

    print("\n[R10] Albums - Get non-existent")
    r = get("/api/albums/99999")
    ok = r.status_code == 404
    log("GET /api/albums/99999", ok, r.status_code)

    # Artists
    print("\n[R11] Artists - List")
    r = get("/api/artists")
    ok = r.status_code == 200 and "artists" in r.json()
    log("GET /api/artists", ok, r.status_code, f"count={len(r.json().get('artists', []))}")

    print("\n[R12] Artists - Get by ID")
    r = get("/api/artists/1")
    ok = r.status_code == 200 and r.json().get("id") == 1
    log("GET /api/artists/1", ok, r.status_code)

    print("\n[R13] Artists - Get non-existent")
    r = get("/api/artists/99999")
    ok = r.status_code == 404
    log("GET /api/artists/99999", ok, r.status_code)

    print("\n[R14] Artists - Albums")
    r = get("/api/artists/1/albums")
    ok = r.status_code == 200 and isinstance(r.json(), list)
    log("GET /api/artists/1/albums", ok, r.status_code, f"count={len(r.json())}")

    print("\n[R15] Artists - Songs")
    r = get("/api/artists/1/songs")
    ok = r.status_code == 200 and isinstance(r.json(), list)
    log("GET /api/artists/1/songs", ok, r.status_code, f"count={len(r.json())}")

    # Charts
    print("\n[R16] Charts - Top 100")
    r = get("/api/charts/top100")
    ok = r.status_code == 200 and isinstance(r.json(), list)
    log("GET /api/charts/top100", ok, r.status_code, f"count={len(r.json())}")

    print("\n[R17] Charts - Genre")
    r = get("/api/charts/genre/댄스")
    ok = r.status_code == 200 and isinstance(r.json(), list)
    log("GET /api/charts/genre/댄스", ok, r.status_code, f"count={len(r.json())}")

    # Playlists (auth required)
    print("\n[R18] Playlists - List")
    r = get("/api/playlists", headers=auth_headers())
    ok = r.status_code == 200 and isinstance(r.json(), list)
    log("GET /api/playlists", ok, r.status_code)

    print("\n[R19] Playlists - No auth")
    r = get("/api/playlists")
    ok = r.status_code == 401
    log("GET /api/playlists (no token)", ok, r.status_code)

    # Likes (auth required)
    print("\n[R20] Likes - List")
    r = get("/api/likes", headers=auth_headers())
    ok = r.status_code == 200 and "likes" in r.json()
    log("GET /api/likes", ok, r.status_code)

    print("\n[R21] Likes - No auth")
    r = get("/api/likes")
    ok = r.status_code == 401
    log("GET /api/likes (no token)", ok, r.status_code)


# ---------------------------------------------------------------------------
# Cleanup helpers
# ---------------------------------------------------------------------------

def cleanup_playlist(pl_id):
    if pl_id:
        delete(f"/api/playlists/{pl_id}", headers=auth_headers())


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("  Music Platform API Test Suite")
    print(f"  Server: {BASE_URL}")
    print(f"  Test user: {TEST_EMAIL}")
    print("=" * 60)

    # --- Health check (gate) ---
    if not test_health():
        print("\n*** Server is not running. Aborting. ***")
        sys.exit(1)

    # --- Auth flow ---
    if not test_register():
        print("\n*** Registration failed. Cannot continue. ***")
        sys.exit(1)

    test_register_duplicate()
    test_login()
    test_login_wrong_password()
    test_me()
    test_me_no_token()

    # --- New endpoints: create artist, album, upload song ---
    artist_id = test_create_artist()
    album_id = test_create_album(artist_id) if artist_id else None

    # For upload/stream tests we need valid IDs. If create failed (not yet implemented),
    # fall back to existing seed data.
    use_artist_id = artist_id or 1
    use_album_id = album_id or 1

    song_id = test_upload_song(use_artist_id, use_album_id)

    # For streaming/like/playlist tests, fall back to seed song 1 if upload not available.
    use_song_id = song_id or 1

    if song_id:
        test_stream_song(song_id)
    else:
        print("\n[8] Song - Stream (SKIPPED - upload not available, testing with seed song)")
        test_stream_song(1)

    # --- Like flow ---
    test_like_song(use_song_id)
    test_like_check(use_song_id)
    test_unlike_song(use_song_id)
    test_like_check_after_unlike(use_song_id)

    # --- Playlist flow ---
    pl_id = test_create_playlist()
    if pl_id:
        test_add_song_to_playlist(pl_id, use_song_id)
        test_get_playlist(pl_id, use_song_id)

    # --- Image upload ---
    test_upload_image(use_album_id)

    # --- Existing API regression ---
    test_existing_apis()

    # --- Cleanup ---
    cleanup_playlist(pl_id)

    # --- Summary ---
    print("\n" + "=" * 60)
    total = len(RESULTS)
    passed = sum(1 for r in RESULTS if r["passed"])
    failed = total - passed
    print(f"  TOTAL: {total}  |  PASSED: {passed}  |  FAILED: {failed}")
    print("=" * 60)

    if failed > 0:
        print("\n  Failed tests:")
        for r in RESULTS:
            if not r["passed"]:
                print(f"    - {r['name']}")

    print()
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
