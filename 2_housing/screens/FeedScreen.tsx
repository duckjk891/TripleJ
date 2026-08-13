// [FeedScreen] 피드 타임라인 — /api/feeds/timeline (백엔드 9004 라이브). Wave1 소셜 코어 시작.
import { useState, useCallback } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { View, FlatList, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { AppText, Card, Avatar, EmptyState, ScreenLayout, Button } from '../components/ui';

interface FeedPost {
  id?: string | number;
  author_nickname?: string;
  author_name?: string;
  nickname?: string;
  body?: string;
  content?: string;
  text?: string;
  created_at?: string;
  track_title?: string;
}

export default function FeedScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchFeed = useCallback(async () => {
    if (__DEV__) console.info('[FeedScreen] fetchFeed 호출');
    try {
      setLoading(true);
      const res = await api.get('/feeds/timeline');
      const data: FeedPost[] = Array.isArray(res.data)
        ? res.data
        : (res.data?.feeds || res.data?.items || res.data?.posts || []);
      if (__DEV__) console.info('[FeedScreen] fetchFeed 응답', { count: data.length });
      setPosts(data);
    } catch (err: any) {
      console.error('[FeedScreen] fetchFeed 실패', { status: err?.response?.status });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchFeed(); }, [fetchFeed]));

  const renderPost = ({ item }: { item: FeedPost }) => {
    const author = item.author_nickname || item.author_name || item.nickname || '익명';
    const text = item.body || item.content || item.text || '';
    return (
      <Card variant="filled" style={styles.card}>
        <View style={styles.head}>
          <Avatar name={author} size={36} />
          <View style={styles.headText}>
            <AppText variant="bodyStrong" numberOfLines={1}>{author}</AppText>
            {item.created_at ? (
              <AppText variant="caption" tone="muted">
                {new Date(item.created_at).toLocaleDateString('ko-KR')}
              </AppText>
            ) : null}
          </View>
        </View>
        {text ? <AppText variant="body" tone="secondary" style={styles.body}>{text}</AppText> : null}
        {item.track_title ? (
          <AppText variant="footnote" tone="accent" style={styles.track}>♪ {item.track_title}</AppText>
        ) : null}
      </Card>
    );
  };

  return (
    <ScreenLayout>
      {loading && posts.length === 0 ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />
      ) : posts.length > 0 ? (
        <FlatList
          data={posts}
          keyExtractor={(it, i) => String(it.id ?? i)}
          renderItem={renderPost}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchFeed(); }}
              tintColor={colors.accent.primary}
            />
          }
        />
      ) : (
        <EmptyState
          icon="👥"
          title={user ? '팔로우한 아티스트가 없어요' : '로그인이 필요해요'}
          hint={user
            ? '팔로우를 추가해주세요. 마음에 드는 아티스트를 팔로우하면 소식이 여기 떠요.'
            : '로그인하면 팔로우한 아티스트의 소식을 볼 수 있어요'}
          action={user
            ? <Button label="아티스트 둘러보기" onPress={() => navigation.navigate('Chart')} />
            : undefined}
        />
      )}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: spacing.huge },
  list: { padding: spacing.lg, paddingBottom: 100 },
  card: { marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center' },
  headText: { marginLeft: spacing.md, flex: 1 },
  body: { marginTop: spacing.md },
  track: { marginTop: spacing.sm },
});
