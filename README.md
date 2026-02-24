# Reanimator
**Proxmox Infrastructure Management – Monitoring, Backups, and an AI Agent that actually helps.**

---

### Language / Sprache
[![Deutsch](https://img.shields.io/badge/Sprache-Deutsch-blue?style=for-the-badge)](#-reanimator-deutsch)
[![English](https://img.shields.io/badge/Language-English-red?style=for-the-badge)](#-reanimator-english)

---

## 🇩🇪 Reanimator (Deutsch)

Reanimator ist ein Self-hosted Dashboard für Proxmox-Umgebungen. Es fing als simples Backup-Tool für `/etc`-Konfigurationen an – mittlerweile ist ein vollständiges Infrastruktur-Management daraus geworden, inklusive einem KI-Agenten, der per Chat oder Telegram Befehle entgegennimmt.

Das Projekt läuft komplett agentlos über SSH, braucht keine Plugins oder Agents auf den Zielservern, und speichert alles lokal in einer SQLite-Datenbank.

### Was kann Reanimator?

**Monitoring & Dashboard**
Echtzeit-Übersicht über CPU, RAM und Disk-Auslastung deiner Proxmox-Nodes. Cluster-Erkennung läuft automatisch. Statistiken werden im Hintergrund gecacht und als Trend angezeigt.

**Backups & Wiederherstellung**
Automatische Sicherung wichtiger Konfigurationsdateien (`/etc/network`, `/etc/corosync`, Storage-Konfigurationen, crontabs, SSH-Keys). Zu jedem Backup wird eine Markdown-Wiederherstellungsanleitung generiert. Backups können direkt im Browser verglichen und heruntergeladen werden.

**VM & Container Management**
VMs und Container erstellen, starten, stoppen, migrieren – mit einem einfachen 3-Schritt-Wizard. Bulk-Operationen auf mehreren Nodes gleichzeitig.

**ISO & Template Sync**
ISOs und Templates zwischen Proxmox-Nodes synchronisieren, direkt aus dem Dashboard.

**KI-Agent**
Ein eingebauter Chat-Agent, der auf deiner eigenen Ollama-Instanz läuft. Er kennt deine Infrastruktur und kann Befehle ausführen: Server-Status abfragen, VMs erstellen, SSH-Befehle ausführen, Logs analysieren, Dateien lesen/schreiben, Dienste verwalten, und mehr. Das Modell und die Ollama-URL sind in den Einstellungen konfigurierbar.

Der Agent hat ein "Brain"-System: Er kann Informationen dauerhaft speichern und später wieder abrufen. Außerdem gibt es ein Reflex-System für automatische Reaktionen auf Ereignisse (z. B. Dienst neustart bei Ausfall).

**Telegram-Integration**
Den Agenten über Telegram steuern – gleiche Fähigkeiten wie im Web-Chat.

**Benachrichtigungen**
E-Mail (SMTP) und Telegram-Benachrichtigungen mit konfigurierbarem Routing. Welche Ereignisse an wen gemeldet werden, lässt sich granular einstellen.

**Tags**
VMs und Container mit Tags versehen und nach ihnen filtern. Tags werden direkt aus Proxmox synchronisiert.

### Tech Stack
- **Next.js 16** (App Router, React 19, TypeScript)
- **Tailwind CSS 4** + Shadcn UI (new-york)
- **better-sqlite3** – alles lokal, kein externer Datenbankserver
- **ssh2** – agentlose Verbindung via SSH
- **Vercel AI SDK** + **ollama-ai-provider** – KI-Agent
- **next-intl** – i18n (de, en, es, fr, ru)

### Quick Start

```bash
git clone https://github.com/jahartmann/TheReanimator.git
cd TheReanimator
npm install
npm run build
npm start
```

Standard-Login: `admin` / `admin` (bitte nach dem ersten Login ändern)

Dann unter **Server → New Server** deinen ersten Proxmox-Node hinzufügen. Du brauchst:
- IP oder Hostname des Nodes
- SSH-Key (empfohlen) oder Passwort

Den KI-Agenten aktivierst du unter **Einstellungen → KI-Agent**: Ollama-URL und Modell eintragen, fertig.

---

[⬆️ Nach oben](#reanimator)

---

## 🇺🇸 Reanimator (English)

Reanimator is a self-hosted dashboard for Proxmox environments. It started out as a simple config backup tool for `/etc` files – and gradually grew into a broader infrastructure management platform, including an AI agent you can talk to via chat or Telegram.

Everything runs agentless over SSH. No plugins, no agents on the target servers. All data is stored locally in a SQLite database.

### What does Reanimator do?

**Monitoring & Dashboard**
Real-time overview of CPU, RAM, and disk usage across your Proxmox nodes. Cluster detection runs automatically. Stats are cached in the background and shown as trends.

**Backups & Recovery**
Automatically backs up critical config files (`/etc/network`, `/etc/corosync`, storage configs, crontabs, SSH keys). Each backup comes with a generated Markdown recovery guide. Backups can be compared and downloaded directly in the browser.

**VM & Container Management**
Create, start, stop, and migrate VMs and containers with a simple 3-step wizard. Bulk operations across multiple nodes at once.

**ISO & Template Sync**
Sync ISOs and templates between Proxmox nodes, directly from the dashboard.

**AI Agent**
A built-in chat agent running on your own Ollama instance. It knows your infrastructure and can take actions: query server status, create VMs, run SSH commands, analyze logs, read/write files, manage services, and more. Model and Ollama URL are configurable in settings.

The agent has a persistent "Brain" for storing and recalling knowledge across sessions, and a Reflex system for automated responses to events (e.g., restart a service when it goes down).

**Telegram Integration**
Control the agent via Telegram – same capabilities as the web chat.

**Notifications**
Email (SMTP) and Telegram notifications with configurable routing rules. Fine-grained control over which events go to whom.

**Tags**
Tag your VMs and containers and filter by them. Tags sync directly from Proxmox.

### Tech Stack
- **Next.js 16** (App Router, React 19, TypeScript)
- **Tailwind CSS 4** + Shadcn UI (new-york)
- **better-sqlite3** – local SQLite, no external database
- **ssh2** – agentless access via SSH
- **Vercel AI SDK** + **ollama-ai-provider** – AI agent
- **next-intl** – i18n (de, en, es, fr, ru)

### Quick Start

```bash
git clone https://github.com/jahartmann/TheReanimator.git
cd TheReanimator
npm install
npm run build
npm start
```

Default login: `admin` / `admin` (please change after first login)

Then go to **Server → New Server** to add your first Proxmox node. You need:
- IP or hostname of the node
- SSH key (recommended) or password

To enable the AI agent, go to **Settings → AI Agent**: enter your Ollama URL and model name.

### Contributing

Feedback, bug reports, and pull requests are welcome.

**License:** MIT

---

[⬆️ Back to top](#reanimator)
