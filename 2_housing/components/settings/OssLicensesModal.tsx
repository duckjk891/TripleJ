// v3.334 [OssLicenses] 오픈소스 라이선스 고지 — constants/ossLicenses.json(scripts/gen-oss-licenses.js 생성) 표시.
// 목록 = 이름·버전·라이선스·저작권 표기, 항목을 누르면 그 라이선스 전문을 펼친다.
import { useState } from 'react';
import { FlatList, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import AppModal from '../AppModal'; // v3.400 iOS 창 겹침·팝업 무반응 방지
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import OSS from '../../constants/ossLicenses.json';

type Pkg = { n: string; v: string; l: string; c: string };
const DATA = OSS as { generatedAt: string; count: number; packages: Pkg[]; texts: Record<string, string> };

export default function OssLicensesModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <AppModal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <AppText variant="title3">오픈소스 라이선스</AppText>
          <TouchableOpacity onPress={onClose} accessibilityLabel="닫기" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="x" size={22} color={colors.text.muted} />
          </TouchableOpacity>
        </View>
        <AppText variant="caption" tone="muted" style={styles.lead}>
          MAIDOL 은 아래 오픈소스 소프트웨어를 사용해요. ({DATA.count}개 · {DATA.generatedAt} 기준){'\n'}항목을 누르면 라이선스 전문을 볼 수 있어요.
        </AppText>
        <FlatList
          data={DATA.packages}
          keyExtractor={(p) => `${p.n}@${p.v}`}
          initialNumToRender={30}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          renderItem={({ item }) => {
            const key = `${item.n}@${item.v}`;
            const open = openKey === key;
            const text = DATA.texts[item.l];
            return (
              <TouchableOpacity style={styles.row} onPress={() => setOpenKey(open ? null : key)} activeOpacity={0.7}>
                <AppText variant="footnote">{item.n} <AppText variant="caption" tone="muted">{item.v}</AppText></AppText>
                <AppText variant="caption" tone="accent">{item.l}</AppText>
                {item.c ? <AppText variant="caption" tone="muted" numberOfLines={open ? undefined : 1}>{item.c}</AppText> : null}
                {open && text ? (
                  <ScrollView style={styles.textBox} nestedScrollEnabled>
                    <AppText variant="caption" tone="secondary" style={{ lineHeight: 17 }}>{text}</AppText>
                  </ScrollView>
                ) : null}
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.deepest },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, height: 56 },
  lead: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm, lineHeight: 17 },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle, gap: 2 },
  textBox: { maxHeight: 260, marginTop: spacing.sm, padding: spacing.sm, backgroundColor: colors.bg.surface1, borderRadius: 8 },
});
