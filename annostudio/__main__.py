# -*- coding: utf-8 -*-
"""支持 python -m annostudio 方式启动。"""

import sys

from .cli import main

if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    main()
