import { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { colors } from '../theme/colors';

export default function ArtistResultScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const taskStore = useCharacterTaskStore();
  const apiResult = taskStore.apiResult;

  const [refineText, setRefineText] = useState('');
  const [saving, setSaving] = useState(false);
  const [hydrating, setHydrating] = useState(!apiResult); // apiResult가 비어 있으면 /character/me로 가져옴

  // taskStore.apiResult가 비어있다면 (myCharacter에서 진입), /character/me로 채움
  useEffect(() => {
    if (apiResult || !user) {
      setHydrating(false);
      return;
    }
    (async () => {
      try {
        const res = await api.get('/character/me');
        if (res.data?.character) {
          const ch = res.data.character;
          if (ch.preview_url && ch.sheet_object_name) {
            taskStore.completeApi({
              preview_url: `${BACKEND_BASE_URL}${ch.preview_url}`,
              object_name: ch.sheet_object_name,
            });
          }
        }
      } catch {
        // 무시 — 화면에 안내 표시
      } finally {
        setHydrating(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleSave = async () => {
    if (!apiResult) return;
    setSaving(true);
    try {
      await api.post('/character/save', {
        sheet_object_name: apiResult.object_name,
      });
      Alert.alert('저장 완료', '아티스트 캐릭터를 저장했어요.', [
        {
          text: '확인',
          onPress: () => {
            taskStore.reset();
            navigation.getParent()?.navigate('MainTabs');
          },
        },
      ]);
    } catch (err: any) {
      Alert.alert('오류', err.response?.data?.error || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleRefine = () => {
    const req = refineText.trim();
    if (!req) return;
    if (!apiResult) return;
    // ArtistLoading(refine)으로 — 이전 시트는 taskStore.apiResult에 보존됨
    navigation.replace('ArtistLoading', {
      mode: 'refine',
      refineRequest: req,
    });
  };

  const handleGoCody = () => {
    if (!apiResult) return;
    navigation.replace('ArtistCody');
  };

  const handleGoMap = () => {
    navigation.getParent()?.navigate('MainTabs');
  };

  if (hydrating) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
        </View>
      </View>
    );
  }

  if (!apiResult) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>아직 만든 아티스트가 없어요</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.replace('ArtistInput')}
          >
            <Text style={styles.primaryBtnText}>아티스트 만들러 가기</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[{ padding: 16 }, { paddingTop: insets.top + 16 }]}
      >
        <Text style={styles.title}>완성된 아티스트 시트</Text>
        <Text style={styles.subtitle}>마음에 드시면 저장하세요. 더 다듬거나 옷을 입혀볼 수도 있어요.</Text>

        <View style={styles.previewBox}>
          <Image source={{ uri: apiResult.preview_url }} style={styles.previewImg} />
        </View>

        <View style={styles.refineBox}>
          <Text style={styles.refineLabel}>미세조정 요청 (선택)</Text>
          <TextInput
            style={styles.textInput}
            value={refineText}
            onChangeText={setRefineText}
            placeholder="예: 머리색을 좀 더 밝게, 표정을 부드럽게"
            placeholderTextColor={colors.text.muted}
            multiline
          />
          <TouchableOpacity
            style={[styles.refineBtn, !refineText.trim() && { opacity: 0.4 }]}
            onPress={handleRefine}
            disabled={!refineText.trim()}
          >
            <Text style={styles.refineBtnText}>이 부분 미세조정 (대기 필요)</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={[styles.bottomArea, { paddingBottom: 16 + insets.bottom }]}>
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.skipBtn} onPress={handleGoCody}>
            <Text style={styles.skipBtnText}>👗 옷 입히러 가기</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.applyBtn, saving && { opacity: 0.5 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.applyBtnText}>{saving ? '저장 중...' : '💾 저장'}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={[styles.skipBtn, { marginTop: 8 }]} onPress={handleGoMap}>
          <Text style={styles.skipBtnText}>작업실로 돌아가기</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '700', marginBottom: 16, textAlign: 'center' },

  title: { color: colors.text.primary, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: colors.text.secondary, fontSize: 13, marginBottom: 16, lineHeight: 19 },

  previewBox: {
    alignItems: 'center', padding: 12, marginBottom: 16,
    backgroundColor: colors.bg.surface1, borderRadius: 16,
    borderWidth: 1, borderColor: colors.accent.primary,
  },
  previewImg: { width: 280, height: 280, borderRadius: 12 },

  refineBox: { marginBottom: 16 },
  refineLabel: { color: colors.text.secondary, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  textInput: {
    backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle,
    borderRadius: 12, padding: 12, color: colors.text.primary,
    fontSize: 14, minHeight: 60, maxHeight: 140, marginBottom: 8,
  },
  refineBtn: {
    paddingVertical: 12, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.accent.primary,
  },
  refineBtnText: { color: colors.accent.primary, fontSize: 13, fontWeight: '700' },

  bottomArea: {
    padding: 14, borderTopWidth: 1, borderTopColor: colors.bg.surface1,
    backgroundColor: colors.bg.deepest,
  },
  btnRow: { flexDirection: 'row', gap: 8 },
  skipBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle,
  },
  skipBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
  applyBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.accent.primary,
  },
  applyBtnText: { color: colors.text.primary, fontSize: 13, fontWeight: '700' },

  primaryBtn: {
    backgroundColor: colors.accent.primary, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 28, alignItems: 'center',
  },
  primaryBtnText: { color: colors.text.primary, fontWeight: '700', fontSize: 15 },
});
