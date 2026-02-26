/**
 * Proxmox Config Knowledge Base
 * 
 * Complete taxonomy of all Proxmox configuration files with:
 * - Descriptions (DE/EN)
 * - Risk levels
 * - Merge strategies
 * - Consequence analysis (what happens if ignored vs restored)
 * - Auto-sync behavior in cluster mode
 */

export type ConfigCategory = 'cluster' | 'network' | 'storage' | 'vm' | 'system' | 'auth' | 'cron';
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type MergeStrategy = 'overwrite' | 'merge' | 'skip-auto-synced' | 'dangerous' | 'compare-first';
export type Recommendation = 'restore' | 'skip' | 'merge' | 'compare-first';
export type ParseFormat = 'ini' | 'keyvalue' | 'json' | 'raw' | 'fstab' | 'corosync' | 'pve-conf' | 'interfaces';

export interface ConsequenceAnalysis {
    ifIgnored: { de: string; en: string };
    ifRestored: { de: string; en: string };
    recommendation: Recommendation;
}

export interface ProxmoxConfigFile {
    path: string;
    // Glob pattern for matching (e.g. /etc/pve/nodes/NODE/qemu-server/VMID.conf)
    pattern?: string;
    category: ConfigCategory;
    risk: RiskLevel;
    description: { de: string; en: string };
    mergeStrategy: MergeStrategy;
    /** true = relevant for cluster membership */
    clusterRelevant: boolean;
    /** true = automatically synced via pmxcfs across cluster nodes */
    autoSynced: boolean;
    /** true = can only be written when pmxcfs runs in local mode (pmxcfs -l) */
    needsLocalMode: boolean;
    /** true = lives inside /etc/pve (the FUSE filesystem) */
    isPveFuse: boolean;
    parseFormat: ParseFormat;
    /** Order for restore execution (lower = earlier) */
    restoreOrder: number;
    consequences: ConsequenceAnalysis;
}

/**
 * The complete Proxmox config file taxonomy.
 * Files are ordered by restore priority.
 */
export const PROXMOX_CONFIG_MAP: ProxmoxConfigFile[] = [
    // ═══════════════════════════════════════════════════════════════
    // SYSTEM IDENTITY (restore first)
    // ═══════════════════════════════════════════════════════════════
    {
        path: '/etc/hostname',
        category: 'system',
        risk: 'high',
        description: {
            de: 'Hostname der Node. Muss exakt zum Cluster-Node-Namen passen, sonst erkennt der Cluster die Node nicht.',
            en: 'Node hostname. Must exactly match the cluster node name, otherwise the cluster won\'t recognize this node.'
        },
        mergeStrategy: 'compare-first',
        clusterRelevant: true,
        autoSynced: false,
        needsLocalMode: false,
        isPveFuse: false,
        parseFormat: 'raw',
        restoreOrder: 10,
        consequences: {
            ifIgnored: {
                de: 'Wenn der Hostname nach Neuinstallation anders ist, wird die Node nicht als das richtige Cluster-Mitglied erkannt.',
                en: 'If hostname differs after reinstall, the node won\'t be recognized as the correct cluster member.'
            },
            ifRestored: {
                de: 'Hostname wird korrekt gesetzt. Wichtig für Cluster-Erkennung und /etc/pve/nodes/<hostname>.',
                en: 'Hostname set correctly. Important for cluster recognition and /etc/pve/nodes/<hostname>.'
            },
            recommendation: 'compare-first'
        }
    },
    {
        path: '/etc/hosts',
        category: 'network',
        risk: 'high',
        description: {
            de: 'Lokale DNS-Auflösung. Enthält die IP-Adressen aller Cluster-Nodes. Proxmox braucht dies für die Cluster-Kommunikation.',
            en: 'Local DNS resolution. Contains IP addresses of all cluster nodes. Proxmox needs this for cluster communication.'
        },
        mergeStrategy: 'merge',
        clusterRelevant: true,
        autoSynced: false,
        needsLocalMode: false,
        isPveFuse: false,
        parseFormat: 'raw',
        restoreOrder: 15,
        consequences: {
            ifIgnored: {
                de: '⚠️ Cluster-Nodes können sich nicht gegenseitig auflösen → Cluster-Kommunikation bricht ab, pvecm add kann fehlschlagen.',
                en: '⚠️ Cluster nodes cannot resolve each other → cluster communication fails, pvecm add may fail.'
            },
            ifRestored: {
                de: '✅ Cluster-Node-IPs werden wiederhergestellt. Prüfe ob IPs noch aktuell sind (Node-IPs könnten sich geändert haben).',
                en: '✅ Cluster node IPs restored. Check if IPs are still current (node IPs may have changed).'
            },
            recommendation: 'merge'
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // NETWORK (restore early — needed for connectivity)
    // ═══════════════════════════════════════════════════════════════
    {
        path: '/etc/network/interfaces',
        category: 'network',
        risk: 'critical',
        description: {
            de: 'Netzwerkkonfiguration: IP-Adressen, Bridges (vmbr0), Bonds, VLANs. Ohne korrekte Config ist die Node nicht erreichbar!',
            en: 'Network configuration: IP addresses, bridges (vmbr0), bonds, VLANs. Without correct config, node is unreachable!'
        },
        mergeStrategy: 'merge',
        clusterRelevant: true,
        autoSynced: false,
        needsLocalMode: false,
        isPveFuse: false,
        parseFormat: 'interfaces',
        restoreOrder: 20,
        consequences: {
            ifIgnored: {
                de: '❌ Netzwerk fehlt komplett → Node unerreichbar per SSH und WebGUI! Nur noch physischer Zugang (KVM/IPMI) möglich.',
                en: '❌ Network completely missing → node unreachable via SSH and WebGUI! Only physical access (KVM/IPMI) possible.'
            },
            ifRestored: {
                de: '⚠️ Prüfe Bridge-Namen und IPs! Nach Hardwaretausch können sich NIC-Namen ändern (enp0s25 → enp3s0). Falsche Config = kein Netzwerk.',
                en: '⚠️ Check bridge names and IPs! After hardware change, NIC names may change (enp0s25 → enp3s0). Wrong config = no network.'
            },
            recommendation: 'merge'
        }
    },
    {
        path: '/etc/resolv.conf',
        category: 'network',
        risk: 'low',
        description: {
            de: 'DNS-Server-Konfiguration. Definiert welche Nameserver für DNS-Auflösung verwendet werden.',
            en: 'DNS server configuration. Defines which nameservers are used for DNS resolution.'
        },
        mergeStrategy: 'compare-first',
        clusterRelevant: false,
        autoSynced: false,
        needsLocalMode: false,
        isPveFuse: false,
        parseFormat: 'raw',
        restoreOrder: 25,
        consequences: {
            ifIgnored: {
                de: 'ℹ️ DNS-Auflösung nutzt Standard-Einstellungen. Interne Domains könnten nicht mehr aufgelöst werden.',
                en: 'ℹ️ DNS resolution uses default settings. Internal domains may not be resolved.'
            },
            ifRestored: {
                de: '✅ DNS-Server wiederhergestellt. Normalerweise sicher.',
                en: '✅ DNS servers restored. Usually safe.'
            },
            recommendation: 'compare-first'
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // DISK & STORAGE (critical for data access)
    // ═══════════════════════════════════════════════════════════════
    {
        path: '/etc/fstab',
        category: 'storage',
        risk: 'critical',
        description: {
            de: 'Mountpoints und Disk-UUIDs. Definiert welche Partitionen wo eingehängt werden. Nach Festplattentausch stimmen UUIDs nicht mehr!',
            en: 'Mountpoints and disk UUIDs. Defines which partitions are mounted where. After disk replacement, UUIDs no longer match!'
        },
        mergeStrategy: 'merge',
        clusterRelevant: false,
        autoSynced: false,
        needsLocalMode: false,
        isPveFuse: false,
        parseFormat: 'fstab',
        restoreOrder: 30,
        consequences: {
            ifIgnored: {
                de: '❌ Mountpoints fehlen → Storages nicht verfügbar, VMs können nicht starten. ZFS-Mounts sind hiervon meist nicht betroffen.',
                en: '❌ Mountpoints missing → storages unavailable, VMs cannot start. ZFS mounts are usually not affected.'
            },
            ifRestored: {
                de: '⚠️ VORSICHT bei getauschten Festplatten! Alte UUIDs → Boot-Failure! Verwende den UUID-Merge um alte UUIDs durch neue zu ersetzen.',
                en: '⚠️ CAUTION with replaced disks! Old UUIDs → boot failure! Use UUID merge to replace old UUIDs with new ones.'
            },
            recommendation: 'merge'
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // SSH ACCESS (needed for Reanimator connection)
    // ═══════════════════════════════════════════════════════════════
    {
        path: '/root/.ssh/authorized_keys',
        category: 'auth',
        risk: 'high',
        description: {
            de: 'SSH-Schlüssel für root-Zugang. Enthält den Reanimator-Key und ggf. Cluster-Keys. Ohne diese Datei kein SSH-Zugang!',
            en: 'SSH keys for root access. Contains Reanimator key and possibly cluster keys. Without this file, no SSH access!'
        },
        mergeStrategy: 'merge',
        clusterRelevant: false,
        autoSynced: false,
        needsLocalMode: false,
        isPveFuse: false,
        parseFormat: 'raw',
        restoreOrder: 35,
        consequences: {
            ifIgnored: {
                de: '❌ SSH-Zugang für Reanimator verloren! Nur noch Login per Passwort möglich (falls aktiviert).',
                en: '❌ SSH access for Reanimator lost! Only password login possible (if enabled).'
            },
            ifRestored: {
                de: '✅ SSH-Keys wiederhergestellt. Reanimator und andere Tools haben wieder Zugang.',
                en: '✅ SSH keys restored. Reanimator and other tools have access again.'
            },
            recommendation: 'restore'
        }
    },
    {
        path: '/root/.ssh/known_hosts',
        category: 'auth',
        risk: 'low',
        description: {
            de: 'Bekannte SSH-Fingerprints anderer Server. Verhindert Man-in-the-Middle-Warnungen.',
            en: 'Known SSH fingerprints of other servers. Prevents man-in-the-middle warnings.'
        },
        mergeStrategy: 'overwrite',
        clusterRelevant: false,
        autoSynced: false,
        needsLocalMode: false,
        isPveFuse: false,
        parseFormat: 'raw',
        restoreOrder: 36,
        consequences: {
            ifIgnored: {
                de: 'ℹ️ Fingerprints müssen bei erster Verbindung erneut bestätigt werden. Unkritisch.',
                en: 'ℹ️ Fingerprints must be confirmed again on first connection. Non-critical.'
            },
            ifRestored: {
                de: '✅ SSH-Fingerprints wiederhergestellt. Verbindungen zu bekannten Servern funktionieren ohne Nachfrage.',
                en: '✅ SSH fingerprints restored. Connections to known servers work without prompts.'
            },
            recommendation: 'restore'
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // CLUSTER CONFIG (pmxcfs — FUSE filesystem!)
    // Most are auto-synced and should NOT be restored manually
    // ═══════════════════════════════════════════════════════════════
    {
        path: '/etc/pve/corosync.conf',
        category: 'cluster',
        risk: 'critical',
        description: {
            de: 'Cluster-Konfiguration (Corosync). Definiert alle Cluster-Nodes, Ring-Adressen und Quorum-Einstellungen. Wird via pmxcfs automatisch synchronisiert.',
            en: 'Cluster configuration (Corosync). Defines all cluster nodes, ring addresses, and quorum settings. Auto-synced via pmxcfs.'
        },
        mergeStrategy: 'skip-auto-synced',
        clusterRelevant: true,
        autoSynced: true,
        needsLocalMode: true,
        isPveFuse: true,
        parseFormat: 'corosync',
        restoreOrder: 100,
        consequences: {
            ifIgnored: {
                de: '✅ Wird beim "pvecm add" automatisch vom Cluster gezogen. Kein manuelles Restore nötig.',
                en: '✅ Automatically pulled from cluster during "pvecm add". No manual restore needed.'
            },
            ifRestored: {
                de: '❌ GEFÄHRLICH! Alte corosync.conf kann Quorum-Konflikte verursachen, Node IDs kollidieren, Cluster instabil machen!',
                en: '❌ DANGEROUS! Old corosync.conf can cause quorum conflicts, node ID collisions, make cluster unstable!'
            },
            recommendation: 'skip'
        }
    },
    {
        path: '/etc/pve/authkey.pub',
        category: 'auth',
        risk: 'critical',
        description: {
            de: 'Cluster-weiter öffentlicher Auth-Key. Wird für die Authentifizierung zwischen Nodes verwendet. Via pmxcfs synchronisiert.',
            en: 'Cluster-wide public auth key. Used for inter-node authentication. Synced via pmxcfs.'
        },
        mergeStrategy: 'skip-auto-synced',
        clusterRelevant: true,
        autoSynced: true,
        needsLocalMode: true,
        isPveFuse: true,
        parseFormat: 'raw',
        restoreOrder: 101,
        consequences: {
            ifIgnored: {
                de: '✅ Wird beim Cluster-Join automatisch neu generiert/synchronisiert.',
                en: '✅ Automatically regenerated/synced during cluster join.'
            },
            ifRestored: {
                de: '❌ Alter Key = sofort Auth-Fehler im ganzen Cluster! "authentication failure - invalid PVE ticket" Fehler.',
                en: '❌ Old key = immediate auth failure across entire cluster! "authentication failure - invalid PVE ticket" errors.'
            },
            recommendation: 'skip'
        }
    },
    {
        path: '/etc/pve/priv/authkey.key',
        category: 'auth',
        risk: 'critical',
        description: {
            de: 'Privater Auth-Key der Node. Gegenstück zu authkey.pub. NICHT im Cluster synchronisiert.',
            en: 'Private auth key of the node. Counterpart to authkey.pub. NOT synced across cluster.'
        },
        mergeStrategy: 'dangerous',
        clusterRelevant: true,
        autoSynced: false,
        needsLocalMode: true,
        isPveFuse: true,
        parseFormat: 'raw',
        restoreOrder: 102,
        consequences: {
            ifIgnored: {
                de: '✅ Wird bei "pvecm add" regeneriert. Kein manuelles Restore nötig.',
                en: '✅ Regenerated during "pvecm add". No manual restore needed.'
            },
            ifRestored: {
                de: '❌ Key-Mismatch mit authkey.pub → CSRF-Fehler, Auth-Fehler, WebGUI unbenutzbar!',
                en: '❌ Key mismatch with authkey.pub → CSRF errors, auth failures, WebGUI unusable!'
            },
            recommendation: 'skip'
        }
    },
    {
        path: '/etc/pve/pve-www.key',
        category: 'auth',
        risk: 'critical',
        description: {
            de: '🔑 CSRF-Token-Schlüssel! Generiert die CSRF-Tokens für die WebGUI. DAS ist die Ursache für CSRF-Fehler nach einem Restore!',
            en: '🔑 CSRF token key! Generates CSRF tokens for WebGUI. THIS is the cause of CSRF errors after restore!'
        },
        mergeStrategy: 'dangerous',
        clusterRelevant: false,
        autoSynced: false,
        needsLocalMode: true,
        isPveFuse: true,
        parseFormat: 'raw',
        restoreOrder: 103,
        consequences: {
            ifIgnored: {
                de: '✅ Wird bei Neuinstallation automatisch erzeugt. WebGUI funktioniert normal.',
                en: '✅ Automatically generated during fresh install. WebGUI works normally.'
            },
            ifRestored: {
                de: '❌ DAS VERURSACHT DEN CSRF-FEHLER! Alter Key = ungültige CSRF-Tokens = WebGUI komplett kaputt!',
                en: '❌ THIS CAUSES THE CSRF ERROR! Old key = invalid CSRF tokens = WebGUI completely broken!'
            },
            recommendation: 'skip'
        }
    },
    {
        path: '/etc/pve/pve-root-ca.pem',
        category: 'auth',
        risk: 'high',
        description: {
            de: 'Root-CA-Zertifikat des Clusters. Basis für die SSL-Kette aller Node-Zertifikate.',
            en: 'Cluster root CA certificate. Foundation for SSL chain of all node certificates.'
        },
        mergeStrategy: 'skip-auto-synced',
        clusterRelevant: true,
        autoSynced: true,
        needsLocalMode: true,
        isPveFuse: true,
        parseFormat: 'raw',
        restoreOrder: 104,
        consequences: {
            ifIgnored: {
                de: '✅ Wird via pmxcfs vom Cluster synchronisiert.',
                en: '✅ Synced from cluster via pmxcfs.'
            },
            ifRestored: {
                de: '⚠️ Kann die SSL-Kette brechen wenn der Cluster inzwischen ein neues CA hat.',
                en: '⚠️ Can break SSL chain if cluster has a new CA in the meantime.'
            },
            recommendation: 'skip'
        }
    },
    {
        path: '/etc/pve/nodes/*/pve-ssl.pem',
        pattern: '/etc/pve/nodes/*/pve-ssl.pem',
        category: 'auth',
        risk: 'medium',
        description: {
            de: 'Node-spezifisches SSL-Zertifikat für die WebGUI. Kann über "pvecm updatecerts" regeneriert werden.',
            en: 'Node-specific SSL certificate for WebGUI. Can be regenerated via "pvecm updatecerts".'
        },
        mergeStrategy: 'skip-auto-synced',
        clusterRelevant: false,
        autoSynced: false,
        needsLocalMode: true,
        isPveFuse: true,
        parseFormat: 'raw',
        restoreOrder: 105,
        consequences: {
            ifIgnored: {
                de: '✅ Kann via "pvecm updatecerts" regeneriert werden. Browser zeigt temporär SSL-Warnung.',
                en: '✅ Can be regenerated via "pvecm updatecerts". Browser shows temporary SSL warning.'
            },
            ifRestored: {
                de: '⚠️ Altes Zertifikat kann zu SSL-Fehlern führen wenn Root-CA geändert wurde.',
                en: '⚠️ Old certificate can cause SSL errors if root CA was changed.'
            },
            recommendation: 'skip'
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // PROXMOX CLUSTER CONFIG (auto-synced, usually skip)
    // ═══════════════════════════════════════════════════════════════
    {
        path: '/etc/pve/storage.cfg',
        category: 'storage',
        risk: 'high',
        description: {
            de: 'Storage-Definitionen: Lokaler Speicher, NFS, CIFS, ZFS, Ceph, LVM. Definiert wo VM-Disks und Backups liegen.',
            en: 'Storage definitions: local storage, NFS, CIFS, ZFS, Ceph, LVM. Defines where VM disks and backups are stored.'
        },
        mergeStrategy: 'compare-first',
        clusterRelevant: true,
        autoSynced: true,
        needsLocalMode: true,
        isPveFuse: true,
        parseFormat: 'pve-conf',
        restoreOrder: 50,
        consequences: {
            ifIgnored: {
                de: '⚠️ Im Cluster: Wird automatisch synchronisiert. Standalone: Lokale Storage-Einstellungen fehlen → VMs finden ihre Disks nicht.',
                en: '⚠️ In cluster: auto-synced. Standalone: local storage settings missing → VMs can\'t find their disks.'
            },
            ifRestored: {
                de: '⚠️ Im Cluster: Wird ohnehin überschrieben. Standalone: Prüfe ob Pfade/IDs noch stimmen (Disk-Tausch!).',
                en: '⚠️ In cluster: will be overwritten anyway. Standalone: check if paths/IDs still match (disk replacement!).'
            },
            recommendation: 'compare-first'
        }
    },
    {
        path: '/etc/pve/datacenter.cfg',
        category: 'cluster',
        risk: 'medium',
        description: {
            de: 'Datacenter-weite Einstellungen: HA, Migration, Console-Typ, MAC-Prefix, Keyboard-Layout.',
            en: 'Datacenter-wide settings: HA, migration, console type, MAC prefix, keyboard layout.'
        },
        mergeStrategy: 'compare-first',
        clusterRelevant: true,
        autoSynced: true,
        needsLocalMode: true,
        isPveFuse: true,
        parseFormat: 'pve-conf',
        restoreOrder: 55,
        consequences: {
            ifIgnored: {
                de: 'ℹ️ Im Cluster: Automatisch synchronisiert. Standalone: Datacenter-Anpassungen (Console, HA) gehen verloren.',
                en: 'ℹ️ In cluster: auto-synced. Standalone: datacenter customizations (console, HA) lost.'
            },
            ifRestored: {
                de: '✅ Im Cluster: Ungefährlich, wird ohnehin synchronisiert. Standalone: Einstellungen wiederhergestellt.',
                en: '✅ In cluster: harmless, will be synced anyway. Standalone: settings restored.'
            },
            recommendation: 'compare-first'
        }
    },
    {
        path: '/etc/pve/user.cfg',
        category: 'auth',
        risk: 'medium',
        description: {
            de: 'Benutzer, Gruppen, Rollen und ACLs. Enthält alle Proxmox-Benutzer und deren Berechtigungen.',
            en: 'Users, groups, roles, and ACLs. Contains all Proxmox users and their permissions.'
        },
        mergeStrategy: 'skip-auto-synced',
        clusterRelevant: true,
        autoSynced: true,
        needsLocalMode: true,
        isPveFuse: true,
        parseFormat: 'raw',
        restoreOrder: 60,
        consequences: {
            ifIgnored: {
                de: '✅ Im Cluster: Wird automatisch synchronisiert. Standalone: Standard-Admin bleibt erhalten.',
                en: '✅ In cluster: auto-synced. Standalone: default admin remains.'
            },
            ifRestored: {
                de: '⚠️ Kann bestehende Berechtigungen des aktuellen Clusters überschreiben!',
                en: '⚠️ Can overwrite existing permissions of the current cluster!'
            },
            recommendation: 'skip'
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // VM & CONTAINER CONFIGS
    // ═══════════════════════════════════════════════════════════════
    {
        path: '/etc/pve/nodes/*/qemu-server/*.conf',
        pattern: '/etc/pve/nodes/*/qemu-server/*.conf',
        category: 'vm',
        risk: 'high',
        description: {
            de: 'QEMU VM-Konfigurationen. Jede .conf-Datei definiert eine VM (RAM, CPU, Disks, Netzwerk). Der Dateiname ist die VMID.',
            en: 'QEMU VM configurations. Each .conf file defines a VM (RAM, CPU, disks, network). Filename is the VMID.'
        },
        mergeStrategy: 'compare-first',
        clusterRelevant: true,
        autoSynced: true,
        needsLocalMode: true,
        isPveFuse: true,
        parseFormat: 'pve-conf',
        restoreOrder: 70,
        consequences: {
            ifIgnored: {
                de: '⚠️ Im Cluster: Automatisch synchronisiert. Standalone: VM-Definitionen fehlen → VMs nicht sichtbar in der WebGUI.',
                en: '⚠️ In cluster: auto-synced. Standalone: VM definitions missing → VMs not visible in WebGUI.'
            },
            ifRestored: {
                de: '⚠️ Disk-Pfade prüfen! Nach Disk-Tausch stimmen Pfade wie "local-lvm:vm-100-disk-0" evtl. nicht mehr. VMs starten sonst nicht.',
                en: '⚠️ Check disk paths! After disk replacement, paths like "local-lvm:vm-100-disk-0" may not match. VMs won\'t start.'
            },
            recommendation: 'compare-first'
        }
    },
    {
        path: '/etc/pve/nodes/*/lxc/*.conf',
        pattern: '/etc/pve/nodes/*/lxc/*.conf',
        category: 'vm',
        risk: 'high',
        description: {
            de: 'LXC Container-Konfigurationen. Jede .conf-Datei definiert einen Container (RAM, CPU, Rootfs, Mountpoints).',
            en: 'LXC container configurations. Each .conf file defines a container (RAM, CPU, rootfs, mountpoints).'
        },
        mergeStrategy: 'compare-first',
        clusterRelevant: true,
        autoSynced: true,
        needsLocalMode: true,
        isPveFuse: true,
        parseFormat: 'pve-conf',
        restoreOrder: 71,
        consequences: {
            ifIgnored: {
                de: '⚠️ Im Cluster: Automatisch synchronisiert. Standalone: Container-Definitionen fehlen → CTs nicht sichtbar.',
                en: '⚠️ In cluster: auto-synced. Standalone: container definitions missing → CTs not visible.'
            },
            ifRestored: {
                de: '⚠️ Rootfs-Pfade prüfen! Nach Storage-Änderungen können Pfade ungültig sein.',
                en: '⚠️ Check rootfs paths! After storage changes, paths may be invalid.'
            },
            recommendation: 'compare-first'
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // FIREWALL
    // ═══════════════════════════════════════════════════════════════
    {
        path: '/etc/pve/firewall/cluster.fw',
        category: 'network',
        risk: 'medium',
        description: {
            de: 'Cluster-weite Firewall-Regeln. Definiert gemeinsame Sicherheitsgruppen und Regeln für alle Nodes.',
            en: 'Cluster-wide firewall rules. Defines shared security groups and rules for all nodes.'
        },
        mergeStrategy: 'skip-auto-synced',
        clusterRelevant: true,
        autoSynced: true,
        needsLocalMode: true,
        isPveFuse: true,
        parseFormat: 'pve-conf',
        restoreOrder: 80,
        consequences: {
            ifIgnored: {
                de: '✅ Im Cluster: Wird automatisch synchronisiert.',
                en: '✅ In cluster: auto-synced.'
            },
            ifRestored: {
                de: '⚠️ Ältere Firewall-Regeln könnten aktuelle sicherheitsrelevante Änderungen überschreiben.',
                en: '⚠️ Older firewall rules could overwrite current security-relevant changes.'
            },
            recommendation: 'skip'
        }
    },
    {
        path: '/etc/pve/firewall/*.fw',
        pattern: '/etc/pve/firewall/*.fw',
        category: 'network',
        risk: 'medium',
        description: {
            de: 'VM-spezifische Firewall-Regeln. Jede .fw-Datei enthält Regeln für eine bestimmte VM/CT.',
            en: 'VM-specific firewall rules. Each .fw file contains rules for a specific VM/CT.'
        },
        mergeStrategy: 'skip-auto-synced',
        clusterRelevant: true,
        autoSynced: true,
        needsLocalMode: true,
        isPveFuse: true,
        parseFormat: 'pve-conf',
        restoreOrder: 81,
        consequences: {
            ifIgnored: {
                de: '✅ Im Cluster: Wird automatisch synchronisiert.',
                en: '✅ In cluster: auto-synced.'
            },
            ifRestored: {
                de: '⚠️ Ältere Regeln könnten aktuellere überschreiben.',
                en: '⚠️ Older rules could overwrite more current ones.'
            },
            recommendation: 'skip'
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // SYSTEM & PACKAGE CONFIG
    // ═══════════════════════════════════════════════════════════════
    {
        path: '/etc/apt/sources.list',
        category: 'system',
        risk: 'low',
        description: {
            de: 'APT Repository-Konfiguration. Definiert Paketquellen für System-Updates.',
            en: 'APT repository configuration. Defines package sources for system updates.'
        },
        mergeStrategy: 'compare-first',
        clusterRelevant: false,
        autoSynced: false,
        needsLocalMode: false,
        isPveFuse: false,
        parseFormat: 'raw',
        restoreOrder: 90,
        consequences: {
            ifIgnored: {
                de: 'ℹ️ Standard-Repos der Neuinstallation werden verwendet. Enterprise/No-Subscription-Anpassungen gehen verloren.',
                en: 'ℹ️ Default repos from fresh install used. Enterprise/no-subscription customizations lost.'
            },
            ifRestored: {
                de: '✅ Repo-Konfiguration wiederhergestellt. Prüfe ob Proxmox-Version noch kompatibel ist.',
                en: '✅ Repo configuration restored. Check if Proxmox version is still compatible.'
            },
            recommendation: 'compare-first'
        }
    },
    {
        path: '/etc/apt/sources.list.d/*',
        pattern: '/etc/apt/sources.list.d/*',
        category: 'system',
        risk: 'low',
        description: {
            de: 'Zusätzliche APT-Repositories (z.B. Proxmox Enterprise, Ceph, No-Subscription).',
            en: 'Additional APT repositories (e.g. Proxmox Enterprise, Ceph, No-Subscription).'
        },
        mergeStrategy: 'compare-first',
        clusterRelevant: false,
        autoSynced: false,
        needsLocalMode: false,
        isPveFuse: false,
        parseFormat: 'raw',
        restoreOrder: 91,
        consequences: {
            ifIgnored: {
                de: 'ℹ️ Zusätzliche Repos fehlen. Enterprise-Key oder Custom-Repos müssen erneut konfiguriert werden.',
                en: 'ℹ️ Additional repos missing. Enterprise key or custom repos must be reconfigured.'
            },
            ifRestored: {
                de: '✅ Zusätzliche Repos wiederhergestellt.',
                en: '✅ Additional repos restored.'
            },
            recommendation: 'compare-first'
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // CRON JOBS
    // ═══════════════════════════════════════════════════════════════
    {
        path: '/var/spool/cron/crontabs/root',
        category: 'cron',
        risk: 'medium',
        description: {
            de: 'Root Cron-Jobs. Enthält geplante automatische Aufgaben (Backups, Maintenance, Monitoring-Scripts).',
            en: 'Root cron jobs. Contains scheduled automatic tasks (backups, maintenance, monitoring scripts).'
        },
        mergeStrategy: 'compare-first',
        clusterRelevant: false,
        autoSynced: false,
        needsLocalMode: false,
        isPveFuse: false,
        parseFormat: 'raw',
        restoreOrder: 85,
        consequences: {
            ifIgnored: {
                de: 'ℹ️ Geplante Aufgaben fehlen (Backup-Scripts, Maintenance). Müssen manuell neu eingerichtet werden.',
                en: 'ℹ️ Scheduled tasks missing (backup scripts, maintenance). Must be reconfigured manually.'
            },
            ifRestored: {
                de: '✅ Cron-Jobs wiederhergestellt. Prüfe ob alle referenzierten Scripts noch existieren.',
                en: '✅ Cron jobs restored. Check if all referenced scripts still exist.'
            },
            recommendation: 'compare-first'
        }
    },
];

/**
 * Get config category display info
 */
export function getCategoryInfo(category: ConfigCategory): { icon: string; label: { de: string; en: string }; color: string } {
    const map: Record<ConfigCategory, { icon: string; label: { de: string; en: string }; color: string }> = {
        cluster: { icon: '🔗', label: { de: 'Cluster', en: 'Cluster' }, color: 'purple' },
        network: { icon: '🌐', label: { de: 'Netzwerk', en: 'Network' }, color: 'blue' },
        storage: { icon: '💾', label: { de: 'Speicher', en: 'Storage' }, color: 'amber' },
        vm: { icon: '🖥️', label: { de: 'VMs & Container', en: 'VMs & Containers' }, color: 'green' },
        system: { icon: '⚙️', label: { de: 'System', en: 'System' }, color: 'gray' },
        auth: { icon: '🔐', label: { de: 'Authentifizierung', en: 'Authentication' }, color: 'red' },
        cron: { icon: '⏰', label: { de: 'Zeitpläne', en: 'Schedules' }, color: 'orange' },
    };
    return map[category];
}

/**
 * Get risk level display info
 */
export function getRiskInfo(risk: RiskLevel): { label: { de: string; en: string }; color: string; icon: string } {
    const map: Record<RiskLevel, { label: { de: string; en: string }; color: string; icon: string }> = {
        critical: { label: { de: 'Kritisch', en: 'Critical' }, color: 'red', icon: '🔴' },
        high: { label: { de: 'Hoch', en: 'High' }, color: 'orange', icon: '🟠' },
        medium: { label: { de: 'Mittel', en: 'Medium' }, color: 'yellow', icon: '🟡' },
        low: { label: { de: 'Niedrig', en: 'Low' }, color: 'green', icon: '🟢' },
    };
    return map[risk];
}

/**
 * Match a file path from backup against the config map.
 * Returns the matching config entry or undefined.
 */
export function matchConfigFile(filePath: string): ProxmoxConfigFile | undefined {
    // Normalize path
    const normalized = filePath.replace(/\\/g, '/').replace(/^\.?\/?/, '/');

    // Try exact match first
    const exact = PROXMOX_CONFIG_MAP.find(c => c.path === normalized);
    if (exact) return exact;

    // Try pattern match
    for (const config of PROXMOX_CONFIG_MAP) {
        if (config.pattern) {
            const regex = new RegExp(
                '^' + config.pattern
                    .replace(/\./g, '\\.')
                    .replace(/\*/g, '[^/]+')
                + '$'
            );
            if (regex.test(normalized)) return config;
        }
    }

    return undefined;
}
