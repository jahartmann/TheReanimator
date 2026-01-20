
# Reanimator - Backup & Recovery System

**Reanimator** is a modern, high-performance Backup & Recovery solution specialized for Proxmox environments. It provides a sleek, real-time dashboard for monitoring server health, managing storage pools, and orchestrating centralized configuration backups.

## 🚀 Features

### 🖥️ Dashboard & Monitoring
- **Real-time Overview**: Monitor CPU, RAM, and Disk usage across your entire infrastructure.
- **Cluster Awareness**: Automatically detects and groups Proxmox clusters.
- **Storage Dashboard**: Dedicated view for shared (Ceph/NFS) vs. local (ZFS/LVM) storage utilization.
- **Server Health**: Instant status indicators for online/offline states.

### 🔍 Detailed Server Insights
- **Hardware Analysis**: Deep dive into physical vs. virtual disks (NVMe, SSD, HDD recognition).
- **Network Topology**: Visualization of network interfaces, bridges (vmbr), and bonds.
- **Storage Pools**: Detailed breakdown of ZFS, LVM-Thin, and Ceph pools using native Proxmox tools (`pvesm`).
- **Debugging**: Integrated debug console for troubleshooting connection issues directly in the UI.


### 💾 Backup & Disaster Recovery
- **Configuration Backups**: Automated backups of critical `/etc` configurations (network, corosync, storage).
- **One-Click Restore**: Seamlessly restore configurations to get servers back online fast.
- **Recovery Guides**: Automatically generated, step-by-step Markdown guides for manual disaster recovery.
- **History & Versioning**: Track changes and roll back to previous states.

### ⚡ Power Tools
- **Bulk Commander**: Execute shell commands or VM actions (Start/Stop) across multiple nodes simultaneously.
- **Library Sync**: Synchronize ISOs and Templates between servers with a single click.
- **Smart Migration**: Visual stepper for migration progress, live terminal logs, and history tracking.
- **Robust Discovery**: Automatic detection of VMs on standalone nodes and clusters via efficient API/SSH fallbacks.

## 🛠️ Technology Stack

- **Frontend**: [Next.js 15](https://nextjs.org/) (App Directory), [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [Luzid UI / Shadcn](https://ui.shadcn.com/), [Lucide React](https://lucide.dev/)
- **Backend**: Next.js Server Actions, Node.js
- **Database**: [SQLite](https://www.sqlite.org/) (`better-sqlite3`)
- **Connectivity**: SSH (`ssh2`) for secure, agentless server communication.

## 🔗 Releases

You can download the latest beta release from the [Releases Page](https://github.com/jahartmann/Reanimator/releases).

**Current Version**: `v1.0.0-beta`

To install a specific version, check the tags in this repository.

## 📦 Installation & Setup

### Prerequisites
- Node.js 18+
- Git

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/jahartmann/Reanimator.git
   cd Reanimator
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Initialize Database**
   The application uses a local SQLite database (`data/proxhost.db`). Migrations are run automatically on build.
   ```bash
   npm run migrate
   ```

4. **Build & Run**
   ```bash
   npm run build
   npm start
   ```

   The application will be available at `http://localhost:3000`.

### Development Mode
```bash
npm run dev
```

## ⚙️ Configuration

### Adding Servers
Navigate to the **Server** tab and click **New Server**. You will need:
- **Hostname/IP**: The address of your Proxmox node.
- **SSH Key**: A private SSH key authorized on the target node (usually root).

### Updating
You can update the application directly from the **Settings** page or manually:
```bash
git pull
npm install
npm run build
sudo systemctl restart proxhost-backup
```

## 📄 License
Private / Proprietary. Created by [Janik Hartmann](https://github.com/jahartmann).
