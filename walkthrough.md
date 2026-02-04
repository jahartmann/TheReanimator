# The Reanimator: Evolution Walkthrough

You have successfully unlocked the Advanced Powers of The Reanimator.

## 1. Hybrid Fleet Management
You can now add normal Linux servers alongside Proxmox nodes.

**How to use:**
1. Navigate to **Servers > Add New**.
2. Select the **"Generic Linux"** tab.
3. Enter hostname, user, and key path.
4. The server appears in your dashboard with live stats (Cpu/Ram/Disk).

## 2. Soul Transfer (Phase 2)
Migrate running Docker containers from your Linux servers into proper Proxmox LXC "Vessels".

**How to use:**
1. Click on a **Generic Linux Server** in the Dashboard.
2. Click **"Begin Ritual"** (Soul Transfer).
3. **Select Soul**: Choose a running Docker container.
4. **Prepare Vessel**: Select a Proxmox Node and configure the LXC (CPU, RAM, Template).
5. **Reanimate**: Watch the process log as the container is migrated.

## 3. Necromancer Mode (Phase 3)
Advanced automation for establishing control.

**Raise Undead (Server Takeover)**
Automatically onboard a fresh server using only the root password. Reanimator installs its own SSH key.
1. Go to **Servers > Add New**.
2. Select **"Raise Undead"** tab (Skull icon).
3. Enter Hostname and **Root Password**.
4. Result: Server is added with Key Auth enabled.

**Wake-on-LAN**
1. Ensure the server has a `mac_address` in the database (added automatically if detected, or manually).
2. If the server goes **Offline**, a yellow "Wake Up" (Bolt) button appears in the Monitoring Dashboard.
3. Click to send the magic packet.
