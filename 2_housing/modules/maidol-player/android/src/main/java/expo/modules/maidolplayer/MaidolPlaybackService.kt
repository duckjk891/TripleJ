// v3.392 [NativePlayer] 안드로이드 음악 재생 서비스 — Media3 ExoPlayer 1개 + MediaLibrarySession.
//
// 왜(대표 갤럭시 실측 10-21): expo-audio 심은 ① 곡마다 플레이어를 새로 만들어 '다음' 연타·전환 경합 때 두 곡이
// 겹쳐 나오고 ② 잠금화면/차에 다음·이전 명령이 없으며 ③ 곡 끝 → 다음 곡 전환을 JS 가 해서 화면이 꺼지면 끊겼다.
// 이 서비스는:
//  · 플레이어가 하나뿐이다(겹침 구조적으로 불가). 곡 목록(현재 곡 + 다음 곡 + 들은 곡 몇 개)을 네이티브가 들고
//    곡 끝에서 JS 없이 바로 다음 곡으로 넘어간다(ExoPlayer 가 다음 곡을 미리 받아 둔다).
//  · 포그라운드 서비스(mediaPlayback) — 화면이 꺼져도 프로세스·네트워크가 유지된다(WAKE_MODE_NETWORK).
//  · MediaSession 이 잠금화면·알림·블루투스·차(안드로이드 오토) 의 재생/일시정지/다음/이전을 직접 처리한다.
//    다음 곡이 아직 목록에 없을 때 '다음'은 JS 에 알려(onNeedNext) 추천곡을 붙이게 한다.
//  · 네트워크 순간 단절은 여기서 재시도한다(JS 가 잠들어 있어도 동작).
package expo.modules.maidolplayer

import android.app.PendingIntent
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

internal const val TAG = "NativePlayer"
private const val ROOT_ID = "maidol_root"

// 순간 단절 재시도 간격(ms) — 다 쓰면 최종 오류로 JS 에 알린다(JS 가 곡 소멸 여부를 보고 건너뛰기)
private val RETRY_DELAYS_MS = longArrayOf(2_000, 5_000, 10_000, 20_000)

/** 서비스(플레이어 쪽)와 모듈(JS 쪽)이 같은 프로세스에서 나누는 상태 */
internal object PlaybackShared {
  @Volatile var retryScheduled = false
  @Volatile var retryAttempt = 0
  /** 다음 곡이 목록에 없는데 '다음'(차·블루투스·잠금화면)이 눌림 → 모듈이 JS 로 onNeedNext 전달 */
  @Volatile var needNextListener: ((String) -> Unit)? = null
  /** 서비스가 이 프로세스에 살아 있음 — 앱 화면만 다시 열린 경우 재생 중인 곡을 이어받는 판단에 쓴다 */
  @Volatile var serviceAlive = false
}

/** mediaId = "<트랙 id>#<순번>" — 같은 곡이 목록에 두 번 들어가도 구분된다 */
internal fun trackIdOf(item: MediaItem?): String = item?.mediaId?.substringBefore('#') ?: ""

internal fun httpStatusOf(error: Throwable?): Int? {
  var c: Throwable? = error
  while (c != null) {
    if (c is HttpDataSource.InvalidResponseCodeException) return c.responseCode
    c = c.cause
  }
  return null
}

/** 다시 시도할 만한 오류 — 네트워크 끊김·시간 초과·서버 5xx. 4xx(곡 삭제 등)는 재시도하지 않는다 */
internal fun isTransientError(error: PlaybackException): Boolean {
  val http = httpStatusOf(error)
  if (http != null) return http >= 500 || http == 408 || http == 429
  return error.errorCode in 2000..2999 || error.errorCode == PlaybackException.ERROR_CODE_TIMEOUT
}

@OptIn(UnstableApi::class)
private class MaidolForwardingPlayer(player: Player) : ForwardingPlayer(player) {
  // 다음/이전 버튼이 항상 보이게(다음 곡이 아직 안 붙었어도 차·잠금화면에 버튼 유지)
  override fun getAvailableCommands(): Player.Commands =
    super.getAvailableCommands().buildUpon()
      .add(Player.COMMAND_SEEK_TO_NEXT)
      .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
      .add(Player.COMMAND_SEEK_TO_PREVIOUS)
      .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
      .build()

  override fun isCommandAvailable(command: Int): Boolean = availableCommands.contains(command)

  override fun seekToNext() {
    if (hasNextMediaItem()) super.seekToNext() else requestNext("seekToNext")
  }

  override fun seekToNextMediaItem() {
    if (hasNextMediaItem()) super.seekToNextMediaItem() else requestNext("seekToNextMediaItem")
  }

  private fun requestNext(from: String) {
    Log.i(TAG, "[NativePlayer] next requested with no queued item → JS ($from)")
    PlaybackShared.needNextListener?.invoke(from)
  }
}

@OptIn(UnstableApi::class)
class MaidolPlaybackService : MediaLibraryService() {
  private var exo: ExoPlayer? = null
  private var session: MediaLibrarySession? = null
  private val main = Handler(Looper.getMainLooper())
  private var retryRunnable: Runnable? = null

  private val serviceListener = object : Player.Listener {
    override fun onIsPlayingChanged(isPlaying: Boolean) {
      if (isPlaying) PlaybackShared.retryAttempt = 0
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      cancelRetry()
      PlaybackShared.retryAttempt = 0
      Log.i(TAG, "[NativePlayer] transition → ${mediaItem?.mediaId} reason=$reason")
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
      stopIfEmpty()
    }

    override fun onTimelineChanged(timeline: Timeline, reason: Int) {
      stopIfEmpty()
    }

    override fun onPlayerError(error: PlaybackException) {
      val p = exo ?: return
      val http = httpStatusOf(error)
      if (isTransientError(error) && PlaybackShared.retryAttempt < RETRY_DELAYS_MS.size) {
        val delay = RETRY_DELAYS_MS[PlaybackShared.retryAttempt]
        PlaybackShared.retryAttempt += 1
        PlaybackShared.retryScheduled = true
        Log.w(TAG, "[NativePlayer] error ${error.errorCodeName} http=$http → retry #${PlaybackShared.retryAttempt} in ${delay}ms (${trackIdOf(p.currentMediaItem)})")
        cancelRetry()
        val r = Runnable {
          PlaybackShared.retryScheduled = false
          val pl = exo ?: return@Runnable
          if (pl.playbackState == Player.STATE_IDLE && pl.mediaItemCount > 0) pl.prepare()
        }
        retryRunnable = r
        main.postDelayed(r, delay)
      } else {
        PlaybackShared.retryScheduled = false
        Log.w(TAG, "[NativePlayer] final error ${error.errorCodeName} http=$http (${trackIdOf(p.currentMediaItem)})")
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    // 곡 하나(수 MB)를 통째로 받아 둘 만큼 버퍼를 크게 — 받아 둔 뒤엔 네트워크가 잠깐 끊겨도 끊김 없음.
    // (바이트 상한은 기본값 — 오디오 약 13MB. 현재 곡을 다 받으면 다음 곡을 미리 받기 시작한다)
    val loadControl = DefaultLoadControl.Builder()
      .setBufferDurationsMs(60_000, 600_000, 1_500, 3_000)
      .build()
    val player = ExoPlayer.Builder(this)
      .setAudioAttributes(
        AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
        true, // 오디오 포커스(전화·다른 앱) 자동 처리
      )
      .setHandleAudioBecomingNoisy(true) // 이어폰 빠짐·블루투스 끊김 → 일시정지(음악 앱 관례)
      .setWakeMode(C.WAKE_MODE_NETWORK) // 화면 꺼져도 CPU·와이파이 유지
      .setLoadControl(loadControl)
      .build()
    player.addListener(serviceListener)
    exo = player

    val builder = MediaLibrarySession.Builder(this, MaidolForwardingPlayer(player), LibraryCallback())
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      builder.setSessionActivity(
        PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
      )
    }
    session = builder.build()

    val provider = DefaultMediaNotificationProvider.Builder(this)
      .setChannelId("maidol_playback")
      .setChannelName(R.string.maidol_player_channel_name)
      .build()
    // expo-notifications 가 만든 앱 알림 아이콘이 있으면 그것을 쓴다(없으면 Media3 기본)
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName)
    if (icon != 0) provider.setSmallIcon(icon)
    setMediaNotificationProvider(provider)
    PlaybackShared.serviceAlive = true
    Log.i(TAG, "[NativePlayer] service created")
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  override fun onTaskRemoved(rootIntent: Intent?) {
    // 앱을 최근 목록에서 지웠을 때: 재생 중이면 계속(음악 앱 관례), 멈춰 있으면 서비스 종료
    val p = exo
    if (p == null || !p.playWhenReady || p.mediaItemCount == 0) {
      Log.i(TAG, "[NativePlayer] task removed while idle → stop service")
      stopSelf()
    }
  }

  override fun onDestroy() {
    Log.i(TAG, "[NativePlayer] service destroyed")
    PlaybackShared.serviceAlive = false
    cancelRetry()
    session?.run {
      player.release()
      release()
    }
    session = null
    exo = null
    super.onDestroy()
  }

  private fun cancelRetry() {
    retryRunnable?.let { main.removeCallbacks(it) }
    retryRunnable = null
    PlaybackShared.retryScheduled = false
  }

  /** 미니플레이어 닫기(목록 비움) → 서비스·알림 정리. 앱(모듈)이 연결을 놓으면 서비스가 끝난다 */
  private fun stopIfEmpty() {
    val p = exo ?: return
    if (p.mediaItemCount == 0 && p.playbackState == Player.STATE_IDLE) {
      cancelRetry()
      stopSelf()
    }
  }

  /** 컨트롤러가 보낸 항목은 재생 주소가 빠져 올 수 있다 — requestMetadata.mediaUri 로 되살린다 */
  private fun resolveItem(item: MediaItem, p: Player): MediaItem {
    if (item.localConfiguration != null) return item
    val uri = item.requestMetadata.mediaUri
    if (uri != null) return item.buildUpon().setUri(uri).build()
    // 차 화면 목록에서 고른 항목(mediaId 만 옴) — 지금 재생 목록에서 찾는다
    for (i in 0 until p.mediaItemCount) {
      val m = p.getMediaItemAt(i)
      if (m.mediaId == item.mediaId) return m
    }
    return item
  }

  private inner class LibraryCallback : MediaLibrarySession.Callback {
    override fun onGetLibraryRoot(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      params: MediaLibraryService.LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      val root = MediaItem.Builder()
        .setMediaId(ROOT_ID)
        .setMediaMetadata(
          MediaMetadata.Builder()
            .setTitle(getString(R.string.maidol_player_library_root))
            .setIsBrowsable(true)
            .setIsPlayable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
            .build(),
        )
        .build()
      return Futures.immediateFuture(LibraryResult.ofItem(root, params))
    }

    // 차 화면 '목록' = 지금 재생 목록(들은 곡 + 현재 곡 + 다음 곡)
    override fun onGetChildren(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      page: Int,
      pageSize: Int,
      params: MediaLibraryService.LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      val p = session.player
      val items = if (parentId == ROOT_ID) (0 until p.mediaItemCount).map { p.getMediaItemAt(it) } else emptyList()
      return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(items), params))
    }

    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>,
    ): ListenableFuture<MutableList<MediaItem>> {
      val p = mediaSession.player
      return Futures.immediateFuture(mediaItems.map { resolveItem(it, p) }.toMutableList())
    }
  }
}
