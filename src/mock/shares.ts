import type { Share } from '../types';

export const SHARES: Share[] = [
  { name: 'media', allocMethod: 'High-water', disks: 'Disk 1-6', protocol: 'SMB, NFS', usedTB: 38, sizeTB: 60 },
  { name: 'backups', allocMethod: 'Fill-up', disks: 'Disk 7-8', protocol: 'SMB', usedTB: 9, sizeTB: 26 },
  { name: 'documents', allocMethod: 'Most-free', disks: 'Disk 9-10', protocol: 'SMB, NFS', usedTB: 4, sizeTB: 30 },
  { name: 'appdata', allocMethod: 'Single disk (Disk 3)', disks: 'Disk 3', protocol: 'SMB', usedTB: 1.2, sizeTB: 8 },
];
