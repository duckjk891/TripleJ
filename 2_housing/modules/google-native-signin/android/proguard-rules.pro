# Credential Manager 가 Play 서비스 구현을 리플렉션으로 찾는다(코드 축소 시 유지)
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** {
  *;
}
