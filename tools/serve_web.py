#!/usr/bin/env python3
"""Static server for the URDF demonstrator.

Long cache for the immutable payload (meshes, vendor, model.json), no cache
for the HTML, so a rebuild is picked up with a normal reload.
"""
import functools
import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099

CACHE = ("/meshes/", "/vendor/", "/model.json")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if any(self.path.startswith(p) for p in CACHE):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler) as httpd:
        print(f"serving {ROOT} on http://0.0.0.0:{PORT}", flush=True)
        httpd.serve_forever()
