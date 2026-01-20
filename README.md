# Reanimator
**Proxmox Configuration Backup & Disaster Recovery – Simplified.**

---

### Language / Sprache 
[![Deutsch](https://img.shields.io/badge/Sprache-Deutsch-blue?style=for-the-badge)](#-reanimator-deutsch) 
[![English](https://img.shields.io/badge/Language-English-red?style=for-the-badge)](#-reanimator-english)

---

## 🇩🇪 Reanimator (Deutsch)

Reanimator ist ein spezialisiertes Tool für Proxmox-Umgebungen, das dort ansetzt, wo normale Backups oft aufhören: bei der Konfiguration. Während Proxmox Backup Server (PBS) VMs sichert, hilft Reanimator bei deinen Nodes, die Verwaltung deiner Storage-Pools und die Sicherung deiner `/etc`-Konfigurationen.

### 💡 Warum Reanimator?
Jeder, der schon einmal einen Proxmox-Node nach einem Hardware-Defekt neu aufsetzen musste, weiß: Die VMs sind meist sicher, aber die Netzwerk-Bridges, ZFS-Pool-Konfigurationen und Corosync-Settings manuell wiederherzustellen, kostet Zeit und Nerven.

Reanimator automatisiert diesen Prozess und bietet dir ein zentrales Dashboard für deine gesamte Infrastruktur.

### ✨ Kernfunktionen
* **📊 Monitoring & Dashboard:** Echtzeit-Status von CPU, RAM und Disk-Auslastung sowie Cluster-Erkennung.
* **💾 Backup & Recovery:** Automatische Sicherung von `/etc` (Network, Corosync, Storage) inkl. generierter Markdown-Anleitungen für den Notfall.
* **⚡ Power-Tools:** Bulk Commander für Befehle auf mehreren Nodes, ISO-Sync und visuelle Migrations-Logs.
* **🔍 Hardware-Analyse:** Unterscheidung von NVMe, SSD und HDD direkt im UI.

### 🛠️ Technology Stack
* **Frontend:** Next.js 15 (App Router), Tailwind CSS
* **UI:** Luzid UI / Shadcn & Lucide Icons
* **Backend:** Server Actions & Node.js
* **Database:** SQLite via `better-sqlite3`
* **Communication:** SSH (agentenlos via `ssh2`)

### 🚀 Quick Start
1. **Repository klonen**
   ```bash
   git clone https://github.com/jahartmann/TheReanimator.git
   cd TheReanimator
   ```

2. **Installation**
   ```bash
   npm install
   npm run migrate
   ```

3. **Starten**
   ```bash
   npm run build
   npm start
   ```
   
###  Anmeldung
Initiale Anmeldedaten:
***N: admin
PW: admin***
### ⚙️ Konfiguration
***Initiale Anmeldedaten:
N: admin
PW: admin***
Gehe im Dashboard auf Server -> New Server. Du benötigst:
* Hostname/IP des Nodes.
* Einen autorisierten SSH-Key (empfohlen).

[⬆️ Nach oben](#reanimator)

---

## 🇺🇸 Reanimator (English)
Reanimator is a specialized tool for Proxmox environments that picks up where traditional backups often leave off: system configuration. While Proxmox Backup Server (PBS) secures your VMs and containers, Reanimator focuses on the health of your nodes, the management of your storage pools, and the safety of your /etc configurations.

### 💡 Why Reanimator?
Anyone who has ever had to rebuild a Proxmox node after a hardware failure knows the pain: your VMs might be safe on a backup, but manually restoring network bridges, ZFS pool configurations, and Corosync settings costs significant time and nerves.

Reanimator automates this process and provides a centralized dashboard for your entire infrastructure.

### ✨ Core Features
* **📊 Monitoring & Dashboard:** Real-time CPU, RAM, and Disk usage status plus automatic cluster detection.
* **💾 Backup & Recovery:** Automatically backs up critical /etc files and generates step-by-step Markdown recovery guides.
* **⚡ Admin Power-Tools:** Bulk Commander for multi-node commands, ISO/Template sync, and visual migration logs.
* **🔍 Hardware Analysis:** Identify NVMe, SSD, and HDD types directly in the UI.

### 🛠️ Technology Stack
* **Frontend:** Next.js 15 (App Router), Tailwind CSS
* **UI:** Lucid UI / Shadcn & Lucide Icons
* **Backend:** Server Actions & Node.js
* **Database:** SQLite via `better-sqlite3`
* **Communication:** Secure, agentless access via SSH (`ssh2`)

### 🚀 Quick Start
1. **Clone the repository**
   ```bash
   git clone https://github.com/jahartmann/TheReanimator.git
   cd TheReanimator
   ```

2. **Installation**
   ```bash
   npm install
   npm run migrate
   ```

3. **Start the app**
   ```bash
   npm run build
   npm start
   ```
   
###  Registration
Initial Login:
***N: admin
PW: admin***
### ⚙️ Configuration
Navigate to Server -> New Server in the dashboard. You will need:
* Hostname or IP of the node.
* An SSH key authorized on the target node (recommended).

### 🤝 Contributing
Feedback, bug reports, and pull requests are welcome!

**License:** MIT

[⬆️ Back to top](#reanimator)
