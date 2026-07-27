# Test environment for the Shares subsystem (mergerfs pooling + SMB/NFS export).
# NOT for production and NOT part of the shipped app — this exists purely so
# RealShareApplier's mount/samba/nfs code can be exercised against something
# real without touching the host machine's actual filesystem/services.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    mergerfs \
    xfsprogs \
    e2fsprogs \
    btrfs-progs \
    util-linux \
    samba \
    smbclient \
    nfs-kernel-server \
    procps \
    iproute2 \
  && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY smb.conf.base /etc/samba/smb.conf
COPY exports.base /etc/exports
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sleep", "infinity"]
