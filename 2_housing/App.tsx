import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  StyleSheet,
  View,
  Image,
  ScrollView,
  Text,
  Modal,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import Character, { DirectorType } from './components/Character';

const MAP_IMAGE = require('./assets/map_rendered.png');
const MAP_WIDTH = 704;
const MAP_HEIGHT = 2208;

// 디렉터 초상화
const PORTRAITS: Record<DirectorType, any> = {
  artist: require('./assets/portraits/artist_director.png'),
  lyricist: require('./assets/portraits/lyricist_director.png'),
  composer: require('./assets/portraits/composer_director.png'),
  image: require('./assets/portraits/image_director.png'),
  video: require('./assets/portraits/video_director.png'),
};

const DIRECTOR_NAMES: Record<DirectorType, string> = {
  artist: '아티스트 디렉터',
  lyricist: '작사 디렉터',
  composer: '작곡 디렉터',
  image: '이미지 디렉터',
  video: '영상 디렉터',
};

const DIRECTOR_ROLES: Record<DirectorType, string> = {
  artist: '아티스트 캐릭터를 생성하고 관리합니다',
  lyricist: 'AI로 가사를 작성합니다',
  composer: 'AI로 음악을 제작합니다',
  image: '앨범 자켓과 MV 씬 이미지를 디자인합니다',
  video: '뮤직비디오를 제작합니다',
};

// TMX 바닥 레이어 분석 기반 방 좌표 (원본 px)
// 방1: 행6-13 (y=192~448), 방2: 행16-23 (y=512~768), 방3: 행26-33 (y=832~1088)
// 방4: 행36-43 (y=1152~1408), 방5: 행46-53 (y=1472~1728)
// 각 방 x범위: 열1-12 (x=32~384)
const DIRECTORS = [
  { type: 'artist' as DirectorType, x: 208, y: 340 },    // 방1 아티스트
  { type: 'composer' as DirectorType, x: 208, y: 660 },   // 방2 작곡
  { type: 'lyricist' as DirectorType, x: 208, y: 980 },   // 방3 녹음(작사)
  { type: 'image' as DirectorType, x: 208, y: 1300 },     // 방4 이미지
  { type: 'video' as DirectorType, x: 208, y: 1620 },     // 방5 영상
];

export default function App() {
  const { width: screenWidth } = useWindowDimensions();
  const mapScale = screenWidth / MAP_WIDTH;
  const displayHeight = MAP_HEIGHT * mapScale;

  const [selectedDirector, setSelectedDirector] = useState<DirectorType | null>(null);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* 맵 + 캐릭터를 감싸는 컨테이너 */}
        <View style={{ width: screenWidth, height: displayHeight }}>
          {/* 맵 이미지 (뒤쪽 레이어) */}
          <Image
            source={MAP_IMAGE}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: screenWidth,
              height: displayHeight,
            }}
            resizeMode="contain"
          />

          {/* 캐릭터 배치 (앞쪽 레이어) */}
          {DIRECTORS.map((d) => (
            <Character
              key={d.type}
              type={d.type}
              x={d.x}
              y={d.y}
              mapScale={mapScale}
              onPress={() => setSelectedDirector(d.type)}
            />
          ))}
        </View>
      </ScrollView>

      {/* 디렉터 탭 시 간단한 대화창 */}
      <Modal
        visible={selectedDirector !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedDirector(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.dialogBox}>
            {selectedDirector && (
              <>
                <Image
                  source={PORTRAITS[selectedDirector]}
                  style={styles.portrait}
                />
                <Text style={styles.directorName}>
                  {DIRECTOR_NAMES[selectedDirector]}
                </Text>
                <Text style={styles.directorRole}>
                  {DIRECTOR_ROLES[selectedDirector]}
                </Text>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => setSelectedDirector(null)}
                >
                  <Text style={styles.closeText}>닫기</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  scrollView: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  dialogBox: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  portrait: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#e94560',
    marginBottom: 12,
  },
  directorName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  directorRole: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 20,
  },
  closeButton: {
    backgroundColor: '#e94560',
    paddingHorizontal: 40,
    paddingVertical: 12,
    borderRadius: 25,
  },
  closeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
