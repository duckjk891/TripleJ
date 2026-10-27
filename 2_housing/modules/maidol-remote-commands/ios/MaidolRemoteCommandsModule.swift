// v3.416 [RemoteCmd] 잠금화면·제어센터·이어폰·차량의 '다음 곡/이전 곡' 버튼(iOS).
// expo-audio 1.1.1 은 재생/일시정지·위치 이동·10초 이동만 등록하고 다음/이전 곡 명령은 없다(대표 아이폰 10-27 "잠금화면 다음곡 못 누름").
// 여기서 MPRemoteCommandCenter 의 nextTrack/previousTrack 만 따로 등록해 JS 로 넘긴다(expo-audio 명령과 충돌 없음).
import ExpoModulesCore
import MediaPlayer

public class MaidolRemoteCommandsModule: Module {
  private var nextTarget: Any?
  private var prevTarget: Any?

  public func definition() -> ModuleDefinition {
    Name("MaidolRemoteCommands")

    Events("onRemoteNext", "onRemotePrevious")

    Function("setEnabled") { (enabled: Bool) in
      DispatchQueue.main.async { [weak self] in
        self?.apply(enabled)
      }
    }

    OnDestroy {
      DispatchQueue.main.async { [weak self] in
        self?.apply(false)
      }
    }
  }

  private func apply(_ enabled: Bool) {
    let center = MPRemoteCommandCenter.shared()
    if let t = nextTarget {
      center.nextTrackCommand.removeTarget(t)
      nextTarget = nil
    }
    if let t = prevTarget {
      center.previousTrackCommand.removeTarget(t)
      prevTarget = nil
    }
    center.nextTrackCommand.isEnabled = enabled
    center.previousTrackCommand.isEnabled = enabled
    guard enabled else { return }
    nextTarget = center.nextTrackCommand.addTarget { [weak self] _ in
      self?.sendEvent("onRemoteNext", [:])
      return .success
    }
    prevTarget = center.previousTrackCommand.addTarget { [weak self] _ in
      self?.sendEvent("onRemotePrevious", [:])
      return .success
    }
  }
}
