// v3.400 [ModalTurn] 화면 안 창(시트·편집 창·확인 창 등) 공용 Modal — react-native Modal 대신 이것을 쓴다.
// iOS 는 이미 창이 떠 있는 곳에 다른 창을 겹쳐 띄우지 못하고(조용히 안 뜸), RN 은 실패를 '떠 있음'으로 기억해 그 뒤 팝업까지 막힌다
// (대표 아이폰 실기기 10-22 '팝업 무반응' — 편곡 ⭐ 확인·크루 관리·회원탈퇴·곡 메뉴 등 45곳 점검).
//  · 이 창이 떠 있는 동안 생긴 확인·오류 창(showAlert)은 창 안의 AppDialogHost 가 띄운다.
//  · 다른 창이 떠 있거나 닫히는 중이면 닫힘이 끝난 뒤 연다(최대 1.5초). 이 창 안에서 연 창은 기다리지 않는다(정상으로 겹침).
//  · 안드로이드·웹은 종전 Modal 그대로.
import { createContext, useContext, useId } from 'react';
import { Modal, Platform, type ModalProps } from 'react-native';
import AppDialogHost from './AppDialogHost';
import { useModalTurn } from '../utils/modalTurn';

const InsideModal = createContext(false);
const IOS = Platform.OS === 'ios';

function IosAppModal({ visible, children, ...rest }: ModalProps) {
  const id = useId();
  const nested = useContext(InsideModal);
  const want = !!visible;
  const granted = useModalTurn(`modal${id}`, want && !nested, 9, 1500);
  const shown = nested ? want : granted;
  return (
    <Modal {...rest} visible={shown}>
      <InsideModal.Provider value>
        {children}
        <AppDialogHost nestedIn={`modal${id}`} active={shown} />
      </InsideModal.Provider>
    </Modal>
  );
}

export default function AppModal(props: ModalProps) {
  return IOS ? <IosAppModal {...props} /> : <Modal {...props} />;
}
