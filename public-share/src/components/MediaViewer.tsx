import type { MediaKind } from '../mediaKind';

interface MediaViewerProps {
  url: string;
  fileName: string;
  kind: MediaKind;
  onClose: () => void;
}

// Always read-only, unlike TextEditor - there's no such thing as "editing" an image/video/audio/
// pdf in this app, under any share mode, so there's no save path or dirty-tracking to build here
// at all.
export function MediaViewer({ url, fileName, kind, onClose }: MediaViewerProps) {
  return (
    <div className="ps-overlay" onClick={onClose}>
      <div className="ps-editor" onClick={(e) => e.stopPropagation()}>
        <div className="ps-editor__head">
          <div className="ps-editor__title">{fileName}</div>
          <div className="ps-editor__actions">
            <button type="button" className="ps-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        <div className="ps-media-body">
          {kind === 'image' && <img className="ps-media-image" src={url} alt={fileName} />}
          {kind === 'video' && (
            <video className="ps-media-video" src={url} controls>
              Your browser can't play this video.
            </video>
          )}
          {kind === 'audio' && (
            <audio className="ps-media-audio" src={url} controls>
              Your browser can't play this audio.
            </audio>
          )}
          {kind === 'pdf' && <iframe className="ps-media-pdf" src={url} title={fileName} />}
        </div>

        <div className="ps-editor__footer">
          <button type="button" className="ps-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
