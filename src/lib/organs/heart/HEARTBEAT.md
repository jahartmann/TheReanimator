# HEARTBEAT of the Reanimator

This file dictates the rhythmic, autonomous actions of the agent.
**Pulse Frequency:** Every 30 minutes (Subject to `scheduler.ts`)

## The Pulse (Routine Checks)
*These checks are performed every time the heart beats.*

### 1. Vital Signs (Critical Health)
- [ ] **Proxmox Cluster Status:** Check `pvecm status`. Are all nodes "Online"?
- [ ] **ZFS Health:** Check `zpool status -x`. Is the storage "Healthy"?
- [ ] **Resource Hunger:** Check for VMs/CTs with >90% CPU/RAM usage for >5 minutes.
- [ ] **Zombie Processes:** Identify processes stuck in 'D' or 'Z' state on the host.

### 2. Phylactery Check (Backups)
- [ ] **Backup Verification:** Did last night's backup jobs complete? (Check `vzdump` logs).
- [ ] **Storage Space:** Is the Backup Server full? (>85% usage).

### 3. Spiritual Integrity (Security)
- [ ] **Failed Logins:** Check `journalctl` for repeated SSH auth failures (Brute force).
- [ ] **Sudden Listeners:** Check `netstat -tulpn` for new, unknown open ports.

## The Rituals (Daily/Weekly Tasks)
*These tasks are performed based on the date.*

### Daily (The Midnight Oil)
- [ ] **Log Rotation:** Ensure logs aren't filling the root disk.
- [ ] **Update Check:** Run `apt update` (simulate) to list available security updates.
- [ ] **Journal Summary:** Compile a summary of the day's "Resurrections" and "Incidents" into `MEMORY.md`.

### Weekly (The Sunday Cleanse)
- [ ] **Stale VM Check:** List VMs that haven't been started in >30 days. Ask Master if they should be "Banished" (Archived).
- [ ] **Orphaned Volumes:** Check for ZFS volumes/disk images not attached to any VM.
- [ ] **Brain Defrag:** Review `MEMORY.md` for outdated or duplicate facts. Consolidate.

## Instructions for the Heart Organ
1.  **Read:** When the heart beats, read this file.
2.  **Evaluate:** For each unchecked item, determine if it needs attention NOW.
3.  **Act:**
    - If **All Clear**: Log "Pulse Steady".
    - If **Issue Found**:
        - **Minor:** Log to `MEMORY.md`.
        - **Major:** Trigger `notify_user` or Attempt Autorepair (if Level 2 authorized).
4.  **Refine:** If you find yourself checking something manually often, ADD IT LIST HERE.
