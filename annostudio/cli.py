# -*- coding: utf-8 -*-
"""启动入口：参数解析、找端口、开浏览器、跑服务。"""

import argparse
import socket
import sys
import threading
import webbrowser

from . import __version__
from .server import Handler, Server
from .session import Session, SessionError


def find_port(start=8765, tried=40):
    """从 start 开始找一个能监听的端口。

    注意：这里**不能**设 SO_REUSEADDR。Windows 上它会让两个进程绑到同一个端口，
    结果就是新实例「抢走」已经在跑的那个，两边各自服务不同目录，非常容易搞混。
    """
    for port in range(start, start + tried):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("找不到可用端口（%d-%d 都被占用）" % (start, start + tried - 1))


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="annostudio", description="AnnoStudio - 本地图像标注工具")
    parser.add_argument("--folder", "-f", help="启动时直接打开该文件夹")
    parser.add_argument("--port", "-p", type=int, default=8765, help="端口，默认 8765")
    parser.add_argument("--no-browser", action="store_true", help="不要自动打开浏览器")
    args = parser.parse_args(argv)

    session = Session()
    if args.folder:
        try:
            info = session.open(args.folder)
            print("已载入: %s" % info["folder"])
        except SessionError as exc:
            print("无法打开: %s" % exc)

    port = find_port(args.port)
    server = Server(("127.0.0.1", port), Handler, session)
    url = "http://127.0.0.1:%d/" % port

    print("")
    print("  AnnoStudio %s" % __version__)
    print("  ----------------------------------------")
    print("  地址: %s" % url)
    print("  关闭这个窗口即停止服务")
    print("")

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
