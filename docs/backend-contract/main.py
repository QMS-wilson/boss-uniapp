# -*- coding: utf-8 -*-
"""启动云端 API：py -m cloudapi.main [--config cloud_config.json] [--host ..] [--port ..]"""

import argparse
import logging

import uvicorn

from . import config as cfgmod
from .server import create_app


def main():
    parser = argparse.ArgumentParser(description="V3 云端 API")
    parser.add_argument("--config", default=None)
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()

    cfg = cfgmod.load(args.config)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    host = args.host or cfg["server"]["host"]
    port = args.port or int(cfg["server"]["port"])
    app = create_app(cfg)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
