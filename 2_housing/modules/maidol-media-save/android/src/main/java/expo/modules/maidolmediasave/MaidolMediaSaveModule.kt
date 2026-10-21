// v3.391 [NativeSave] 안드로이드 MediaStore 직접 저장 — 폴더 고르기(SAF) 없이 기기 공용 폴더에 바로 넣는다.
// 갤럭시에서 폴더 선택 창으로 구글 드라이브 폴더를 고르면 쓰기가 막혀 매번 공유 시트로 빠지던 문제(10-21) 대응.
//  · 음원 → Music/MAIDOL, 영상 → Movies/MAIDOL, 사진 → Pictures/MAIDOL (relativeDir 은 JS 가 정한다).
//  · 안드로이드 10(API 29)+ 는 내 앱이 넣는 파일이라 권한이 필요 없다. 9 이하는 E_UNSUPPORTED → JS 가 예전 방식으로.
//  · 파일을 통째로 메모리에 올리지 않고 스트림으로 복사(큰 영상 안전). 실패하면 반쯤 만든 항목은 지운다.
// 오류 코드: E_UNSUPPORTED · E_NO_CONTEXT · E_NO_FILE · E_INSERT · E_WRITE
package expo.modules.maidolmediasave

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream

private const val TAG = "MaidolMediaSave"

class MaidolMediaSaveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MaidolMediaSave")

    Function("isSupported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
    }

    AsyncFunction("saveToMediaStore") { localUri: String, displayName: String, mimeType: String, relativeDir: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        throw CodedException("E_UNSUPPORTED", "MediaStore relative path needs Android 10+", null)
      }
      val context = appContext.reactContext
        ?: throw CodedException("E_NO_CONTEXT", "no react context", null)
      val path = if (localUri.startsWith("file:")) Uri.parse(localUri).path ?: "" else localUri
      val src = File(path)
      if (!src.isFile || src.length() <= 0L) {
        throw CodedException("E_NO_FILE", "source file missing or empty", null)
      }

      val resolver = context.contentResolver
      val collection: Uri = when {
        mimeType.startsWith("audio/") -> MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        mimeType.startsWith("video/") -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        mimeType.startsWith("image/") -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        else -> MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      }
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
        put(MediaStore.MediaColumns.RELATIVE_PATH, relativeDir)
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
      var inserted: Uri? = null
      try {
        inserted = resolver.insert(collection, values)
      } catch (e: Exception) {
        Log.w(TAG, "insert failed dir=$relativeDir msg=${e.message}")
        throw CodedException("E_INSERT", e.message ?: "insert failed", e)
      }
      val item: Uri = inserted ?: throw CodedException("E_INSERT", "insert returned null", null)

      try {
        val out = resolver.openOutputStream(item) ?: throw IllegalStateException("no output stream")
        out.use { o -> FileInputStream(src).use { i -> i.copyTo(o, 64 * 1024) } }
        val done = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
        resolver.update(item, done, null, null)
      } catch (e: Exception) {
        Log.w(TAG, "write failed dir=$relativeDir msg=${e.message}")
        try { resolver.delete(item, null, null) } catch (ignored: Exception) {}
        throw CodedException("E_WRITE", e.message ?: "write failed", e)
      }
      Log.i(TAG, "saved dir=$relativeDir bytes=${src.length()}")
      mapOf("uri" to item.toString(), "relativeDir" to relativeDir)
    }
  }
}
