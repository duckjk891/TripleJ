// v3.437: 곡 목록의 아티스트 표기 — 이름이 같은 아티스트가 서로 다른 사용자 소유일 수 있어(중복 허용, 대표 11-11)
// 재생 화면(v3.158)과 같은 "아티스트 · 기획사" 로 누구의 아티스트인지 함께 보여 준다.
// 화면 표시 전용: 외부 공유 문구에는 쓰지 않는다(닉네임 유출 방지 — utils/shareMessage verifiedArtistName).

export interface ArtistLineTrack {
  artist_name?: string | null;
  /** 기획사명(= 업로더 닉네임) */
  agency_name?: string | null;
  uploader_nickname?: string | null;
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 아티스트 미지정 곡은 서버가 artist_name 을 기획사명으로 채우므로 한 번만 표시한다.
 *  기획사명 'AI' 는 서버의 닉네임 없음 폴백 값이라 소유자로 보지 않는다. */
export function artistLine(track: ArtistLineTrack | null | undefined, opts?: { hideAgency?: boolean; fallback?: string }): string {
  const agencyRaw = clean(track?.agency_name) || clean(track?.uploader_nickname);
  const agency = agencyRaw === 'AI' ? '' : agencyRaw;
  const artist = clean(track?.artist_name);
  if (!artist) return agency || opts?.fallback || '알 수 없는 아티스트';
  if (opts?.hideAgency || !agency || agency === artist) return artist;
  return `${artist} · ${agency}`;
}
