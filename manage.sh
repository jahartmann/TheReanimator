#!/bin/bash
set -e  # Abbrechen bei jedem Fehler

# Configuration
APP_DIR=$(pwd)
SERVICE_NAME="proxhost-backup"
REQUIRED_NODE_MAJOR=20

# ─── Helper ───────────────────────────────────────────────────────────────────

check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo "❌ Bitte als root ausführen: sudo $0 $1"
        exit 1
    fi
}

get_node_major() {
    if command -v node &>/dev/null; then
        node -e "process.stdout.write(String(process.versions.node.split('.')[0]))"
    else
        echo "0"
    fi
}

ensure_dependencies() {
    echo "🔍 Prüfe Abhängigkeiten..."

    if ! command -v curl &>/dev/null; then
        echo "📦 Installiere curl..."
        apt-get update -qq && apt-get install -y curl
    fi

    if ! command -v git &>/dev/null; then
        echo "📦 Installiere Git..."
        apt-get install -y git
    fi

    local node_major
    node_major=$(get_node_major)

    if [ "$node_major" -lt "$REQUIRED_NODE_MAJOR" ]; then
        echo "📦 Node.js $node_major gefunden (benötigt >=$REQUIRED_NODE_MAJOR). Installiere Node.js LTS..."

        # Determine Ubuntu codename for NodeSource compatibility
        local codename
        codename=$(lsb_release -cs 2>/dev/null || echo "")

        # NodeSource supports up to the latest stable LTS — use Node.js 22 (current LTS)
        local node_setup_url="https://deb.nodesource.com/setup_22.x"

        set +e  # NodeSource might fail on very new distros
        curl -fsSL "$node_setup_url" | bash - 2>&1
        local curl_exit=$?
        set -e

        if [ $curl_exit -ne 0 ]; then
            echo "⚠️  NodeSource setup fehlgeschlagen (Ubuntu '$codename' möglicherweise noch nicht unterstützt)."
            echo "📦 Versuche Node.js via nvm zu installieren..."
            install_node_via_nvm
        else
            apt-get install -y nodejs
        fi

        node_major=$(get_node_major)
        if [ "$node_major" -lt "$REQUIRED_NODE_MAJOR" ]; then
            echo "❌ Node.js Installation fehlgeschlagen. Bitte manuell installieren: https://nodejs.org"
            exit 1
        fi

        echo "✅ Node.js $(node --version) installiert."
    else
        echo "✅ Node.js $(node --version) gefunden (OK)."
    fi

    echo "✅ Alle Abhängigkeiten verfügbar."
}

install_node_via_nvm() {
    export NVM_DIR="/root/.nvm"
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    # shellcheck source=/dev/null
    [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
    nvm install 22
    nvm alias default 22
    nvm use default
    # Make node/npm available system-wide for the service
    ln -sf "$NVM_DIR/versions/node/$(nvm current)/bin/node" /usr/local/bin/node
    ln -sf "$NVM_DIR/versions/node/$(nvm current)/bin/npm" /usr/local/bin/npm
    echo "✅ Node.js $(node --version) via nvm installiert."
}

get_binaries() {
    NODE_BIN=$(which node 2>/dev/null || echo "node")
    NPM_BIN=$(which npm 2>/dev/null || echo "npm")
}

# ─── Commands ─────────────────────────────────────────────────────────────────

do_install() {
    check_root "install"
    ensure_dependencies
    get_binaries

    echo ""
    echo "🚀 Reanimator Installation"
    echo "=========================="
    echo ""

    echo "📦 Installiere Dependencies..."
    $NPM_BIN install --include=dev

    echo "🔨 Baue Anwendung..."
    if ! $NPM_BIN run build; then
        echo ""
        echo "❌ Build fehlgeschlagen. Mögliche Ursachen:"
        echo "   - Node.js Version inkompatibel (installiert: $($NODE_BIN --version), benötigt: v${REQUIRED_NODE_MAJOR}+)"
        echo "   - npm Abhängigkeiten unvollständig (versuche: npm install --include=dev)"
        echo "   - Speicher zu gering für den Build (empfohlen: ≥2 GB RAM)"
        echo ""
        echo "   Vollständigen Build-Log mit 'npm run build' im App-Verzeichnis einsehen."
        exit 1
    fi

    # Verify build output exists
    if [ ! -f "$APP_DIR/.next/BUILD_ID" ]; then
        echo "❌ Build scheinbar abgeschlossen, aber kein gültiges Build-Artefakt gefunden."
        echo "   Verzeichnis .next/ existiert, aber BUILD_ID fehlt. Bitte 'npm run build' manuell ausführen."
        exit 1
    fi

    echo "⚙️  Konfiguriere Systemd Service..."
    local service_user
    service_user=$(logname 2>/dev/null || echo "${SUDO_USER:-root}")

    cat > /etc/systemd/system/$SERVICE_NAME.service <<EOF
[Unit]
Description=Reanimator Proxmox Manager
After=network.target

[Service]
Type=simple
User=$service_user
WorkingDirectory=$APP_DIR
ExecStart=$NPM_BIN start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable $SERVICE_NAME
    systemctl start $SERVICE_NAME

    echo ""
    echo "✅ Installation abgeschlossen!"
    echo "🌐 Zugriff unter: http://$(hostname -I | awk '{print $1}'):3000"
    echo ""
}

do_update() {
    check_root "update"
    ensure_dependencies
    get_binaries

    echo ""
    echo "🔄 Reanimator Update"
    echo "===================="
    echo ""

    echo "📥 Lade neueste Änderungen..."
    git pull

    echo "📦 Aktualisiere Dependencies..."
    $NPM_BIN install --include=dev

    echo "🔨 Baue Anwendung neu..."
    if ! $NPM_BIN run build; then
        echo "❌ Build fehlgeschlagen. Update abgebrochen. Dienst läuft weiterhin mit der alten Version."
        exit 1
    fi

    echo "🔄 Starte Service neu..."
    systemctl restart $SERVICE_NAME

    echo ""
    echo "✅ Update abgeschlossen!"
    echo ""
}

do_restart() {
    check_root "restart"
    echo "🔄 Starte Service neu..."
    systemctl restart $SERVICE_NAME
    echo "✅ Service neu gestartet."
}

do_status() {
    echo "📊 Service Status:"
    systemctl status $SERVICE_NAME --no-pager
}

do_logs() {
    local lines="${2:-50}"
    echo "📋 Service Logs (letzte $lines Zeilen):"
    journalctl -u $SERVICE_NAME -n "$lines" --no-pager
}

# ─── Main ─────────────────────────────────────────────────────────────────────

case "$1" in
    install)  do_install ;;
    update)   do_update ;;
    restart)  do_restart ;;
    status)   do_status ;;
    logs)     do_logs "$@" ;;
    *)
        echo "Reanimator — Proxmox Manager"
        echo ""
        echo "Usage: sudo $0 {install|update|restart|status|logs}"
        echo ""
        echo "  install   Installiere die Anwendung"
        echo "  update    Aktualisiere auf die neueste Version"
        echo "  restart   Starte den Service neu"
        echo "  status    Zeige Service-Status"
        echo "  logs [N]  Zeige letzte N Service-Logs (Standard: 50)"
        exit 1
        ;;
esac
