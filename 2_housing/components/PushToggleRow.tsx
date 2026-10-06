// v3.298 [WebPush] 설정 '푸시 알림' 행 — 웹: 켜기/끄기, 아이폰 사파리: 홈 화면 추가 안내, 앱(APK): 업데이트 예정 안내
import { useEffect, useState } from 'react';
import { View, Switch, StyleSheet } from 'react-native';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import { showAlert } from '../utils/appAlert';
import { webPushSupport, isWebPushEnabled, enableWebPush, disableWebPush } from '../services/pushService';

export const PUSH_IOS_GUIDE =
  '아이폰은 Safari에서 공유 버튼 → [홈 화면에 추가]로 MAIDOL을 설치한 뒤, 홈 화면의 MAIDOL에서 푸시 알림을 켤 수 있어요.';

export async function turnOnPushWithFeedback(): Promise<boolean> {
  const support = webPushSupport();
  if (support === 'ios_needs_install') { showAlert('푸시 알림', PUSH_IOS_GUIDE); return false; }
  if (support === 'native') { showAlert('푸시 알림', '앱 푸시 알림은 다음 앱 업데이트에서 지원돼요. 지금은 앱 안의 알림함에서 확인할 수 있어요.'); return false; }
  if (support === 'unsupported') { showAlert('푸시 알림', '이 브라우저는 푸시 알림을 지원하지 않아요. 크롬이나 사파리(홈 화면 앱)에서 이용해 주세요.'); return false; }
  const r = await enableWebPush();
  if (r === 'ok') { showAlert('푸시 알림', '이제 댓글·좋아요·팔로우·스타 알림을 앱이 꺼져 있어도 받아요.'); return true; }
  if (r === 'denied') { showAlert('푸시 알림', '알림 권한이 꺼져 있어요. 브라우저 설정에서 MAIDOL 알림을 허용한 뒤 다시 켜 주세요.'); return false; }
  showAlert('푸시 알림', '푸시 알림을 켜지 못했어요. 잠시 후 다시 시도해 주세요.');
  return false;
}

export default function PushToggleRow({ rowStyle, labelStyle }: { rowStyle?: any; labelStyle?: any }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { isWebPushEnabled().then(setOn).catch(() => setOn(false)); }, []);
  const toggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) setOn(await turnOnPushWithFeedback());
      else { await disableWebPush(); setOn(false); }
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={rowStyle}>
      <View style={{ flex: 1 }}>
        <AppText style={labelStyle}>푸시 알림</AppText>
        <AppText variant="caption" tone="muted" style={styles.sub}>댓글·좋아요·팔로우·스타 알림을 앱이 꺼져 있어도 받아요</AppText>
      </View>
      <Switch
        value={on}
        disabled={busy}
        onValueChange={toggle}
        trackColor={{ false: colors.border.subtle, true: colors.accent.primary }}
        thumbColor={colors.text.primary}
      />
    </View>
  );
}

const styles = StyleSheet.create({ sub: { marginTop: 2 } });
