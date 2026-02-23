# Tasks: The Reanimator Evolution

## Phase 1: Hybrid Fleet Management (The Unification)
- [x] **Database Schema Update** <!-- id: 0 -->
    - [x] Design table for `linux_hosts` (host, port, user, key, etc.) <!-- id: 1 -->
    - [x] Create migration script <!-- id: 2 -->
- [x] **Backend Implementation** <!-- id: 3 -->
    - [x] Create server actions for adding/removing Linux hosts <!-- id: 4 -->
    - [x] Implement SSH connectivity check for generic hosts <!-- id: 5 -->
    - [x] Create resource fetching (CPU/RAM/Disk) for generic Linux hosts <!-- id: 6 -->
- [x] **Frontend Implementation** <!-- id: 7 -->
    - [x] Create "Add Server" Dialog (supporting both Proxmox & Plain Linux) <!-- id: 8 -->
    - [x] Update Dashboard to display mixed fleet (Proxmox Nodes + Linux Servers) <!-- id: 9 -->
    - [x] Create Detail View for Linux Servers <!-- id: 10 -->

## Phase 2: Soul Transfer (Service Migration)
- [x] **P2V / V2C Analysis** <!-- id: 11 -->
    - [x] Implement service discovery (Docker scan, Systemd scan) <!-- id: 12 -->
    - [x] Create "Soul Extraction" logic (Backup configs) <!-- id: 13 -->
- [x] **Reanimation Logic** <!-- id: 14 -->
    - [x] Create LXC generator from Docker Compose <!-- id: 15 -->
    - [x] Implement transport mechanism (SCP/Rsync to Proxmox) <!-- id: 16 -->

## Phase 3: Necromancer Mode (Automation)
- [x] **Wake-on-LAN Orchestration** <!-- id: 17 -->
- [x] **Emergency Takeover Scripts** <!-- id: 18 -->
