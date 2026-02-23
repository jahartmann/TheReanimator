# Konzept: The Reanimator - Evolution

## Vision
**"Nicht nur verwalten, sondern vereinen."**

The Reanimator entwickelt sich von einem reinen Proxmox-Helfer zu einer **hybriden Kommandozentrale**, die die Grenzen zwischen Virtualisierung (Proxmox) und klassischem "Bare Metal" Linux (Raspberry Pis, Storage Server, Root Server) auflöst.

Der Kern-USP (Unique Selling Point) liegt in der **Fluidität**: Ressourcen und Services sollen fließend zwischen verschiedenen Infrastruktur-Typen bewegt und zentral gesteuert werden können.

---

## Kern-Säulen der Einzigartigkeit

### 1. Hybrid Fleet Management (Die Vereinigung)
Anstatt nur Proxmox-Cluster anzuzeigen, integriert Reanimator beliebige Linux-Maschinen (via SSH) als gleichberechtigte "Nodes" in die Übersicht.

*   **Unified Dashboard:** Ein Dashboard zeigt *neben* deinen Proxmox Nodes auch deinen Raspberry Pi, deinen NAS-Server oder deinen externen VPS an.
*   **Abstrakte "Ressourcen":** CPU, RAM und Disk-Usage werden über den *gesamten* Fuhrpark (VMs + Container + Bare Metal) aggregiert.

### 2. "Soul Transfer" (Service Reanimation)
Das ist das "Killer-Feature", das dem Namen "Reanimator" alle Ehre macht. Es geht nicht nur um Backups, sondern um die **Migration von Leben** zwischen Systemen.

*   **P2V / V2C (Physical to Virtual / Virtual to Container):**
    *   Ein Klick, um einen Service (z.B. Docker Container oder Systemd Service), der auf einem Raspberry Pi läuft, zu analysieren und ihn als LXC Container auf dem Proxmox Cluster "wiederzubeleben".
    *   *Szenario:* Dein Home-Server stirbt? Reanimator zieht die Configs und startet den Dienst sofort in Proxmox neu.
*   **Service-Level-Backup:** Anstatt ganze Disks zu sichern, sichert Reanimator *Konfigurationen und States* (Docker Compose files, /etc/ configs, bind mounts).

### 3. Der "Necromancer" Mode (Ausfallsicherheit & Self-Healing)
Reanimator überwacht nicht nur, er greift ein.

*   **Smart Wake-on-LAN Orchestration:**
    *   Wenn die Last auf dem Cluster steigt, weckt Reanimator automatisch dedizierte Linux-Maschinen auf, um Last zu übernehmen (z.B. via Docker Swarm oder Kubernetes Integration).
    *   Wenn sie nicht gebraucht werden: Automatischer Shutdown ("Schlafmodus").
*   **Emergency Takeover:** Fällt ein Proxmox Node aus, kann ein Skript auf einem externen Linux-Server (z.B. einem kleinen Pi) getriggert werden, um kritische DNS/DHCP Dienste als Fallback zu starten.

---

## Konkrete Funktions-Ideen

| Feature | Beschreibung | Einzigartigkeit |
| :--- | :--- | :--- |
| **Universal Update Button** | Ein Knopf, um `apt update && apt upgrade` auf **allen** Systemen (Proxmox Nodes, LXCs, VMs, Bare Metal Linux) parallel, aber sicher (nacheinander) auszuführen. | Massive Zeitersparnis für Homelabs. |
| **Cross-System Shell** | Ein Terminal im Browser, mit dem du Befehle an eine *Gruppe* von Servern gleichzeitig senden kannst (z.B. "Check disk usage on all machines"). | Multi-Server Management ohne Ansible-Komplexität. |
| **Inventory Scanner** | Reanimator scannt das Netzwerk, findet Linux-Maschinen, und fügt sie (nach Auth) automatisch dem Dashboard hinzu. | "Plug & Play" für das Netzwerk. |
| **"The phylactery" (Das Seelengefäß)** | Ein zentraler Speicher für *Portable Apps*. Definiere einen "Stack" (z.B. Pi-Hole + Unbound), und deploye ihn mit einem Klick entweder auf Proxmox (als LXC) oder auf einen Linux Server (als Docker). | Infrastructure as Code, aber mit GUI. |

## Technische Umsetzung (Grobkonzept)

1.  **Agentless Architecture:** Reanimator nutzt weiterhin SSH (wie Ansible), um mit den Linux-Maschinen zu sprechen. Kein Agent muss installiert werden.
2.  **Node-Types:**
    *   `ProxmoxHost`: Volle API Kontrolle.
    *   `LinuxHost`: SSH-basierte Kontrolle (Stats via `/proc`, Updates via `apt/dnf`, Docker Management).
3.  **Erweiterung der Datenbank:** Speichern von "Linux Hosts" neben den Proxmox Cluster Configs.

---

## Zusammenfassung für den User

Du machst Reanimator zu einem **"Meta-Betriebssystem"** für dein ganzes Netzwerk. Proxmox ist nur ein Teil davon. Das Ziel ist es, dass es egal ist, *wo* ein Dienst läuft – Reanimator gibt dir die Kontrolle darüber, als wäre es ein einziger großer Computer.
