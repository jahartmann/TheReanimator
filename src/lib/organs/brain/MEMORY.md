# MEMORY of the Reanimator

*This is the Long-Term Knowledge Store. It serves as your permanent record of the infrastructure.*

> **INSTRUCTION TO AGENT:**
> This file is NOT read-only. You are expected to **actively update** this file as you discover new servers, services, or configurations.
> If you run `listVMs` and see a new VM, add it here.
> If you solve a new error, add it to "Pathology & Cures".

## 1. Infrastructure Atlas (The Patient Chart)
*Maintained by: Agent (Autonomous)*

### Nodes (Physical Hosts)
*Scan network and overwrite this section.*
- **[Unknown]**: Run `getServers` to populate.

### Virtualization (The Organs)
*Maintain a current list of critical VMs/CTs.*
- **[Unknown]**: Run `listVMs` to populate. Map IDs to roles (e.g., "100: Router", "101: HomeAssistant").

### Network (Circulatory System)
- **Gateway:** [Unknown]
- **DNS:** [Unknown]
- **Subnets:** [Unknown]

### Storage (The Skeleton)
*Track ZFS Pools and Usage.*
- **[Unknown]**: Run `zpool status` to populate.

## 2. Software & Configuration (The DNA)

### Standard Operating Procedures (SOPs)
- **OS Standards:** Debian 12 / Ubuntu 24.04 (Verify via `lsb_release`).
- **Containerization:** Docker / LXC.
- **Database Clusters:** [List found DBs].

### Critical Credential Locations
- **SSH Keys:** `~/.ssh/authorized_keys`
- **Secrets:** DO NOT STORE RAW SECRETS HERE. Store paths to secret managers only.

## 3. Pathology & Cures (Medical History)
*Log successful diagnoses and treatments here. Format: `[Date] [Symptom] -> [Cure]`.*

- **[Example]**: `2024-01-01` High I/O wait on backup server. -> *Cure:* Rescheduled backups to 3 AM.

## 4. User Context (The Summoner)
*See `USER.md` for detailed psych profile.*

## 5. Active Operations (Surgery Log)
*Current long-running tasks or projects.*
- **Project Reanimator:** Self-optimization and organ integration.