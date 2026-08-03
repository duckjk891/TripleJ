import LegalDocument from '../components/LegalDocument';
import { TERMS } from '../constants/legalTexts';

export default function TermsPage() {
  return <LegalDocument doc={TERMS} />;
}
