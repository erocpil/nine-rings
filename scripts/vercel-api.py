#!/usr/bin/env python3
import json, os, sys

TOKEN = os.environ.get("TOK", "")
PROXY = "http://172.16.1.135:3128"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

if len(sys.argv) < 2:
    print("Usage: vercel-api.py <endpoint> [method] [body_file]")
    sys.exit(1)

import urllib.request

endpoint = sys.argv[1]
method = sys.argv[2] if len(sys.argv) > 2 else "GET"
url = "https://api.vercel.com" + endpoint

data = None
if len(sys.argv) > 3:
    with open(sys.argv[3]) as f:
        data = f.read().encode()

proxy = urllib.request.ProxyHandler({"http": PROXY, "https": PROXY})
opener = urllib.request.build_opener(proxy)
req = urllib.request.Request(url, data=data, headers=HEADERS, method=method)

try:
    resp = opener.open(req)
    result = json.load(resp)
    print(json.dumps(result, indent=2))
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.read().decode()}")
except Exception as e:
    print(f"Error: {e}")
