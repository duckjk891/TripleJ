import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { colors } from '../theme/colors';

const ARTIST_PORTRAIT = require('../assets/portraits/artist_director.png');

type Cat = '상의' | '하의' | '신발';
const CATEGORIES: Cat[] = ['상의', '하의', '신발'];

interface AdItem {
  id: string;
  name: string;
  image_object_name?: string;
  product_url?: string;
  advertiser_nickname?: string;
}

interface MyCharacter {
  sheet_object_name: string;
  preview_url?: string;
}

interface ChatMessage {
  type: 'director' | 'user';
  text: string;
}

type Step =
  | 'welcome'       // 인사 + 사진 올리기 유도 (캐릭터 없을 때만)
  | 'style_text'    // 컨셉 텍스트 입력 (사진 업로드 후)
  | 'generating'    // 속옷 캐릭터 생성 중
  | 'preview'       // 속옷 프리뷰 + 저장/미세조정/옷입히기
  | 'cody'          // 코디 선택 (저장 후)
  | 'refining'      // 옷 입히기 또는 미세조정 로딩
  | 'done';         // 모든 작업 완료

function adImageUrl(objectName?: string): string | null {
  if (!objectName) return null;
  return `${BACKEND_BASE_URL}/api/business/items/image/${objectName}`;
}

function characterPreviewUrl(previewPath: string): string {
  return `${BACKEND_BASE_URL}${previewPath}`;
}

export default function ArtistDirectorScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const titleLabel = user?.display_title || '대표';

  const scrollRef = useRef<ScrollView>(null);
  const [step, setStep] = useState<Step>('welcome');
  const [chat, setChat] = useState<ChatMessage[]>([
    {
      type: 'director',
      text: `안녕하세요 ${titleLabel}님! 우리 아티스트의 얼굴 사진을 한 장 올려주세요.`,
    },
  ]);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string>('');
  const [selectedTop, setSelectedTop] = useState<AdItem | null>(null);
  const [selectedBottom, setSelectedBottom] = useState<AdItem | null>(null);
  const [selectedShoes, setSelectedShoes] = useState<AdItem | null>(null);
  const [styleText, setStyleText] = useState('');

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewObjectName, setPreviewObjectName] = useState<string | null>(null);
  const [refineText, setRefineText] = useState('');

  const [myCharacter, setMyCharacter] = useState<MyCharacter | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  // 아이템 선택 모달
  const [pickerCat, setPickerCat] = useState<Cat | null>(null);
  const [pickerItems, setPickerItems] = useState<AdItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // 백엔드 광고가 비어있을 때 노출할 더미 샘플 (UX 데모용)
  const SAMPLE_ITEMS: Record<Cat, AdItem[]> = {
    상의: [
      { id: 'sample_top_1', name: '베이직 흰 티', advertiser_nickname: '샘플 브랜드' },
      { id: 'sample_top_2', name: '오버사이즈 후디', advertiser_nickname: '샘플 브랜드' },
      { id: 'sample_top_3', name: '데님 셔츠', advertiser_nickname: '샘플 브랜드' },
      { id: 'sample_top_4', name: '스트라이프 폴로', advertiser_nickname: '샘플 브랜드' },
      { id: 'sample_top_5', name: '검은 가죽 자켓', advertiser_nickname: '샘플 브랜드' },
    ],
    하의: [
      { id: 'sample_bot_1', name: '슬림 청바지', advertiser_nickname: '샘플 브랜드' },
      { id: 'sample_bot_2', name: '와이드 슬랙스', advertiser_nickname: '샘플 브랜드' },
      { id: 'sample_bot_3', name: '카고 팬츠', advertiser_nickname: '샘플 브랜드' },
      { id: 'sample_bot_4', name: '플리츠 스커트', advertiser_nickname: '샘플 브랜드' },
      { id: 'sample_bot_5', name: '조거 트레이닝', advertiser_nickname: '샘플 브랜드' },
    ],
    신발: [
      { id: 'sample_shoes_1', name: '하얀 스니커즈', advertiser_nickname: '샘플 브랜드' },
      { id: 'sample_shoes_2', name: '컴뱃 부츠', advertiser_nickname: '샘플 브랜드' },
      { id: 'sample_shoes_3', name: '러닝화', advertiser_nickname: '샘플 브랜드' },
      { id: 'sample_shoes_4', name: '로퍼', advertiser_nickname: '샘플 브랜드' },
      { id: 'sample_shoes_5', name: '플랫폼 슈즈', advertiser_nickname: '샘플 브랜드' },
    ],
  };

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [chat, step]);

  // 초기: 내 캐릭터 로드
  useEffect(() => {
    if (!user) {
      setInitialLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await api.get('/character/me');
        if (res.data?.character) {
          setMyCharacter(res.data.character);
        }
      } catch {}
      finally {
        setInitialLoading(false);
      }
    })();
  }, [user]);

  const pushDirector = (text: string) =>
    setChat((prev) => [...prev, { type: 'director' as const, text }]);
  const pushUser = (text: string) =>
    setChat((prev) => [...prev, { type: 'user' as const, text }]);

  // ── Photo pick ─────────────────────────────────────────────
  const handlePickPhoto = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'image/*' });
      if (!res.canceled && res.assets && res.assets[0]) {
        const file = res.assets[0];
        setPhotoUri(file.uri);
        setPhotoName(file.name);
        pushUser(`사진 선택: ${file.name}`);
        pushDirector(
          '좋아요! 캐릭터의 컨셉이나 분위기를 알려주세요. (예: 도시적인 K-팝 아티스트)\n옷은 나중에 입혀드릴게요.'
        );
        setStep('style_text');
      }
    } catch {
      Alert.alert('오류', '사진을 선택하지 못했어요.');
    }
  };

  // ── Item picker modal ─────────────────────────────────────
  const openPicker = async (cat: Cat) => {
    setPickerCat(cat);
    setPickerLoading(true);
    try {
      const res = await api.get('/business/ads/active', { params: { category: cat } });
      const items: AdItem[] = res.data?.items || [];
      // 백엔드 광고 0개면 샘플 5개 노출 (UX 데모)
      setPickerItems(items.length > 0 ? items : SAMPLE_ITEMS[cat]);
    } catch {
      setPickerItems(SAMPLE_ITEMS[cat]);
    } finally {
      setPickerLoading(false);
    }
  };

  const pickItem = (item: AdItem) => {
    if (pickerCat === '상의') setSelectedTop(item);
    else if (pickerCat === '하의') setSelectedBottom(item);
    else if (pickerCat === '신발') setSelectedShoes(item);
    if (pickerCat) {
      pushUser(`${pickerCat}: ${item.name}`);
      api.post(`/business/ads/${item.id}/impression`).catch(() => {});
    }
    setPickerCat(null);
  };

  // ── Generate character sheet ──────────────────────────────
  const handleGenerate = async (skipText = false) => {
    if (!photoUri) {
      Alert.alert('오류', '사진을 먼저 올려주세요.');
      return;
    }
    const userInput = skipText ? '' : styleText.trim();
    if (userInput) pushUser(userInput);
    else pushUser('(컨셉 생략)');
    pushDirector('좋아요! 우선 기본 의상으로 캐릭터를 만들어볼게요. 옷은 저장 후 입혀드릴게요.');
    setStep('generating');

    // 첫 생성은 항상 속옷(기본 의상)으로 — 이후 refine으로 옷 입힘
    const baseAttire = '캐릭터 시트 형태. 기본 의상(흰색 민소매 탑과 검정 레깅스/쫄바지) 차림. 신발은 맨발.';
    const finalText = userInput ? `${baseAttire} 컨셉: ${userInput}` : baseAttire;

    try {
      const form = new FormData();
      const nameFromUri = photoName || (photoUri.split('/').pop() ?? 'photo.jpg');
      const ext = (nameFromUri.split('.').pop() || 'jpg').toLowerCase();
      form.append('file', {
        uri: photoUri,
        name: nameFromUri,
        type: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      } as any);
      form.append('user_text', finalText);

      const res = await api.post('/character/generate-sheet', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 180000,
      });
      setPreviewUrl(characterPreviewUrl(res.data.preview_url));
      setPreviewObjectName(res.data.object_name);
      pushDirector('완성했어요! 마음에 드시면 저장하시고, 더 다듬을 부분이 있으면 알려주세요.');
      setStep('preview');
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || '캐릭터 생성에 실패했어요.';
      pushDirector(`문제가 생겼어요: ${msg}`);
      setStep('style_text');
      Alert.alert('오류', msg);
    }
  };

  // ── Save character ────────────────────────────────────────
  const handleSave = async (goToCody = true) => {
    if (!previewObjectName) return;
    try {
      const res = await api.post('/character/save', {
        sheet_object_name: previewObjectName,
      });
      setMyCharacter(res.data?.character || { sheet_object_name: previewObjectName });
      if (goToCody) {
        pushDirector('저장 완료! 이제 옷을 입혀볼까요? 상의·하의·신발에서 골라주세요.');
        setStep('cody');
      } else {
        pushDirector('저장 완료! 이 아티스트와 함께 곡을 만들어봐요.');
        setStep('done');
      }
    } catch (err: any) {
      Alert.alert('오류', err.response?.data?.error || '저장에 실패했습니다.');
    }
  };

  // 코디 단계에서 선택한 옷을 refine으로 입혀주기
  const handleApplyOutfit = async () => {
    if (!previewUrl || !photoUri) return;
    const items = [
      selectedTop ? `상의: ${selectedTop.name}` : null,
      selectedBottom ? `하의: ${selectedBottom.name}` : null,
      selectedShoes ? `신발: ${selectedShoes.name}` : null,
    ].filter(Boolean);
    if (items.length === 0) {
      Alert.alert('알림', '입혀줄 옷을 하나 이상 골라주세요.');
      return;
    }
    const outfitDesc = items.join(', ');
    pushUser(`옷 입혀주세요 → ${outfitDesc}`);
    pushDirector('입혀볼게요!');
    setStep('refining');
    try {
      const form = new FormData();
      form.append('sheet_image', { uri: previewUrl, name: 'sheet.png', type: 'image/png' } as any);
      const photoNameOut = photoName || (photoUri.split('/').pop() ?? 'photo.jpg');
      const ext = (photoNameOut.split('.').pop() || 'jpg').toLowerCase();
      form.append('photo', {
        uri: photoUri,
        name: photoNameOut,
        type: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      } as any);
      form.append('refine_request', `다음 옷을 입혀주세요. ${outfitDesc}.`);
      const res = await api.post('/character/refine', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 240000,
      });
      setPreviewUrl(characterPreviewUrl(res.data.preview_url));
      setPreviewObjectName(res.data.object_name);
      pushDirector('어떤가요? 다른 옷도 시도해보시거나, 마음에 들면 저장해주세요.');
      setStep('preview');
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.detail || err.message || '옷 입히기에 실패했어요.';
      Alert.alert('오류', msg);
      setStep('cody');
    }
  };

  const handleRefine = async () => {
    if (!refineText.trim() || !previewUrl || !photoUri) return;
    const req = refineText.trim();
    pushUser(req);
    pushDirector('요청대로 살짝 수정해볼게요!');
    setStep('refining');
    try {
      const form = new FormData();
      // 1) 현재 캐릭터 시트 이미지 (백엔드 URL에서 가져와 File로 전송)
      form.append('sheet_image', {
        uri: previewUrl,
        name: 'sheet.png',
        type: 'image/png',
      } as any);
      // 2) 원본 사진 (사용자가 처음 올린 것)
      const photoNameRefine = photoName || (photoUri.split('/').pop() ?? 'photo.jpg');
      const photoExt = (photoNameRefine.split('.').pop() || 'jpg').toLowerCase();
      form.append('photo', {
        uri: photoUri,
        name: photoNameRefine,
        type: `image/${photoExt === 'jpg' ? 'jpeg' : photoExt}`,
      } as any);
      // 3) 수정 요청 텍스트
      form.append('refine_request', req);
      const res = await api.post('/character/refine', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 240000,
      });
      setPreviewUrl(characterPreviewUrl(res.data.preview_url));
      setPreviewObjectName(res.data.object_name);
      setRefineText('');
      setStep('preview');
      pushDirector('어떤가요?');
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.detail || err.message || '미세 조정에 실패했습니다.';
      Alert.alert('오류', msg);
      setStep('preview');
    }
  };

  // 캐릭터는 한 번 생성하면 재생성 불가 정책 — 옷 갈아입기만 가능
  const handleEnterCody = () => {
    pushDirector('옷을 갈아입혀볼까요? 상의·하의·신발 중에서 골라주세요.');
    setStep('cody');
  };

  // ── Render ────────────────────────────────────────────────
  const selectedCount = [selectedTop, selectedBottom, selectedShoes].filter(Boolean).length;

  const renderInputArea = () => {
    if (step === 'welcome') {
      return (
        <View style={[styles.inputArea, { paddingBottom: 24 + insets.bottom }]}>
          <TouchableOpacity style={styles.primaryBtn} onPress={handlePickPhoto}>
            <Text style={styles.primaryBtnText}>📷 사진 올리기</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (step === 'cody') {
      return (
        <View style={[styles.inputArea, { paddingBottom: 24 + insets.bottom }]}>
          <View style={styles.codyRow}>
            {CATEGORIES.map((cat) => {
              const sel =
                cat === '상의' ? selectedTop : cat === '하의' ? selectedBottom : selectedShoes;
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.codyBtn, sel && styles.codyBtnSelected]}
                  onPress={() => openPicker(cat)}
                >
                  <Text style={styles.codyBtnTitle}>{cat}</Text>
                  <Text style={styles.codyBtnSub} numberOfLines={1}>
                    {sel ? sel.name : '고르기'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.twoBtnRow}>
            <TouchableOpacity style={styles.skipBtn} onPress={() => setStep('done')}>
              <Text style={styles.skipBtnText}>다음에 입힐게요</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.applyBtn, selectedCount === 0 && { opacity: 0.4 }]}
              onPress={handleApplyOutfit}
              disabled={selectedCount === 0}
            >
              <Text style={styles.applyBtnText}>이 옷으로 입혀보기</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    if (step === 'style_text') {
      return (
        <View style={[styles.inputArea, { paddingBottom: 24 + insets.bottom }]}>
          <TextInput
            style={styles.textInput}
            value={styleText}
            onChangeText={setStyleText}
            placeholder="예: 도시적인 분위기, 밝은 머리색"
            placeholderTextColor={colors.text.muted}
            multiline
          />
          <View style={styles.twoBtnRow}>
            <TouchableOpacity style={styles.skipBtn} onPress={() => handleGenerate(true)}>
              <Text style={styles.skipBtnText}>건너뛰고 만들기</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyBtn} onPress={() => handleGenerate(false)}>
              <Text style={styles.applyBtnText}>반영해서 만들기</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    if (step === 'generating' || step === 'refining') {
      return (
        <View style={[styles.inputArea, { paddingBottom: 24 + insets.bottom }]}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
          <Text style={styles.waitText}>
            {step === 'generating' ? '아티스트를 만드는 중이에요...' : '요청대로 수정 중...'}
          </Text>
        </View>
      );
    }
    if (step === 'preview') {
      return (
        <View style={[styles.inputArea, { paddingBottom: 24 + insets.bottom }]}>
          <TextInput
            style={[styles.textInput, { marginBottom: 8 }]}
            value={refineText}
            onChangeText={setRefineText}
            placeholder="미세 조정하고 싶은 부분을 적어주세요 (예: 머리색을 좀 더 밝게)"
            placeholderTextColor={colors.text.muted}
            multiline
          />
          <View style={styles.threeBtnRow}>
            <TouchableOpacity
              style={[styles.skipBtn, !refineText.trim() && { opacity: 0.4 }]}
              onPress={handleRefine}
              disabled={!refineText.trim()}
            >
              <Text style={styles.skipBtnText}>이 부분 수정</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.skipBtn} onPress={handleEnterCody}>
              <Text style={styles.skipBtnText}>옷 입히러 가기</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyBtn} onPress={() => handleSave(true)}>
              <Text style={styles.applyBtnText}>저장</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    if (step === 'done') {
      return (
        <View style={[styles.inputArea, { paddingBottom: 24 + insets.bottom }]}>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.primaryBtnText}>작업실로 돌아가기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.skipBtn, { marginTop: 8 }]} onPress={handleEnterCody}>
            <Text style={styles.skipBtnText}>옷 다시 입혀보기</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return null;
  };

  // 로그인 필요
  if (!user) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>🎤</Text>
          <Text style={styles.emptyTitle}>로그인이 필요해요</Text>
          <Text style={styles.emptyDesc}>아티스트 디렉터와 함께 나만의 아티스트를 만들어보세요!</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.getParent()?.navigate('Settings')}
          >
            <Text style={styles.primaryBtnText}>로그인하기</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (initialLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyBox}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
        </View>
      </View>
    );
  }

  // 이미 아티스트가 있다면 상단에 프로필 + 재생성 옵션
  const existingPreview =
    myCharacter?.sheet_object_name &&
    `${BACKEND_BASE_URL}/api/character/preview/${encodeURIComponent(myCharacter.sheet_object_name)}`;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[{ padding: 16 }, { paddingTop: insets.top + 16 }]}
      >
        {/* 기존 아티스트가 있으면 상단에 프리뷰 */}
        {myCharacter && step === 'welcome' && (
          <View style={styles.myArtistCard}>
            <Text style={styles.myArtistLabel}>현재 아티스트</Text>
            {existingPreview ? (
              <Image source={{ uri: existingPreview }} style={styles.myArtistImg} />
            ) : null}
            <TouchableOpacity style={styles.skipBtn} onPress={handleEnterCody}>
              <Text style={styles.skipBtnText}>옷 갈아입기</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 채팅 */}
        {chat.map((msg, idx) => (
          <View
            key={idx}
            style={[styles.msgRow, msg.type === 'user' ? styles.userRow : styles.dirRow]}
          >
            {msg.type === 'director' && (
              <View style={styles.dirPortrait}>
                <Image source={ARTIST_PORTRAIT} style={styles.dirPortraitImg} />
              </View>
            )}
            <View
              style={[styles.bubble, msg.type === 'user' ? styles.userBubble : styles.dirBubble]}
            >
              <Text
                style={[
                  styles.bubbleText,
                  msg.type === 'user' ? { color: colors.text.primary } : { color: colors.bg.deepest },
                ]}
              >
                {msg.text}
              </Text>
            </View>
          </View>
        ))}

        {/* 프리뷰 이미지 (step preview/done) */}
        {(step === 'preview' || step === 'done') && previewUrl && (
          <View style={styles.previewBox}>
            <Image source={{ uri: previewUrl }} style={styles.previewImg} />
          </View>
        )}

        {/* 선택된 코디 요약 (cody 단계) */}
        {step === 'cody' && selectedCount > 0 && (
          <View style={styles.codySummary}>
            {[selectedTop, selectedBottom, selectedShoes]
              .filter((x): x is AdItem => !!x)
              .map((item) => (
                <View key={item.id} style={styles.codyChip}>
                  <Text style={styles.codyChipText}>{item.name}</Text>
                </View>
              ))}
          </View>
        )}
      </ScrollView>

      {renderInputArea()}

      {/* 아이템 선택 모달 */}
      <Modal
        visible={pickerCat !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerCat(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{pickerCat} 고르기</Text>
              <TouchableOpacity onPress={() => setPickerCat(null)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {pickerLoading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={colors.accent.primary} />
              </View>
            ) : pickerItems.length === 0 ? (
              <View style={{ padding: 40 }}>
                <Text style={styles.emptyDesc}>
                  등록된 {pickerCat} 아이템이 없어요. 건너뛰어주세요.
                </Text>
              </View>
            ) : (
              <FlatList
                data={pickerItems}
                keyExtractor={(item) => item.id}
                numColumns={2}
                renderItem={({ item }) => {
                  const url = adImageUrl(item.image_object_name);
                  return (
                    <TouchableOpacity
                      style={styles.itemCard}
                      onPress={() => pickItem(item)}
                    >
                      {url ? (
                        <Image source={{ uri: url }} style={styles.itemImg} />
                      ) : (
                        <View style={[styles.itemImg, { backgroundColor: colors.bg.surface2 }]} />
                      )}
                      <Text style={styles.itemName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {item.advertiser_nickname ? (
                        <Text style={styles.itemBrand} numberOfLines={1}>
                          {item.advertiser_nickname}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                }}
                contentContainerStyle={{ padding: 12 }}
              />
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyIcon: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 20, color: colors.text.primary, fontWeight: '700', marginBottom: 8 },
  emptyDesc: {
    fontSize: 14,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },

  myArtistCard: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  myArtistLabel: { fontSize: 12, color: colors.accent.primary, fontWeight: '700', marginBottom: 10 },
  myArtistImg: { width: 160, height: 160, borderRadius: 12, marginBottom: 12 },

  msgRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12 },
  dirRow: { justifyContent: 'flex-start', paddingRight: 40 },
  userRow: { justifyContent: 'flex-end', paddingLeft: 40 },
  dirPortrait: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.accent.primary,
    marginRight: 8,
    backgroundColor: colors.bg.surface2,
  },
  // ARTIST_PORTRAIT는 95x405. 첫 frame(머리)이 컨테이너 위에 오도록 비율 유지하며 위로 정렬
  dirPortraitImg: {
    width: 44,
    height: 44 * 405 / 95, // 비율 유지 (~187)
    resizeMode: 'cover',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  bubble: { borderRadius: 16, padding: 12, maxWidth: '80%' },
  dirBubble: { backgroundColor: colors.text.primary, borderBottomLeftRadius: 4 },
  userBubble: {
    backgroundColor: colors.accent.primary,
    borderBottomRightRadius: 4,
    alignSelf: 'flex-end',
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },

  previewBox: {
    alignItems: 'center',
    marginVertical: 16,
    padding: 12,
    backgroundColor: colors.bg.surface1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.accent.primary,
  },
  previewImg: { width: 240, height: 240, borderRadius: 12 },

  codySummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  codyChip: {
    backgroundColor: colors.bg.surface1,
    borderColor: colors.accent.primary,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  codyChipText: { color: colors.text.primary, fontSize: 12, fontWeight: '600' },

  inputArea: {
    borderTopWidth: 1,
    borderTopColor: colors.bg.surface1,
    padding: 14,
    paddingBottom: 24,
    backgroundColor: colors.bg.deepest,
  },
  primaryBtn: {
    backgroundColor: colors.accent.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryBtnText: { color: colors.text.primary, fontWeight: '700', fontSize: 15 },

  codyRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  codyBtn: {
    flex: 1,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  codyBtnSelected: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface2 },
  codyBtnTitle: { color: colors.text.primary, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  codyBtnSub: { color: colors.text.secondary, fontSize: 11 },

  textInput: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    padding: 12,
    color: colors.text.primary,
    fontSize: 14,
    minHeight: 56,
    maxHeight: 120,
    marginBottom: 8,
  },
  waitText: {
    color: colors.text.secondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
  },

  twoBtnRow: { flexDirection: 'row', gap: 10 },
  threeBtnRow: { flexDirection: 'row', gap: 8 },
  skipBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  skipBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
  applyBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: colors.accent.primary,
  },
  applyBtnText: { color: colors.text.primary, fontSize: 13, fontWeight: '700' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(13, 8, 32, 0.85)',
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: colors.bg.deepest,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '80%',
    borderTopWidth: 1,
    borderTopColor: colors.accent.primary,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg.surface1,
  },
  modalTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '700' },
  modalClose: { color: colors.text.secondary, fontSize: 22 },

  itemCard: {
    flex: 1,
    margin: 6,
    padding: 10,
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  itemImg: { width: '100%', aspectRatio: 1, borderRadius: 8, marginBottom: 8 },
  itemName: { color: colors.text.primary, fontSize: 13, fontWeight: '600' },
  itemBrand: { color: colors.text.muted, fontSize: 11, marginTop: 2 },
});
