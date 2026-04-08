# 대화 UI 시스템 계획서

## 개요
오피스 맵 위에서 디렉터 캐릭터를 탭하면, 화면 하단에 비주얼 노벨 스타일 대화창이 나타나는 시스템.

## 화면 구성
```
┌─────────────────────────┐
│                         │
│    오피스 타일맵 배경      │
│    (스크롤 가능)          │
│                         │
│         [캐릭터 스프라이트] │
│                         │
│  ┌─────────────────────┐│
│  │  ┌──┐    디렉터 이름  ││
│  │  │실│               ││
│  │  │사│  대화 내용      ││
│  │  │이│  텍스트가       ││
│  │  │미│  여기에 표시    ││
│  │  │지│               ││
│  │  └──┘   탭하여 계속 ▼ ││
│  └─────────────────────┘│
└─────────────────────────┘
```

## 에셋 구조
```
assets/
├── portraits/          # 디렉터 실사 초상화 (투명 배경 PNG)
│   ├── artist_director.png
│   ├── lyricist_director.png
│   ├── composer_director.png
│   ├── image_director.png
│   └── video_director.png
├── sprites/            # 32x32 픽셀 스프라이트 시트
│   └── (기존 파일)
├── tilesets/            # 타일맵 타일셋
│   └── (기존 파일)
└── maps/               # TMX 맵 파일
    └── office.tmx
```

## 대화 UI 컴포넌트

### DialogueOverlay
- 맵 위에 오버레이로 표시
- 반투명 어두운 배경 (맵이 살짝 보임)
- 하단 40% 영역에 대화창

### CharacterPortrait
- 대화창 좌측에 디렉터 실사 이미지 표시
- 반신 이미지, 하단 정렬
- 말하는 캐릭터가 밝게, 나머지는 어둡게 (다중 대화 시)

### DialogueBox
- 캐릭터 이름 (상단)
- 대화 텍스트 (타이핑 애니메이션)
- "탭하여 계속" 인디케이터
- 배경: 흰색/반투명, 둥근 모서리

### DialogueChoices (선택지)
- 대화 중 선택지가 필요한 경우
- 버튼 형태로 2~4개 옵션 표시

## 대화 데이터 구조
```typescript
interface DialogueLine {
  character: 'artist' | 'lyricist' | 'composer' | 'image' | 'video';
  name: string;        // 표시 이름
  text: string;        // 대화 내용
  choices?: {          // 선택지 (선택적)
    text: string;
    nextId: string;
  }[];
}

interface DialogueScript {
  id: string;
  lines: DialogueLine[];
}
```

## 구현 단계

### Step 1: 프로토타입 (현재)
- [x] 디렉터 실사 초상화 분리
- [ ] Expo 프로젝트 초기화
- [ ] 맵 배경 이미지 렌더링 (정적 스크린샷)
- [ ] 대화 UI 컴포넌트 구현
- [ ] 디렉터 탭 → 대화창 표시 동작 확인

### Step 2: 맵 연동
- [ ] TMX 파서 구현
- [ ] 타일맵 Canvas/Skia 렌더링
- [ ] 캐릭터 스프라이트 배치 + 애니메이션
- [ ] 스프라이트 터치 이벤트 → 대화 트리거

### Step 3: AI 대화 연동
- [ ] WebSocket 연결 (office-game-api)
- [ ] Generative Agent 대화 스트리밍
- [ ] 대화 → 서비스 파라미터 추출
- [ ] 서비스 실행 트리거

## 디렉터 정보
| 디렉터 | 키 | 표시 이름 | 역할 |
|--------|-----|----------|------|
| 아티스트 | artist | 아티스트 디렉터 | 아티스트 생성 |
| 작사 | lyricist | 작사 디렉터 | 가사 작성 |
| 작곡 | composer | 작곡 디렉터 | 음악 제작 |
| 이미지 | image | 이미지 디렉터 | 앨범 자켓/MV 씬 |
| 영상 | video | 영상 디렉터 | 뮤직비디오 제작 |
