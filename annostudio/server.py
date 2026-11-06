# -*- coding: utf-8 -*-
"""HTTP 层：路由 + 静态资源。

这里只做三件事：解析请求、调用 Session、把结果变成 JSON。
业务判断一律不写在这个文件里。
"""

import json
import mimetypes
import os
import socket
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import __version__
from .session import SessionError

PKG_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(PKG_DIR, "web")
DIALOGS = os.path.join(PKG_DIR, "dialogs.py")


class Server(ThreadingHTTPServer):
    """浏览器取消请求、刷新页面都会断开连接，这类断连不该刷屏报错。"""

    daemon_threads = True
    # Windows 上 SO_REUSEADDR 允许别的进程再绑同一个端口（端口劫持），必须关掉
    allow_reuse_address = False

    def __init__(self, address, handler, session):
        self.session = session
        super().__init__(address, handler)

    def server_bind(self):
        # 再加一道独占锁：绑定期间不允许其他进程抢这个端口
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            try:
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            except OSError:
                pass
        super().server_bind()

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        sys.stderr.write("  ! 请求出错: %s\n" % exc)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "AnnoStudio/" + __version__

    @property
    def session(self):
        return self.server.session

    def log_message(self, fmt, *args):
        pass

    def log_request(self, code="-", size="-"):
        try:
            if int(code) >= 500:
                sys.stderr.write("  ! %s -> %s\n" % (self.requestline, code))
        except (TypeError, ValueError):
            pass

    # ---------------------------------------------------------- 响应助手

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, cache=False):
        try:
            stat = os.stat(path)
        except OSError:
            return self.send_json({"error": "文件不存在"}, 404)
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        etag = '"%d-%d"' % (int(stat.st_mtime), stat.st_size)
        if cache and self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(stat.st_size))
        if cache:
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "private, max-age=60")
        else:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(262144)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def fail(self, exc):
        """把 SessionError 变成对应的 JSON 错误响应。"""
        return self.send_json({"error": str(exc)}, exc.status)

    # ---------------------------------------------------------- GET

    def do_GET(self):
        try:
            url = urlparse(self.path)
            path, query = url.path, parse_qs(url.query)

            if path in ("/", "/index.html"):
                return self.send_file(os.path.join(WEB_DIR, "index.html"))
            if path.startswith("/static/"):
                rel = path[len("/static/"):]
                target = os.path.abspath(os.path.join(WEB_DIR, rel))
                if not target.startswith(WEB_DIR + os.sep):
                    return self.send_json({"error": "非法路径"}, 403)
                return self.send_file(target)
            if path == "/favicon.ico":
                return self.send_file(os.path.join(WEB_DIR, "favicon.svg"))
            if path == "/api/state":
                return self.send_json(self.session.state())
            if path == "/api/image":
                return self.handle_image(query)
            if path == "/api/ann":
                return self.handle_ann(query)
            return self.send_json({"error": "未知接口: %s" % path}, 404)
        except ConnectionError:
            return  # 浏览器切图/刷新时取消请求，属正常现象
        except SessionError as exc:
            return self.fail(exc)
        except Exception as exc:
            sys.stderr.write("  ! GET %s -> %s\n" % (self.path, exc))
            return self.send_json({"error": str(exc)}, 500)

    def handle_image(self, query):
        rel = (query.get("path") or [""])[0]
        return self.send_file(self.session.image_path(rel), cache=True)

    def handle_ann(self, query):
        rel = (query.get("path") or [""])[0]
        return self.send_json(self.session.read_annotations(rel))

    # ---------------------------------------------------------- POST

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            data = json.loads(raw.decode("utf-8") or "{}")
            path = urlparse(self.path).path

            if path == "/api/open":
                folder = (data.get("path") or "").strip().strip('"')
                if not folder:
                    return self.send_json({"error": "缺少文件夹路径"}, 400)
                return self.send_json(self.session.open(folder, data.get("recursive")))
            if path == "/api/pick":
                return self.handle_pick((data.get("role") or "images"))
            if path == "/api/labeldir":
                return self.send_json(self.session.set_label_dir(data.get("path")))
            if path == "/api/save":
                return self.send_json(self.session.write_annotations(
                    data.get("path") or "", data.get("size"), data.get("boxes")))
            if path == "/api/classes":
                return self.send_json(self.session.set_classes(data.get("classes")))
            if path == "/api/classes/rescan":
                return self.send_json(self.session.rescan_classes())
            if path == "/api/classfile":
                return self.send_json(self.session.set_classes_file(data.get("path")))
            if path == "/api/format":
                return self.send_json(self.session.set_format(data.get("format")))
            if path == "/api/export":
                return self.send_json(self.session.export_yolo())
            if path == "/api/close":
                return self.send_json(self.session.close())
            return self.send_json({"error": "未知接口: %s" % path}, 404)
        except ConnectionError:
            return
        except SessionError as exc:
            return self.fail(exc)
        except Exception as exc:
            sys.stderr.write("  ! POST %s -> %s\n" % (self.path, exc))
            return self.send_json({"error": str(exc)}, 500)

    def handle_pick(self, role="images"):
        """调用独立进程弹系统选择窗口，避免 Tk 与 HTTP 线程打架。"""
        if not os.path.isfile(DIALOGS):
            return self.send_json({"error": "缺少 dialogs.py"}, 500)
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        mode = "file" if role == "classfile" else "dir"
        title = {
            "labels": "选择标注保存目录",
            "classfile": "选择类别清单文件（classes.txt）",
        }.get(role, "选择图片文件夹")
        try:
            proc = subprocess.run(
                [sys.executable, DIALOGS, mode, title],
                cwd=PKG_DIR, capture_output=True, timeout=600, env=env,
                creationflags=flags,
            )
        except subprocess.TimeoutExpired:
            return self.send_json({"error": "选择窗口超时"}, 504)
        chosen = (proc.stdout or b"").decode("utf-8", "replace").strip()
        if not chosen:
            return self.send_json({"canceled": True})
        if role == "labels":
            return self.send_json({"folder": chosen})
        if role == "classfile":
            return self.send_json({"path": chosen})
        return self.send_json(self.session.open(chosen))
