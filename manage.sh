#!/bin/bash

# Configuration
APP_DIR=$(pwd)
SERVICE_NAME="proxhost-backup"

# Helper to check root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo "❌ Bitte als root ausführen (sudo)"
        exit 1
    fi
}

# Auto-install dependencies if missing
ensure_dependencies() {
    echo "🔍 Prüfe Abhängigkeiten..."
    
    # Check for curl
    if ! command -v curl &> /dev/null; then
        echo "📦 Installiere curl..."
        apt-get update && apt-get install -y curl
    fi

    # Check for Git
    if ! command -v git &> /dev/null; then
        echo "📦 Installiere Git..."
        apt-get install -y git
    fi

    # Check for Node.js
    if ! command -v node &> /dev/null; then
        echo "📦 Node.js nicht gefunden. Installiere Node.js 20.x (LTS)..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
        echo "✅ Node.js installiert."
    fi

    # Check for npm explicitly
    if ! command -v npm &> /dev/null; then
        echo "📦 npm nicht gefunden. Installiere..."
        apt-get install -y npm
    fi
    
    echo "✅ Alle Abhängigkeiten verfügbar."
}

# Resolve binaries
get_binaries() {
    NODE_BIN=$(which node 2>/dev/null)
    NPM_BIN=$(which npm 2>/dev/null)
}

do_install() {
    check_root
    ensure_dependencies
    get_binaries
    
    echo ""
    echo "🚀 Reanimator Backup Manager Installation"
    echo "========================================"
    echo ""
    
    echo "📦 Installiere Dependencies..."
    $NPM_BIN install --include=dev
    
    echo "🔨 Baue Anwendung..."
    $NPM_BIN run build
    
    echo "⚙️  Konfiguriere Systemd Service..."
    cat > /etc/systemd/system/$SERVICE_NAME.service <<EOF
[Unit]
Description=ProxHost Backup Manager
After=network.target

[Service]
Type=simple
User=$(logname 2>/dev/null || echo $SUDO_USER || echo root)
WorkingDirectory=$APP_DIR
ExecStart=$NPM_BIN start
Restart=always
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
    echo "🌐 Zugriff unter: http://$(hostname -I | cut -d' ' -f1):3000"
    echo ""
}

do_update() {
    check_root
    ensure_dependencies
    get_binaries
    
    echo ""
    echo "🔄 Reanimator Backup Manager Update"
    echo "=================================="
    echo ""
    
    echo "📥 Lade neueste Änderungen..."
    git pull
    
    echo "📦 Aktualisiere Dependencies..."
    $NPM_BIN install --include=dev
    
    echo "🔨 Baue Anwendung neu..."
    $NPM_BIN run build
    
    echo "🔄 Starte Service neu..."
    systemctl restart $SERVICE_NAME
    
    echo ""
    echo "✅ Update abgeschlossen!"
    echo ""
}

do_restart() {
    check_root
    echo "🔄 Starte Service neu..."
    systemctl restart $SERVICE_NAME
    echo "✅ Service neu gestartet."
}

do_status() {
    echo "📊 Service Status:"
    systemctl status $SERVICE_NAME --no-pager
}

do_logs() {
    echo "📋 Service Logs:"
    journalctl -u $SERVICE_NAME -n 50 --no-pager
}

# Main
case "$1" in
    install)
        do_install
        ;;
    update)
        do_update
        ;;
    restart)
        do_restart
        ;;
    status)
        do_status
        ;;
    logs)
        do_logs
        ;;
    *)
        echo "ProxHost Backup Manager"
        echo ""
        echo "Usage: sudo $0 {install|update|restart|status|logs}"
        echo ""
        echo "  install  - Installiere die Anwendung"
        echo "  update   - Aktualisiere auf die neueste Version"
        echo "  restart  - Starte den Service neu"
        echo "  status   - Zeige Service-Status"
        echo "  logs     - Zeige Service-Logs"
        exit 1
        ;;
esac
