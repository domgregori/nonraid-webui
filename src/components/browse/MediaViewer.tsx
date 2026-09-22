import { useTranslation } from 'react-i18next';
import type { MediaKind } from '../../utils/mediaKind';

interface MediaViewerProps {
  url: string;
  fileName: string;
  kind: MediaKind;
  onClose: () => void;
}

// Always read-only, unlike EditFileDialog - there's no such thing as "editing" an image/video/
// audio/pdf in this app, so there's no save path or dirty-tracking to build here at all.
export function MediaViewer({ url, fileName, kind, onClose }: MediaViewerProps) {
  const { t } = useTranslation('browse');
  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog browse-editor-dialog">
        <div className="dialog__head">
          <div className="dialog__title">{fileName}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('MediaViewer.close')}>
            &#10005;
          </button>
        </div>
        <div className="dialog__body browse-media-body">
          {kind === 'image' && <img className="browse-media-image" src={url} alt={fileName} />}
          {kind === 'video' && (
            <video className="browse-media-video" src={url} controls>
              {t('MediaViewer.videoUnsupported')}
            </video>
          )}
          {kind === 'audio' && (
            <audio className="browse-media-audio" src={url} controls>
              {t('MediaViewer.audioUnsupported')}
            </audio>
          )}
          {kind === 'pdf' && <iframe className="browse-media-pdf" src={url} title={fileName} />}
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('MediaViewer.close')}
          </button>
        </div>
      </div>
    </>
  );
}
