import type { Container } from '../types';

export const CONTAINERS: Container[] = [
  { name: 'jellyfin', image: 'jellyfin/jellyfin:10.9', status: 'running', cpu: '6%', mem: '420 MB', ports: '8096:8096' },
  { name: 'nextcloud', image: 'nextcloud:29', status: 'running', cpu: '3%', mem: '310 MB', ports: '443:443' },
  { name: 'mergerfs-mover', image: 'monstermuffin/mergerfs-cache-mover', status: 'stopped', cpu: '—', mem: '—', ports: '—' },
  { name: 'qbittorrent', image: 'linuxserver/qbittorrent', status: 'running', cpu: '11%', mem: '180 MB', ports: '8080:8080' },
];
