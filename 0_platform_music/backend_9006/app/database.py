import sqlite3
import os
import bcrypt
from datetime import date

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "music.db")


def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
    finally:
        db.close()


def dict_row(row):
    if row is None:
        return None
    return dict(row)


def dict_rows(rows):
    return [dict(r) for r in rows]


def init_database():
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            nickname TEXT NOT NULL,
            profile_image TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS artists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            image TEXT DEFAULT NULL,
            debut_date TEXT,
            genre TEXT,
            description TEXT
        );

        CREATE TABLE IF NOT EXISTS albums (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            artist_id INTEGER NOT NULL,
            cover_image TEXT DEFAULT NULL,
            release_date TEXT,
            genre TEXT,
            description TEXT,
            FOREIGN KEY (artist_id) REFERENCES artists(id)
        );

        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            album_id INTEGER,
            artist_id INTEGER NOT NULL,
            duration INTEGER DEFAULT 0,
            file_path TEXT DEFAULT NULL,
            lyrics TEXT DEFAULT NULL,
            play_count INTEGER DEFAULT 0,
            like_count INTEGER DEFAULT 0,
            genre TEXT,
            FOREIGN KEY (album_id) REFERENCES albums(id),
            FOREIGN KEY (artist_id) REFERENCES artists(id)
        );

        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT NULL,
            cover_image TEXT DEFAULT NULL,
            is_public INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS playlist_songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER NOT NULL,
            song_id INTEGER NOT NULL,
            order_num INTEGER DEFAULT 0,
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (song_id) REFERENCES songs(id)
        );

        CREATE TABLE IF NOT EXISTS likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            song_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, song_id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (song_id) REFERENCES songs(id)
        );

        CREATE TABLE IF NOT EXISTS charts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            song_id INTEGER NOT NULL,
            rank INTEGER NOT NULL,
            chart_type TEXT DEFAULT 'daily',
            chart_date TEXT DEFAULT (date('now')),
            FOREIGN KEY (song_id) REFERENCES songs(id)
        );
    """)

    # Seed data
    cur = db.execute("SELECT COUNT(*) FROM users")
    if cur.fetchone()[0] > 0:
        db.close()
        return

    print("Seeding database...")

    hashed = bcrypt.hashpw(b"password123", bcrypt.gensalt()).decode()
    db.execute("INSERT INTO users (email, password, nickname) VALUES (?, ?, ?)", ("test@test.com", hashed, "음악매니아"))
    db.execute("INSERT INTO users (email, password, nickname) VALUES (?, ?, ?)", ("test2@test.com", hashed, "노래사랑"))

    artists = [
        ("김하늘", "/images/artists/1.jpg", "2015-03-15", "발라드", "감성적인 목소리로 많은 사랑을 받는 발라드 가수"),
        ("박소울", "/images/artists/2.jpg", "2018-07-20", "R&B", "독보적인 음색의 R&B 아티스트"),
        ("스타빛", "/images/artists/3.jpg", "2019-01-10", "댄스", "화려한 퍼포먼스의 5인조 댄스 그룹"),
        ("이도윤", "/images/artists/4.jpg", "2016-11-05", "힙합", "리얼 힙합을 추구하는 래퍼"),
        ("달빛소녀", "/images/artists/5.jpg", "2020-03-25", "인디", "몽환적인 사운드의 인디 밴드"),
        ("정우진", "/images/artists/6.jpg", "2014-06-12", "록", "파워풀한 보컬의 록 뮤지션"),
        ("한서연", "/images/artists/7.jpg", "2017-09-30", "발라드", "섬세한 감정 표현의 싱어송라이터"),
        ("크루즈", "/images/artists/8.jpg", "2021-02-14", "힙합", "트렌디한 사운드의 힙합 듀오"),
        ("윤채린", "/images/artists/9.jpg", "2019-08-08", "댄스", "글로벌 인기의 솔로 댄스 아티스트"),
        ("블루문", "/images/artists/10.jpg", "2016-04-20", "인디", "서정적인 가사의 인디 록 밴드"),
        ("최예은", "/images/artists/11.jpg", "2022-01-15", "R&B", "차세대 R&B 디바"),
        ("파이어독", "/images/artists/12.jpg", "2018-12-01", "록", "열정적인 라이브의 4인조 록밴드"),
    ]
    for a in artists:
        db.execute("INSERT INTO artists (name, image, debut_date, genre, description) VALUES (?, ?, ?, ?, ?)", a)

    albums_and_songs = [
        # 김하늘 (1)
        {"albums": [
            {"title": "첫 번째 겨울", "artist_id": 1, "cover": "/images/albums/1.jpg", "date": "2023-12-01", "genre": "발라드", "desc": "겨울 감성을 담은 정규 1집", "songs": [
                ("눈이 오는 밤", 264, 1520000, 89000), ("겨울 고백", 238, 980000, 56000), ("너의 온도", 251, 1230000, 72000),
                ("하얀 숨결", 219, 750000, 41000), ("12월의 편지", 285, 620000, 35000),
            ]},
            {"title": "봄날의 기억", "artist_id": 1, "cover": "/images/albums/2.jpg", "date": "2024-04-15", "genre": "발라드", "desc": "봄을 테마로 한 미니앨범", "songs": [
                ("벚꽃 엔딩 스토리", 242, 2100000, 125000), ("봄바람에 실려", 228, 890000, 52000), ("꽃비", 256, 670000, 38000),
            ]},
        ]},
        # 박소울 (2)
        {"albums": [
            {"title": "Soul Wave", "artist_id": 2, "cover": "/images/albums/3.jpg", "date": "2024-02-20", "genre": "R&B", "desc": "소울풀한 R&B 정규앨범", "songs": [
                ("Midnight Soul", 234, 1780000, 98000), ("너에게로", 247, 1340000, 76000), ("Groove Tonight", 212, 920000, 54000),
                ("새벽감성", 268, 1100000, 63000), ("Stay With Me", 241, 860000, 48000), ("비가 오면", 255, 780000, 42000),
            ]},
        ]},
        # 스타빛 (3)
        {"albums": [
            {"title": "Shine On", "artist_id": 3, "cover": "/images/albums/4.jpg", "date": "2024-06-10", "genre": "댄스", "desc": "에너지 넘치는 댄스 앨범", "songs": [
                ("Shine", 198, 3200000, 210000), ("Dancing All Night", 207, 2450000, 156000), ("별빛 아래서", 215, 1890000, 112000),
                ("Fire Up", 193, 1560000, 95000), ("Together", 224, 980000, 58000),
            ]},
            {"title": "Galaxy", "artist_id": 3, "cover": "/images/albums/5.jpg", "date": "2025-01-15", "genre": "댄스", "desc": "우주를 컨셉으로 한 미니앨범", "songs": [
                ("Galaxy Express", 202, 4100000, 280000), ("Orbit", 189, 2800000, 175000), ("Supernova", 211, 2100000, 130000),
            ]},
        ]},
        # 이도윤 (4)
        {"albums": [
            {"title": "Street Poetry", "artist_id": 4, "cover": "/images/albums/6.jpg", "date": "2024-03-08", "genre": "힙합", "desc": "거리의 이야기를 담은 힙합 앨범", "songs": [
                ("거리의 시", 218, 2670000, 158000), ("Real Talk", 195, 1890000, 112000), ("새벽 3시", 232, 1540000, 89000),
                ("My Way", 204, 1230000, 72000), ("불꽃", 188, 980000, 56000), ("Respect", 226, 870000, 48000), ("꿈을 꾸다", 241, 760000, 41000),
            ]},
        ]},
        # 달빛소녀 (5)
        {"albums": [
            {"title": "달빛 아래", "artist_id": 5, "cover": "/images/albums/7.jpg", "date": "2024-08-22", "genre": "인디", "desc": "달빛을 테마로 한 데뷔 앨범", "songs": [
                ("달빛 산책", 267, 890000, 62000), ("밤의 노래", 245, 720000, 48000), ("별 헤는 밤", 278, 650000, 42000), ("은하수", 234, 540000, 35000),
            ]},
        ]},
        # 정우진 (6)
        {"albums": [
            {"title": "Rock Spirit", "artist_id": 6, "cover": "/images/albums/8.jpg", "date": "2023-09-14", "genre": "록", "desc": "록의 정수를 담은 앨범", "songs": [
                ("Thunder", 245, 1450000, 86000), ("폭풍", 232, 1120000, 68000), ("Break Free", 256, 890000, 52000),
                ("자유를 향해", 271, 780000, 45000), ("Revolution", 298, 650000, 38000),
            ]},
            {"title": "불꽃놀이", "artist_id": 6, "cover": "/images/albums/9.jpg", "date": "2024-07-04", "genre": "록", "desc": "여름 록 페스티벌 라이브 앨범", "songs": [
                ("불꽃놀이", 263, 1680000, 102000), ("Summer Rock", 228, 1230000, 75000), ("열정", 241, 980000, 58000),
            ]},
        ]},
        # 한서연 (7)
        {"albums": [
            {"title": "감정의 조각들", "artist_id": 7, "cover": "/images/albums/10.jpg", "date": "2024-05-18", "genre": "발라드", "desc": "다양한 감정을 노래한 앨범", "songs": [
                ("그리움", 272, 1950000, 118000), ("이별 후", 258, 1680000, 98000), ("사랑했던 날들", 245, 1420000, 85000),
                ("눈물", 231, 1100000, 65000), ("다시 만날 때", 264, 890000, 52000), ("위로", 248, 760000, 44000),
            ]},
        ]},
        # 크루즈 (8)
        {"albums": [
            {"title": "Cruise Control", "artist_id": 8, "cover": "/images/albums/11.jpg", "date": "2024-09-30", "genre": "힙합", "desc": "여유로운 힙합 바이브", "songs": [
                ("Cruise", 209, 1340000, 82000), ("Chill Mode", 196, 1120000, 68000), ("드라이브", 223, 890000, 52000), ("Wave", 187, 760000, 44000),
            ]},
        ]},
        # 윤채린 (9)
        {"albums": [
            {"title": "Butterfly", "artist_id": 9, "cover": "/images/albums/12.jpg", "date": "2024-11-11", "genre": "댄스", "desc": "나비처럼 화려한 댄스 앨범", "songs": [
                ("Butterfly", 201, 3800000, 245000), ("Wings", 195, 2900000, 182000), ("날아올라", 208, 2300000, 142000),
                ("Bloom", 216, 1780000, 108000), ("Fantasy", 192, 1450000, 88000), ("Queen", 204, 1200000, 72000),
                ("Power", 198, 980000, 58000), ("Dream High", 221, 850000, 48000),
            ]},
        ]},
        # 블루문 (10)
        {"albums": [
            {"title": "파란 달", "artist_id": 10, "cover": "/images/albums/13.jpg", "date": "2024-01-28", "genre": "인디", "desc": "서정적인 인디 록 앨범", "songs": [
                ("파란 달", 258, 780000, 52000), ("안녕, 오늘", 243, 650000, 42000), ("길 위에서", 267, 540000, 35000),
                ("바람의 노래", 251, 480000, 30000), ("떠나는 날", 239, 420000, 26000),
            ]},
        ]},
        # 최예은 (11)
        {"albums": [
            {"title": "Velvet Voice", "artist_id": 11, "cover": "/images/albums/14.jpg", "date": "2025-02-01", "genre": "R&B", "desc": "벨벳 같은 목소리의 R&B 앨범", "songs": [
                ("Velvet", 237, 2450000, 155000), ("Moonlight", 248, 1890000, 118000), ("촛불", 262, 1340000, 82000),
                ("Honey", 219, 1120000, 68000), ("Dreamy", 241, 890000, 54000),
            ]},
        ]},
        # 파이어독 (12)
        {"albums": [
            {"title": "Burn", "artist_id": 12, "cover": "/images/albums/15.jpg", "date": "2024-10-20", "genre": "록", "desc": "강렬한 에너지의 록 앨범", "songs": [
                ("Burn It Down", 238, 1120000, 68000), ("Rage", 215, 890000, 52000), ("전사", 248, 760000, 44000),
                ("Fight", 203, 650000, 38000), ("끝까지", 267, 540000, 32000), ("Rise Up", 229, 480000, 28000),
            ]},
        ]},
    ]

    all_songs = []
    for artist_data in albums_and_songs:
        for album in artist_data["albums"]:
            cur = db.execute(
                "INSERT INTO albums (title, artist_id, cover_image, release_date, genre, description) VALUES (?, ?, ?, ?, ?, ?)",
                (album["title"], album["artist_id"], album["cover"], album["date"], album["genre"], album["desc"]),
            )
            album_id = cur.lastrowid
            for title, dur, plays, likes in album["songs"]:
                cur2 = db.execute(
                    "INSERT INTO songs (title, album_id, artist_id, duration, file_path, lyrics, play_count, like_count, genre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (title, album_id, album["artist_id"], dur, f"/music/{album_id}/{title}.mp3", None, plays, likes, album["genre"]),
                )
                all_songs.append({"id": cur2.lastrowid, "plays": plays})

    # Charts (TOP 100)
    all_songs.sort(key=lambda x: x["plays"], reverse=True)
    today = date.today().isoformat()
    for i, song in enumerate(all_songs[:100]):
        db.execute("INSERT INTO charts (song_id, rank, chart_type, chart_date) VALUES (?, ?, ?, ?)", (song["id"], i + 1, "daily", today))

    db.commit()
    db.close()
    print("Database seeded successfully.")
