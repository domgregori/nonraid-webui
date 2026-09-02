import { request } from './request';
import { streamNdjson } from './progressStream';
import type {
  DockerImportCommitResult,
  DockerImportProgress,
  ShareImportProgress,
  UnraidImportCommitResult,
  UnraidImportPreview,
} from '../types/unraidImportApi';

export const unraidImportApi = {
  previewArchive: (file: File) => {
    const form = new FormData();
    form.append('mode', 'archive');
    form.append('files', file);
    return request<UnraidImportPreview>('/api/unraid-import/preview', { method: 'POST', body: form });
  },
  previewFolder: (files: File[]) => {
    const form = new FormData();
    form.append('mode', 'folder');
    form.append('paths', JSON.stringify(files.map((f) => f.webkitRelativePath || f.name)));
    for (const file of files) form.append('files', file);
    return request<UnraidImportPreview>('/api/unraid-import/preview', { method: 'POST', body: form });
  },
  commitShares: (token: string, shareNames: string[], onProgress: (p: ShareImportProgress) => void) =>
    streamNdjson<ShareImportProgress, UnraidImportCommitResult>(
      '/api/unraid-import/commit-shares',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, shareNames }) },
      onProgress,
    ),
  commitDockerContainers: (token: string, containerNames: string[], onProgress: (p: DockerImportProgress) => void) =>
    streamNdjson<DockerImportProgress, DockerImportCommitResult>(
      '/api/unraid-import/commit-docker-containers',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, containerNames }) },
      onProgress,
    ),
};
