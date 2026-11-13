#!/bin/bash
set -u

# Finder may provide a shorter PATH than an interactive shell.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)" || exit 1
cd "$PROJECT_DIR" || exit 1
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    trap - EXIT INT TERM HUP
    for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
        if [[ -n "$pid" ]]; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
    done
}

fail() {
    echo
    echo "Loi: $1"
    cleanup
    if [[ -t 0 ]]; then
        read -r -p "Nhan Enter de dong... " _ || true
    fi
    exit 1
}

trap cleanup EXIT
trap 'exit 130' INT TERM HUP

command -v node >/dev/null 2>&1 || fail "Can cai Node.js 22.12 tro len."
command -v npm >/dev/null 2>&1 || fail "Khong tim thay npm. Hay kiem tra cai dat Node.js."
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' \
    || fail "Can cap nhat Node.js len 22.12 tro len."

if [[ ! -x backend/.venv/bin/python ]]; then
    PYTHON_BIN=""
    for candidate in python3.12 python3.11 python3 python3.13 python3.10 \
        "$HOME"/.local/share/uv/python/cpython-3.12-*/bin/python3.12 \
        "$HOME"/.local/share/uv/python/cpython-3.11-*/bin/python3.11; do
        if command -v "$candidate" >/dev/null 2>&1 && \
            "$candidate" -c 'import sys, ssl, plistlib, venv; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
            PYTHON_BIN="$(command -v "$candidate")"
            break
        fi
    done
    [[ -n "$PYTHON_BIN" ]] || fail "Can cai Python 3.10 tro len voi day du thu vien chuan."
    echo "Dang tao moi truong Python..."
    "$PYTHON_BIN" -m venv backend/.venv || fail "Khong tao duoc backend/.venv."
fi
PYTHON_BIN="$PROJECT_DIR/backend/.venv/bin/python"
"$PYTHON_BIN" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' \
    || fail "Moi truong backend/.venv can Python 3.10 tro len."

echo "Dang chuan bi thu vien backend..."
if ! "$PYTHON_BIN" -m pip --version >/dev/null 2>&1; then
    "$PYTHON_BIN" -m ensurepip --upgrade || fail "Khong cai duoc pip trong moi truong Python."
fi
"$PYTHON_BIN" -m pip install --disable-pip-version-check -q -r backend/requirements.txt \
    || fail "Khong cai duoc thu vien backend. Kiem tra ket noi Internet va loi phia tren."

if [[ ! -x frontend/node_modules/.bin/vite ]]; then
    echo "Dang cai thu vien frontend, vui long cho..."
    (cd frontend && npm ci) || fail "Khong cai duoc thu vien frontend."
fi

# Refuse occupied ports so readiness checks cannot target another running app.
"$PYTHON_BIN" - <<'PY' || fail "Cong 3000 hoac 8000 dang duoc su dung. Hay dung server cu roi thu lai."
import socket
for port in (3000, 8000):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', port))
PY

echo "Dang khoi dong OptiCam..."
(
    cd backend || exit 1
    exec "$PYTHON_BIN" -m uvicorn main:app --host 127.0.0.1 --port 8000
) &
BACKEND_PID=$!
(
    cd frontend || exit 1
    exec node node_modules/vite/bin/vite.js --host localhost --port 3000 --strictPort
) &
FRONTEND_PID=$!

READY=0
for ((attempt = 0; attempt < 60; attempt++)); do
    kill -0 "$BACKEND_PID" 2>/dev/null || fail "Backend da dung. Xem thong bao phia tren."
    kill -0 "$FRONTEND_PID" 2>/dev/null || fail "Frontend da dung. Xem thong bao phia tren."
    if curl -fsS --max-time 1 http://127.0.0.1:8000/api/v1/health >/dev/null 2>&1 && \
        curl -fsS --max-time 1 http://localhost:3000/ >/dev/null 2>&1; then
        READY=1
        break
    fi
    sleep 1
done
[[ "$READY" == 1 ]] || fail "Server chua san sang sau 60 lan kiem tra."

echo
echo "Web da san sang: http://localhost:3000"
echo "Giu cua so nay mo. Nhan Control+C de dung ca hai server."
open http://localhost:3000 || echo "Hay mo http://localhost:3000 trong trinh duyet."

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
    sleep 1
done
fail "Mot server da dung. Hay kiem tra thong bao phia tren."
