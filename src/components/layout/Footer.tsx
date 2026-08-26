import { useTranslation } from 'react-i18next';

export function Footer() {
  const { t } = useTranslation('layout');
  return <div className="footer">{t('Footer.text')}</div>;
}
