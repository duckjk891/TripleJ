#!/usr/bin/env python3
"""
AIMU Platform API v2.0 - Comprehensive Test Script

Tests all endpoints against a running server at http://localhost:8001.
Requires: PostgreSQL, MongoDB, Redis, MinIO running via docker-compose.

Usage: python test_api.py
"""

import io
import struct
import sys
import uuid
import wave
import zlib

import requests

BASE_URL = "http://localhost:8001"
RESULTS = []
TOKEN = None
USER_ID = None
TEST_EMAIL = f"tester_{uuid.uuid4().hex[:8]}@test.com"
TEST_PASSWORD = "testpass123"
TEST_NICKNAME = "TestUser"

# Store IDs for cross-test references
CREATED_TRACK_ID = None
SECOND_USER_TOKEN = None
SECOND_USER_ID = None


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
        w.writeframes(b"\x00\x00" * 22050)
    buf.seek(0)
    return buf


def create_test_png():
    """Create a minimal 1x1 red PNG file in memory."""
    def _chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw_row = b"\x00\xff\x00\x00"
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


def test_register_second_user():
    """Register a second user for follow tests."""
    global SECOND_USER_TOKEN, SECOND_USER_ID
    print("\n[2c] Auth - Register second user")
    email2 = f"tester2_{uuid.uuid4().hex[:8]}@test.com"
    r = post("/api/auth/register", json={
        "email": email2,
        "password": TEST_PASSWORD,
        "nickname": "TestUser2",
    })
    ok = r.status_code == 201
    data = r.json()
    if ok and "token" in data:
        SECOND_USER_TOKEN = data["token"]
        SECOND_USER_ID = data.get("user", {}).get("id")
        log("POST /api/auth/register (user2)", True, r.status_code, f"user_id={SECOND_USER_ID}")
    else:
        log("POST /api/auth/register (user2)", False, r.status_code, str(data))


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


# --- Tracks (v2.0, replaces songs) ---

def test_upload_track():
    """POST /api/tracks/upload"""
    global CREATED_TRACK_ID
    print("\n[5] Track - Upload")
    wav = create_test_wav()
    files = {"file": ("test_track.wav", wav, "audio/wav")}
    data = {
        "title": "TestTrack",
        "genre": "록,인디",
        "mood": "강렬한",
        "tags": "테스트,자동화",
    }

    r = requests.post(
        f"{BASE_URL}/api/tracks/upload",
        files=files,
        data=data,
        headers=auth_headers(),
        timeout=30,
    )
    ok = r.status_code == 201
    rdata = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    CREATED_TRACK_ID = rdata.get("id") if ok else None
    log("POST /api/tracks/upload", ok, r.status_code, f"track_id={CREATED_TRACK_ID}")
    return CREATED_TRACK_ID


def test_list_tracks():
    print("\n[6] Track - List")
    r = get("/api/tracks")
    ok = r.status_code == 200 and "tracks" in r.json()
    data = r.json()
    log("GET /api/tracks", ok, r.status_code, f"count={len(data.get('tracks', []))}")


def test_list_tracks_genre_filter():
    print("\n[6b] Track - List with genre filter")
    r = get("/api/tracks", params={"genre": "록"})
    ok = r.status_code == 200
    data = r.json()
    log("GET /api/tracks?genre=록", ok, r.status_code, f"count={len(data.get('tracks', []))}")


def test_search_tracks():
    print("\n[7] Track - Search")
    r = get("/api/tracks/search", params={"q": "Test"})
    ok = r.status_code == 200 and "tracks" in r.json()
    log("GET /api/tracks/search?q=Test", ok, r.status_code, f"count={len(r.json().get('tracks', []))}")


def test_search_tracks_empty():
    print("\n[7b] Track - Search empty query")
    r = get("/api/tracks/search")
    ok = r.status_code == 400
    log("GET /api/tracks/search (no q)", ok, r.status_code)


def test_get_track(track_id):
    print("\n[8] Track - Get by ID")
    r = get(f"/api/tracks/{track_id}")
    ok = r.status_code == 200 and r.json().get("id") == track_id
    log(f"GET /api/tracks/{track_id}", ok, r.status_code)


def test_get_track_not_found():
    print("\n[8b] Track - Get non-existent")
    fake_id = "000000000000000000000000"
    r = get(f"/api/tracks/{fake_id}")
    ok = r.status_code == 404
    log("GET /api/tracks/{fake_id}", ok, r.status_code)


def test_stream_track(track_id):
    """GET /api/tracks/stream/{track_id} - returns presigned URL."""
    print("\n[9] Track - Stream (presigned URL)")
    r = get(f"/api/tracks/stream/{track_id}")
    ok = r.status_code == 200 and "stream_url" in r.json()
    log(f"GET /api/tracks/stream/{track_id}", ok, r.status_code)


# --- Likes ---

def test_like_track(track_id):
    print("\n[10] Like - Add")
    r = post(f"/api/likes/{track_id}", headers=auth_headers())
    ok = r.status_code == 201
    log(f"POST /api/likes/{track_id}", ok, r.status_code)


def test_like_check(track_id):
    print("\n[11] Like - Check")
    r = get("/api/likes/check", params={"song_ids": track_id}, headers=auth_headers())
    ok = r.status_code == 200
    data = r.json() if ok else {}
    liked_ids = data.get("liked_ids", [])
    has_track = track_id in liked_ids
    log("GET /api/likes/check (liked)", ok and has_track, r.status_code,
        f"liked_ids={liked_ids}")


def test_unlike_track(track_id):
    print("\n[12] Like - Remove")
    r = delete(f"/api/likes/{track_id}", headers=auth_headers())
    ok = r.status_code == 200
    log(f"DELETE /api/likes/{track_id}", ok, r.status_code)


def test_like_check_after_unlike(track_id):
    print("\n[13] Like - Check after unlike")
    r = get("/api/likes/check", params={"song_ids": track_id}, headers=auth_headers())
    ok = r.status_code == 200
    data = r.json() if ok else {}
    liked_ids = data.get("liked_ids", [])
    not_liked = track_id not in liked_ids
    log("GET /api/likes/check (unliked)", ok and not_liked, r.status_code)


def test_likes_list():
    print("\n[13b] Like - List")
    r = get("/api/likes", headers=auth_headers())
    ok = r.status_code == 200 and "likes" in r.json()
    log("GET /api/likes", ok, r.status_code)


# --- Playlists ---

def test_create_playlist():
    print("\n[14] Playlist - Create")
    r = post("/api/playlists", json={
        "title": "TestPlaylist",
        "is_public": True,
    }, headers=auth_headers())
    ok = r.status_code == 201
    data = r.json()
    pl_id = data.get("id") if ok else None
    log("POST /api/playlists", ok, r.status_code, f"playlist_id={pl_id}")
    return pl_id


def test_add_track_to_playlist(pl_id, track_id):
    print("\n[15] Playlist - Add track")
    r = post(f"/api/playlists/{pl_id}/tracks", json={"track_id": track_id}, headers=auth_headers())
    ok = r.status_code == 201
    log(f"POST /api/playlists/{pl_id}/tracks", ok, r.status_code)


def test_get_playlist(pl_id, expected_track_id):
    print("\n[16] Playlist - Get (with tracks)")
    r = get(f"/api/playlists/{pl_id}", headers=auth_headers())
    ok = r.status_code == 200
    data = r.json() if ok else {}
    tracks = data.get("tracks", [])
    has_track = any(t.get("id") == expected_track_id for t in tracks)
    log(f"GET /api/playlists/{pl_id}", ok and has_track, r.status_code,
        f"tracks count={len(tracks)}")


def test_list_playlists():
    print("\n[17] Playlist - List")
    r = get("/api/playlists", headers=auth_headers())
    ok = r.status_code == 200 and isinstance(r.json(), list)
    log("GET /api/playlists", ok, r.status_code)


def test_playlists_no_auth():
    print("\n[17b] Playlist - No auth")
    r = get("/api/playlists")
    ok = r.status_code == 401
    log("GET /api/playlists (no token)", ok, r.status_code)


# --- Image Upload ---

def test_upload_cover_image(track_id):
    """POST /api/upload/image (cover type)"""
    print("\n[18] Image - Upload cover")
    png = create_test_png()
    files = {"file": ("cover.png", png, "image/png")}
    data = {"type": "cover", "id": track_id}

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
    log("POST /api/upload/image (cover)", ok, r.status_code, f"url={'yes' if url else 'no'}")


# --- Charts ---

def test_charts_top100():
    print("\n[19] Charts - Top 100 (daily)")
    r = get("/api/charts/top100")
    ok = r.status_code == 200 and isinstance(r.json(), list)
    log("GET /api/charts/top100", ok, r.status_code, f"count={len(r.json())}")


def test_charts_top100_weekly():
    print("\n[19b] Charts - Top 100 (weekly)")
    r = get("/api/charts/top100", params={"chart_type": "weekly"})
    ok = r.status_code == 200 and isinstance(r.json(), list)
    log("GET /api/charts/top100?chart_type=weekly", ok, r.status_code)


def test_charts_genre():
    print("\n[20] Charts - Genre")
    r = get("/api/charts/genre/댄스")
    ok = r.status_code == 200 and isinstance(r.json(), list)
    log("GET /api/charts/genre/댄스", ok, r.status_code, f"count={len(r.json())}")


# --- Artists (v2.0: creators) ---

def test_list_artists():
    print("\n[21] Artists (Creators) - List")
    r = get("/api/artists")
    ok = r.status_code == 200 and "artists" in r.json()
    log("GET /api/artists", ok, r.status_code, f"count={len(r.json().get('artists', []))}")


def test_get_artist():
    print("\n[22] Artists (Creators) - Get by ID")
    if not USER_ID:
        log("GET /api/artists/{id}", False, msg="No USER_ID")
        return
    r = get(f"/api/artists/{USER_ID}")
    ok = r.status_code == 200 and r.json().get("id") == USER_ID
    log(f"GET /api/artists/{USER_ID}", ok, r.status_code)


def test_get_artist_tracks():
    print("\n[23] Artists (Creators) - Tracks")
    if not USER_ID:
        log("GET /api/artists/{id}/tracks", False, msg="No USER_ID")
        return
    r = get(f"/api/artists/{USER_ID}/tracks")
    ok = r.status_code == 200 and isinstance(r.json(), list)
    log(f"GET /api/artists/{USER_ID}/tracks", ok, r.status_code, f"count={len(r.json())}")


# --- Follows ---

def test_follow_user():
    print("\n[24] Follow - Follow user")
    if not SECOND_USER_ID:
        log("POST /api/follows/{id}", False, msg="No second user")
        return
    r = post(f"/api/follows/{SECOND_USER_ID}", headers=auth_headers())
    ok = r.status_code == 201
    log(f"POST /api/follows/{SECOND_USER_ID}", ok, r.status_code)


def test_follow_self():
    print("\n[24b] Follow - Follow self")
    if not USER_ID:
        log("POST /api/follows/{id} (self)", False, msg="No USER_ID")
        return
    r = post(f"/api/follows/{USER_ID}", headers=auth_headers())
    ok = r.status_code == 400
    log("POST /api/follows/{id} (self)", ok, r.status_code)


def test_follow_duplicate():
    print("\n[24c] Follow - Duplicate follow")
    if not SECOND_USER_ID:
        log("POST /api/follows/{id} (dup)", False, msg="No second user")
        return
    r = post(f"/api/follows/{SECOND_USER_ID}", headers=auth_headers())
    ok = r.status_code == 409
    log("POST /api/follows/{id} (duplicate)", ok, r.status_code)


def test_get_following():
    print("\n[25] Follow - Following list")
    r = get("/api/follows/following", headers=auth_headers())
    ok = r.status_code == 200 and "following" in r.json()
    data = r.json() if ok else {}
    log("GET /api/follows/following", ok, r.status_code, f"count={len(data.get('following', []))}")


def test_get_followers():
    print("\n[26] Follow - Followers list (from user2's perspective)")
    r = get("/api/follows/followers", headers=auth_headers(SECOND_USER_TOKEN))
    ok = r.status_code == 200 and "followers" in r.json()
    data = r.json() if ok else {}
    log("GET /api/follows/followers", ok, r.status_code, f"count={len(data.get('followers', []))}")


def test_unfollow_user():
    print("\n[27] Follow - Unfollow")
    if not SECOND_USER_ID:
        log("DELETE /api/follows/{id}", False, msg="No second user")
        return
    r = delete(f"/api/follows/{SECOND_USER_ID}", headers=auth_headers())
    ok = r.status_code == 200
    log(f"DELETE /api/follows/{SECOND_USER_ID}", ok, r.status_code)


# --- Logout ---

def test_logout():
    print("\n[28] Auth - Logout")
    r = post("/api/auth/logout", headers=auth_headers())
    ok = r.status_code == 200
    log("POST /api/auth/logout", ok, r.status_code)


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

def cleanup_playlist(pl_id):
    if pl_id:
        delete(f"/api/playlists/{pl_id}", headers=auth_headers())


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("  AIMU Platform API v2.0 Test Suite")
    print(f"  Server: {BASE_URL}")
    print(f"  Test user: {TEST_EMAIL}")
    print("=" * 60)

    # --- Health ---
    if not test_health():
        print("\n*** Server is not running. Aborting. ***")
        sys.exit(1)

    # --- Auth flow ---
    if not test_register():
        print("\n*** Registration failed. Cannot continue. ***")
        sys.exit(1)

    test_register_duplicate()
    test_register_second_user()
    test_login()
    test_login_wrong_password()
    test_me()
    test_me_no_token()

    # --- Track upload ---
    track_id = test_upload_track()
    if not track_id:
        print("\n*** Track upload failed. Some tests will be skipped. ***")

    # --- Track listing/search ---
    test_list_tracks()
    test_list_tracks_genre_filter()
    test_search_tracks()
    test_search_tracks_empty()

    if track_id:
        test_get_track(track_id)
        test_stream_track(track_id)
    test_get_track_not_found()

    # --- Like flow ---
    if track_id:
        test_like_track(track_id)
        test_like_check(track_id)
        test_unlike_track(track_id)
        test_like_check_after_unlike(track_id)
    test_likes_list()

    # --- Playlist flow ---
    pl_id = test_create_playlist()
    if pl_id and track_id:
        test_add_track_to_playlist(pl_id, track_id)
        test_get_playlist(pl_id, track_id)
    test_list_playlists()
    test_playlists_no_auth()

    # --- Image upload ---
    if track_id:
        test_upload_cover_image(track_id)

    # --- Charts ---
    test_charts_top100()
    test_charts_top100_weekly()
    test_charts_genre()

    # --- Artists (Creators) ---
    test_list_artists()
    test_get_artist()
    test_get_artist_tracks()

    # --- Follows ---
    test_follow_user()
    test_follow_self()
    test_follow_duplicate()
    test_get_following()
    test_get_followers()
    test_unfollow_user()

    # --- Logout ---
    test_logout()

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
