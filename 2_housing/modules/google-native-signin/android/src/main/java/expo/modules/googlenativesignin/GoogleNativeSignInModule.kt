// v3.385 [GoogleNative] 안드로이드 구글 로그인 — 시스템 계정 선택창(Credential Manager · Sign in with Google).
// 브라우저(Custom Tab) 계정 선택 화면에서 이메일 글씨를 누르면 갤럭시가 Gmail 새 메일 창을 여는 문제(10-21) 대응.
// 결과는 id_token·nonce 만 JS 로 넘기고(서버 POST /api/auth/google/native 가 검증), 토큰 값은 로그에 남기지 않는다.
// 오류 코드(JS 쪽 폴백 판단용):
//   E_CANCELLED       사용자가 닫음(메시지에 [16] reauth 가 있으면 설정 오류일 수 있어 JS 가 폴백)
//   E_NO_CREDENTIAL   쓸 수 있는 계정·자격 증명 없음
//   E_PROVIDER_CONFIG Play 서비스(자격 증명 제공자) 없음·사용 불가
//   E_UNSUPPORTED     기기가 Credential Manager 미지원
//   E_GET_CREDENTIAL  그 밖의 Credential Manager 오류(개발자 설정 오류 [10]/[28444] 등)
//   E_PARSE / E_UNEXPECTED_CREDENTIAL / E_NO_ACTIVITY / E_UNKNOWN
package expo.modules.googlenativesignin

import android.util.Base64
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.launch
import java.security.SecureRandom

private const val TAG = "GoogleNative"

// 요청마다 새 nonce — 서버가 id_token 의 nonce 와 대조(재사용 방지)
private fun newNonce(): String {
  val bytes = ByteArray(32)
  SecureRandom().nextBytes(bytes)
  return Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING)
}

class GoogleNativeSignInModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GoogleNativeSignIn")

    AsyncFunction("signIn") { serverClientId: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("E_NO_ACTIVITY", "no current activity", null)
        return@AsyncFunction
      }
      val nonce = newNonce()
      val option = GetSignInWithGoogleOption.Builder(serverClientId).setNonce(nonce).build()
      val request = GetCredentialRequest.Builder().addCredentialOption(option).build()

      appContext.mainQueue.launch {
        try {
          val result = CredentialManager.create(activity).getCredential(activity, request)
          val credential = result.credential
          if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            val google = GoogleIdTokenCredential.createFrom(credential.data)
            Log.i(TAG, "signIn ok tokenLen=${google.idToken.length}")
            promise.resolve(mapOf("idToken" to google.idToken, "nonce" to nonce))
          } else {
            Log.w(TAG, "unexpected credential type=${credential.type}")
            promise.reject("E_UNEXPECTED_CREDENTIAL", "unexpected credential type", null)
          }
        } catch (e: GetCredentialCancellationException) {
          Log.i(TAG, "cancelled msg=${e.message}")
          promise.reject("E_CANCELLED", e.message ?: "cancelled", e)
        } catch (e: NoCredentialException) {
          Log.w(TAG, "no credential msg=${e.message}")
          promise.reject("E_NO_CREDENTIAL", e.message ?: "no credential", e)
        } catch (e: GetCredentialProviderConfigurationException) {
          Log.w(TAG, "provider config msg=${e.message}")
          promise.reject("E_PROVIDER_CONFIG", e.message ?: "provider configuration", e)
        } catch (e: GetCredentialUnsupportedException) {
          Log.w(TAG, "unsupported msg=${e.message}")
          promise.reject("E_UNSUPPORTED", e.message ?: "unsupported", e)
        } catch (e: GetCredentialException) {
          Log.w(TAG, "get credential type=${e.type} msg=${e.message}")
          promise.reject("E_GET_CREDENTIAL", "${e.type}: ${e.message ?: ""}", e)
        } catch (e: GoogleIdTokenParsingException) {
          Log.w(TAG, "parse failed")
          promise.reject("E_PARSE", "id token parse failed", e)
        } catch (e: Exception) {
          Log.w(TAG, "unknown ${e.javaClass.simpleName}")
          promise.reject("E_UNKNOWN", e.javaClass.simpleName, e)
        }
      }
    }
  }
}
