// v3.227(D): 꾸미기 카탈로그 조회 — GET /business/ads/catalog?category= (서버 v3.227, gzip·전량·파생 필드)
// → 404(구서버)·오류면 기존 GET /business/ads/active?category= 로 폴백(파생 필드는 utils/codyCatalog 규칙으로 계산).
// - 카테고리별 메모리 캐시 10분(피커를 다시 열거나 카테고리를 오갈 때 재요청하지 않음), 동시 요청 합치기.
// - catalog 404는 "구서버"로 기억해 10분간 catalog를 건너뛴다(매번 404 왕복 방지). 네트워크 오류는 기억하지 않음.
// - 서버 응답 필드 접근은 mapItem() 한 곳에만 둔다(필드명이 바뀌면 여기만 고친다).
// - gzip: Accept-Encoding은 플랫폼(OkHttp/NSURLSession/브라우저)이 자동으로 붙이고 풀어준다 — 직접 지정 금지.
import api from './api';
import { enrichItem, type AdItem, type Cat } from '../utils/codyCatalog';

export type CatalogSource = 'catalog' | 'active';
export interface CatalogResult {
  items: AdItem[];
  source: CatalogSource;
  /** 서버 catalog가 내려준 대분류 칩 순서(최상위 sub_categories). 폴백(active)일 때는 없음 → 앱 규칙 순서 */
  subCategories?: string[];
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<Cat, { at: number; result: CatalogResult }>();
const inflight = new Map<Cat, Promise<CatalogResult>>();
let catalogUnsupportedUntil = 0;

const str = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
};

/** 서버 문서 → 앱 AdItem. catalog·active 두 응답 모양을 모두 받는다. */
function mapItem(raw: any, cat: Cat): AdItem {
  const price = Number(raw?.price_krw);
  return enrichItem(
    {
      id: String(raw?.id ?? raw?._id ?? ''),
      name: str(raw?.name) ?? '',
      product_name: str(raw?.product_name),
      brand: str(raw?.brand),
      advertiser_nickname: str(raw?.advertiser_nickname),
      gender: str(raw?.gender),
      color: str(raw?.color),
      category: str(raw?.category) ?? cat,
      image_object_name: str(raw?.image_object_name),
      product_url: str(raw?.product_url),
      is_active: typeof raw?.is_active === 'boolean' ? raw.is_active : undefined,
      // 서버 파생값: 있으면 그대로(색상 null = 서버가 '색상 정보 없음'으로 판정), 없으면 enrichItem이 계산
      sub_category: str(raw?.sub_category),
      color_family: raw && 'color_family' in raw ? (str(raw.color_family) ?? null) : undefined,
      price_krw: Number.isFinite(price) && price > 0 ? price : null,
      source: raw?.source === 'brand' || raw?.source === 'platform' ? raw.source : undefined,
    },
    cat,
  );
}

function strList(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length > 0 ? (v as string[]) : undefined;
}

function listOf(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function load(cat: Cat): Promise<CatalogResult> {
  if (Date.now() >= catalogUnsupportedUntil) {
    try {
      const res = await api.get('/business/ads/catalog', { params: { category: cat } });
      const items = listOf(res.data).map((r) => mapItem(r, cat)).filter((i) => !!i.id);
      if (__DEV__) console.info('[Catalog] catalog 조회', { category: cat, n: items.length });
      return { items, source: 'catalog', subCategories: strList(res.data?.sub_categories) };
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) {
        catalogUnsupportedUntil = Date.now() + TTL_MS;
        console.warn('[Catalog] catalog 미지원(구서버 404) — /ads/active 폴백', { category: cat });
      } else {
        console.warn('[Catalog] catalog 조회 실패 — /ads/active 폴백', { category: cat, status, message: err?.message });
      }
    }
  }
  // 폴백: 기존 목록 API(서버 $sample 500 무작위) — 실패하면 호출부가 SAMPLE 폴백
  const res = await api.get('/business/ads/active', { params: { category: cat } });
  const items = listOf(res.data).map((r) => mapItem(r, cat)).filter((i) => !!i.id);
  if (__DEV__) console.info('[Catalog] active 폴백 조회', { category: cat, n: items.length });
  return { items, source: 'active' };
}

/** 카테고리 카탈로그(캐시 10분). catalog·active 모두 실패하면 throw — 호출부가 SAMPLE 폴백. */
export async function getCatalog(cat: Cat): Promise<CatalogResult> {
  const hit = cache.get(cat);
  if (hit && Date.now() - hit.at < TTL_MS) {
    if (__DEV__) console.info('[Catalog] cache hit', { category: cat, n: hit.result.items.length, source: hit.result.source });
    return hit.result;
  }
  const pending = inflight.get(cat);
  if (pending) return pending;
  const p = load(cat)
    .then((result) => {
      // 0건은 캐시하지 않는다(일시적 빈 응답이 10분간 SAMPLE로 고정되지 않게)
      if (result.items.length > 0) cache.set(cat, { at: Date.now(), result });
      return result;
    })
    .finally(() => {
      inflight.delete(cat);
    });
  inflight.set(cat, p);
  return p;
}

/** 대분류 칩 순서 — 서버 catalog 배열 우선, 없으면 null(호출부가 앱 규칙 순서 사용) */
export function getSubCategoryOrder(cat: Cat): string[] | null {
  return peekCatalog(cat)?.subCategories ?? null;
}

/** 캐시에 있는(유효한) 결과만 즉시 반환 — 없으면 null */
export function peekCatalog(cat: Cat): CatalogResult | null {
  const hit = cache.get(cat);
  return hit && Date.now() - hit.at < TTL_MS ? hit.result : null;
}

export function clearCatalogCache() {
  cache.clear();
  catalogUnsupportedUntil = 0;
}
