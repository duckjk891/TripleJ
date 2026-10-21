// v3.392 [NativePlayer] JS ↔ 재생 서비스 다리 — MediaController 로 MaidolPlaybackService 의 플레이어를 조작한다.
//
// 목록 모델(JS 가 정하고 네이티브가 미리 들고 있다):
//   [들은 곡(최대 20) …, 현재 곡, 다음 곡]
//  · 다음 곡은 JS(재생목록·셔플·추천 규칙)가 정해 setUpcoming 으로 붙인다 → 곡 끝에서 네이티브가 바로 넘어간다.
//  · 들은 곡을 남겨 두므로 차·잠금화면 '이전' = 실제로 들은 순서(v3.360 정책)와 같다.
//  · playNow 는 같은 플레이어 안에서 곡만 바꾼다 — 플레이어를 새로 만들지 않으니 겹칠 수 없다.
// 이벤트: onTrackChange(곡 바뀜) · onState(재생 상태·위치, 재생 중 1초마다) · onEnded(목록 끝) ·
//        onError(최종 오류·재시도 예정 여부) · onNeedNext(다음 곡 없는데 '다음' 눌림)
package expo.modules.maidolplayer

import android.content.ComponentName
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.Executor

private const val HISTORY_MAX = 20
private const val TICK_MS = 1000L

class TrackItem : Record {
  /** "<트랙 id>#<순번>" */
  @Field val key: String = ""
  @Field val url: String = ""
  @Field val title: String = ""
  @Field val artist: String = ""
  @Field val artwork: String? = null
}

class MaidolPlayerModule : Module() {
  private var controller: MediaController? = null
  private var controllerFuture: ListenableFuture<MediaController>? = null
  private val waiters = mutableListOf<Pair<(MediaController) -> Unit, (Throwable) -> Unit>>()
  private val main = Handler(Looper.getMainLooper())
  private var ticking = false
  /** 재생 중 위치 이벤트 간격 — MV·가사 화면은 JS 가 250ms 로 당긴다(setProgressInterval) */
  private var tickMs = TICK_MS

  private val tick = object : Runnable {
    override fun run() {
      val c = controller
      if (c != null && c.isPlaying) {
        emitState(c)
        main.postDelayed(this, tickMs)
      } else {
        ticking = false
      }
    }
  }

  private val listener = object : Player.Listener {
    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      val c = controller ?: return
      val r = when (reason) {
        Player.MEDIA_ITEM_TRANSITION_REASON_AUTO -> "auto"
        Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT -> "repeat"
        Player.MEDIA_ITEM_TRANSITION_REASON_SEEK -> "seek"
        else -> "playlist"
      }
      Log.i(TAG, "[NativePlayer] onTrackChange ${mediaItem?.mediaId} reason=$r")
      sendEvent("onTrackChange", mapOf("key" to (mediaItem?.mediaId ?: ""), "reason" to r))
      emitState(c)
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      val c = controller ?: return
      emitState(c)
      if (isPlaying && !ticking) {
        ticking = true
        main.postDelayed(tick, tickMs)
      }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
      val c = controller ?: return
      emitState(c)
      if (playbackState == Player.STATE_ENDED) {
        Log.i(TAG, "[NativePlayer] onEnded ${c.currentMediaItem?.mediaId}")
        sendEvent("onEnded", mapOf("key" to (c.currentMediaItem?.mediaId ?: "")))
      }
    }

    override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
      controller?.let { emitState(it) }
    }

    override fun onPlayerError(error: PlaybackException) {
      val c = controller
      val http = httpStatusOf(error)
      sendEvent(
        "onError",
        mapOf(
          "key" to (c?.currentMediaItem?.mediaId ?: ""),
          "code" to error.errorCodeName,
          "message" to (error.message ?: ""),
          "http" to (http ?: 0),
          "willRetry" to PlaybackShared.retryScheduled,
        ),
      )
    }
  }

  override fun definition() = ModuleDefinition {
    Name("MaidolPlayer")

    Events("onTrackChange", "onState", "onError", "onNeedNext", "onEnded")

    OnCreate {
      PlaybackShared.needNextListener = { from ->
        main.post { sendEvent("onNeedNext", mapOf("from" to from)) }
      }
    }

    OnDestroy {
      // JS 가 내려가도(앱 새로고침·최근 목록에서 지움) 재생은 서비스가 이어 간다 — 연결만 놓는다
      PlaybackShared.needNextListener = null
      main.removeCallbacks(tick)
      ticking = false
      releaseController()
    }

    /** 이 프로세스에 재생 서비스가 살아 있는지(앱을 다시 열었을 때 재생 중인 곡 이어받기 판단용) */
    Function("isServiceAlive") { PlaybackShared.serviceAlive }

    AsyncFunction("playNow") { item: TrackItem, upcoming: List<TrackItem>, repeatOne: Boolean, promise: Promise ->
      withController(promise) { c ->
        doPlayNow(c, item, upcoming, repeatOne)
        promise.resolve(stateMap(c))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setUpcoming") { upcoming: List<TrackItem>, promise: Promise ->
      withController(promise) { c ->
        if (c.mediaItemCount > 0) {
          removeAfterCurrent(c)
          if (upcoming.isNotEmpty()) c.addMediaItems(upcoming.map { toMediaItem(it) })
          Log.i(TAG, "[NativePlayer] setUpcoming ${upcoming.map { it.key }}")
        }
        promise.resolve(stateMap(c))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("play") { promise: Promise ->
      withController(promise) { c ->
        if (c.playbackState == Player.STATE_IDLE && c.mediaItemCount > 0) c.prepare()
        if (c.playbackState == Player.STATE_ENDED) c.seekTo(c.currentMediaItemIndex, 0L)
        c.play()
        promise.resolve(stateMap(c))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("pause") { promise: Promise ->
      withController(promise) { c ->
        c.pause()
        promise.resolve(stateMap(c))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("seekTo") { positionMs: Double, promise: Promise ->
      withController(promise) { c ->
        c.seekTo(positionMs.toLong().coerceAtLeast(0L))
        promise.resolve(stateMap(c))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setRepeatOne") { repeatOne: Boolean, promise: Promise ->
      withController(promise) { c ->
        c.repeatMode = if (repeatOne) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setProgressInterval") { ms: Int ->
      tickMs = ms.coerceIn(100, 2000).toLong()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getState") { promise: Promise ->
      withController(promise) { c -> promise.resolve(stateMap(c)) }
    }.runOnQueue(Queues.MAIN)

    /** 미니플레이어 닫기·로그아웃 — 재생 정지 + 목록 비움 + 연결 해제(알림·서비스 정리) */
    AsyncFunction("stop") { promise: Promise ->
      main.removeCallbacks(tick)
      ticking = false
      val c = controller
      if ((c == null || !c.isConnected) && !PlaybackShared.serviceAlive) {
        releaseController()
        promise.resolve(null)
        return@AsyncFunction
      }
      // 연결이 없어도 서비스가 살아 있으면(앱 화면만 다시 뜬 경우) 연결해서 멈춘다 — 유령 재생 방지
      withController(promise) { mc ->
        mc.stop()
        mc.clearMediaItems()
        Log.i(TAG, "[NativePlayer] stop — cleared")
        releaseController()
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)
  }

  // ── 목록 조작 ──────────────────────────────────────────────────────────────

  private fun doPlayNow(c: MediaController, item: TrackItem, upcoming: List<TrackItem>, repeatOne: Boolean) {
    val mi = toMediaItem(item)
    val ups = upcoming.map { toMediaItem(it) }
    val tid = item.key.substringBefore('#')
    val count = c.mediaItemCount
    if (count == 0) {
      c.setMediaItems(listOf(mi) + ups, 0, 0L)
      Log.i(TAG, "[NativePlayer] playNow(new list) ${item.key} upcoming=${upcoming.map { it.key }}")
    } else {
      val cur = c.currentMediaItemIndex.coerceIn(0, count - 1)
      val mode = when {
        // 바로 앞에 들은 곡 = '이전' — 새로 넣지 않고 그 자리로 돌아간다(들은 순서 유지)
        cur >= 1 && trackIdOf(c.getMediaItemAt(cur - 1)) == tid -> {
          c.seekTo(cur - 1, 0L)
          "back"
        }
        // 지금 곡 다시(재생 버튼 복구·한 곡 반복)
        trackIdOf(c.getMediaItemAt(cur)) == tid -> {
          c.seekTo(cur, 0L)
          "same"
        }
        else -> {
          c.addMediaItem(cur + 1, mi)
          c.seekTo(cur + 1, 0L)
          "forward"
        }
      }
      removeAfterCurrent(c)
      if (ups.isNotEmpty()) c.addMediaItems(ups)
      val now = c.currentMediaItemIndex
      if (now > HISTORY_MAX) c.removeMediaItems(0, now - HISTORY_MAX)
      Log.i(TAG, "[NativePlayer] playNow($mode) ${item.key} upcoming=${upcoming.map { it.key }} count=${c.mediaItemCount}")
    }
    c.repeatMode = if (repeatOne) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    if (c.playbackState == Player.STATE_IDLE) c.prepare()
    c.play()
  }

  private fun removeAfterCurrent(c: MediaController) {
    val cur = c.currentMediaItemIndex
    val n = c.mediaItemCount
    if (n > cur + 1) c.removeMediaItems(cur + 1, n)
  }

  private fun toMediaItem(t: TrackItem): MediaItem {
    val uri = Uri.parse(t.url)
    val md = MediaMetadata.Builder()
      .setTitle(t.title)
      .setArtist(t.artist)
      .setIsPlayable(true)
      .setIsBrowsable(false)
      .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
    t.artwork?.takeIf { it.isNotBlank() }?.let { md.setArtworkUri(Uri.parse(it)) }
    return MediaItem.Builder()
      .setMediaId(t.key)
      .setUri(uri)
      .setMediaMetadata(md.build())
      // 컨트롤러 → 세션 전달 시 재생 주소가 빠질 수 있어 요청 메타에도 싣는다(서비스 onAddMediaItems 가 복원)
      .setRequestMetadata(MediaItem.RequestMetadata.Builder().setMediaUri(uri).build())
      .build()
  }

  // ── 상태 ──────────────────────────────────────────────────────────────────

  private fun stateMap(c: MediaController): Map<String, Any?> {
    val idx = c.currentMediaItemIndex
    val n = c.mediaItemCount
    val dur = c.duration
    return mapOf(
      "key" to (c.currentMediaItem?.mediaId ?: ""),
      "nextKey" to (if (n > 0 && idx + 1 < n) c.getMediaItemAt(idx + 1).mediaId else ""),
      "index" to idx,
      "count" to n,
      "positionMs" to c.currentPosition.coerceAtLeast(0L).toDouble(),
      "durationMs" to (if (dur == C.TIME_UNSET || dur < 0) 0.0 else dur.toDouble()),
      "isPlaying" to c.isPlaying,
      "playWhenReady" to c.playWhenReady,
      "state" to when (c.playbackState) {
        Player.STATE_BUFFERING -> "buffering"
        Player.STATE_READY -> "ready"
        Player.STATE_ENDED -> "ended"
        else -> "idle"
      },
      "repeatOne" to (c.repeatMode == Player.REPEAT_MODE_ONE),
    )
  }

  private fun emitState(c: MediaController) {
    sendEvent("onState", stateMap(c))
  }

  // ── 서비스 연결 ────────────────────────────────────────────────────────────

  private fun withController(promise: Promise, block: (MediaController) -> Unit) {
    val run: (MediaController) -> Unit = { c ->
      try {
        block(c)
      } catch (e: Exception) {
        Log.w(TAG, "[NativePlayer] player op failed: ${e.message}")
        promise.reject("E_PLAYER", e.message ?: "player op failed", e)
      }
    }
    val c = controller
    if (c != null && c.isConnected) {
      run(c)
      return
    }
    waiters.add(Pair(run, { e -> promise.reject("E_CONNECT", e.message ?: "player connect failed", e) }))
    connect()
  }

  private fun connect() {
    if (controllerFuture != null) return
    val ctx = appContext.reactContext?.applicationContext
    if (ctx == null) {
      failWaiters(IllegalStateException("react context lost"))
      return
    }
    val token = SessionToken(ctx, ComponentName(ctx, MaidolPlaybackService::class.java))
    val future = MediaController.Builder(ctx, token)
      .setListener(object : MediaController.Listener {
        override fun onDisconnected(controller: MediaController) {
          Log.w(TAG, "[NativePlayer] controller disconnected")
          if (this@MaidolPlayerModule.controller === controller) {
            this@MaidolPlayerModule.controller = null
            controllerFuture = null
          }
        }
      })
      .buildAsync()
    controllerFuture = future
    val onMain = Executor { r -> main.post(r) }
    future.addListener({
      try {
        val mc = future.get()
        controller = mc
        mc.addListener(listener)
        Log.i(TAG, "[NativePlayer] controller connected")
        val ws = waiters.toList()
        waiters.clear()
        ws.forEach { it.first(mc) }
      } catch (e: Exception) {
        Log.w(TAG, "[NativePlayer] controller connect failed: ${e.message}")
        controllerFuture = null
        failWaiters(e)
      }
    }, onMain)
  }

  private fun failWaiters(e: Throwable) {
    val ws = waiters.toList()
    waiters.clear()
    ws.forEach { it.second(e) }
  }

  private fun releaseController() {
    controller?.removeListener(listener)
    controller = null
    controllerFuture?.let { MediaController.releaseFuture(it) }
    controllerFuture = null
  }
}
