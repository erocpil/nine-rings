#!/usr/bin/env python3
"""Disable Vercel authentication for the project."""
import json, urllib.request

TOKEN = "..."
PROXY = "http://172.16.1.135:3128"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

# Get project info
proxy = urllib.request.ProxyHandler({"http": PROXY, "https": PROXY})
opener = urllib.request.build_opener(proxy)

# Fetch projects to find the right one
req = urllib.request.Request(
    "https://api.vercel.com/v9/projects?teamSlug=9rings",
    headers=HEADERS
)
resp = opener.open(req)
data = json.load(resp)
project = data["projects"][0]
pid = project["id"]
print(f"Project: {project['name']} ({pid})")
print(f"Current ssoProtection: {project.get('ssoProtection')}")

# Disable authentication
body = json.dumps({"ssoProtection": None}).encode()
req2 = urllib.request.Request(
    f"https://api.vercel.com/v1/projects/{pid}",
    data=body, headers=HEADERS, method="PATCH"
)
resp2 = opener.open(req2)
result = json.load(resp2)
print(f"New ssoProtection: {result.get('ssoProtection')}")
err = result.get("error")
if err:
    print(f"Error: {err}")
else:
    print("✅ Authentication disabled")
