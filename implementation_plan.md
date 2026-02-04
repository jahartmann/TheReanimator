# Implementation Plan - Phase 3: Necromancer Mode (Automation)

## Goal
Implement advanced automation features: **Wake-on-LAN** to revive offline servers and **Raise Undead** (Server Takeover) to automatically onboard servers using password authentication.

## Proposed Changes

### Database Layer
#### [MODIFY] `servers` and `linux_hosts` tables
- Add `mac_address` (TEXT) column to store the hardware address for WOL.

### Backend Layer

#### [NEW] `src/lib/actions/necromancer.ts`
- `wakeOnLan(macAddress: string)`: Sends a magic packet.
- `raiseUndead(host, password)`: 
    1. Connects via SSH using **Password**.
    2. Installs the Reanimator public key (`~/.ssh/authorized_keys`).
    3. Adds the server to the database.
    4. "You have been reanimated."

### Frontend Layer

#### [MODIFY] `MonitoringPanel.tsx`
- Add a "Wake Up" button (Bolt icon) for offline servers if MAC address is known.

#### [MODIFY] `NewServerForm.tsx` (or new Necromancer Page)
- Add a "Necromancy" tab or mode: "Raise Undead".
- Inputs: Hostname, Root Password (no key needed).
- Executes `raiseUndead`.

## Verification Plan

### Manual Verification
1. **WOL**: 
    - Manually add a MAC address to a DB entry.
    - Mark server offline.
    - Click "Wake Up".
    - Verify packet sent (logs).
2. **Raise Undead**:
    - Spin up a fresh VC/VM with password auth only.
    - Use "Raise Undead".
    - Verify it appears in Dashboard and is accessible via Key.
