# 이미지 API 백엔드 수정 요청

## 요청일: 2026-04-16

## 요청 내용

`PUT /api/tracks/{track_id}` 엔드포인트의 `TrackUpdateBody`에 `cover_image_url` 필드 추가

## 현재 상태

```python
# tracks.py
class TrackUpdateBody(BaseModel):
    title: Optional[str] = None
    genre: Optional[List[str]] = None
    mood: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    prompt: Optional[str] = None
    ai_model: Optional[str] = None
    is_public: Optional[bool] = None
    # cover_image_url 필드 없음
```

## 수정 요청

```python
class TrackUpdateBody(BaseModel):
    title: Optional[str] = None
    genre: Optional[List[str]] = None
    mood: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    prompt: Optional[str] = None
    ai_model: Optional[str] = None
    is_public: Optional[bool] = None
    cover_image_url: Optional[str] = None  # ← 추가
```

## 이유

모바일 앱에서 이미지 디렉터가 커버 이미지를 생성한 후, 기존 트랙에 커버를 연결해야 합니다.

### 현재 문제

1. `POST /upload/generate-cover` → 이미지 생성 + MinIO 저장 → `object_name` 반환
2. 이 `object_name`을 기존 트랙의 `cover_image_url`에 넣어야 하는데 방법이 없음
3. `POST /upload/image`는 파일 업로드 방식이라 이미 MinIO에 저장된 이미지를 다시 업로드해야 함 → 모바일에서 원격 URL을 FormData로 전송 불가 (Network Error)

### 수정 후 모바일 흐름

```
1. POST /upload/generate-cover → object_name 반환
2. 사용자가 "확정" 클릭
3. PUT /api/tracks/{trackId} { "cover_image_url": "covers/generated/.../xxx.png" }
4. 완료!
```

## 웹 프론트엔드 영향

**영향 없음**

- 웹은 `upload-from-generation`의 `cover_object_name` 필드로 트랙 생성 시 커버를 연결하거나, `POST /upload/image`로 파일을 직접 업로드 (웹은 File 객체 전송 가능)
- `PUT /tracks/{id}`에 필드가 추가되는 것뿐이므로 기존 동작에 영향 없음
- `TrackUpdateBody`의 다른 필드들처럼 `None`이면 무시됨

## 수정 대상 파일

- `backend_9003/app/routes/tracks.py` (또는 사용 중인 백엔드 인스턴스)
- `TrackUpdateBody` 클래스에 한 줄 추가

## 수정 후 모바일 코드 변경 예정

```typescript
// 현재 (Network Error)
const formData = new FormData();
formData.append('file', { uri: coverImageUrl, ... });
await api.post('/upload/image', formData);

// 수정 후
await api.put(`/tracks/${trackId}`, { cover_image_url: objectName });
```
