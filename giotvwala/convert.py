
import re
import json
import urllib.request
from pathlib import Path

M3U_URL = "https://raw.githubusercontent.com/sportlive18/sportlink-update/refs/heads/main/zio.m3u"

# Save JSON in the same folder as this script
OUTPUT = Path(__file__).resolve().parent / "channels.json"


def get_attr(line, attr):
    match = re.search(
        rf'{re.escape(attr)}="([^"]*)"', line
    )
    return match.group(1) if match else ""


def convert():
    print("Downloading M3U playlist...")

    request = urllib.request.Request(
        M3U_URL,
        headers={"User-Agent": "Mozilla/5.0"}
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        content = response.read().decode("utf-8-sig")

    channels = []
    current = None

    for line in content.splitlines():
        line = line.strip()

        if line.startswith("#EXTINF:"):
            parts = line.split(",", 1)

            current = {
                "name": parts[1].strip() if len(parts) > 1 else "",
                "id": get_attr(line, "tvg-id"),
                "category": get_attr(line, "group-title"),
                "logo": get_attr(line, "tvg-logo")
            }

        elif line.startswith("http") and current:
            current["url"] = line
            channels.append(current)
            current = None

    if not channels:
        raise ValueError("No channels found! Check the M3U URL.")

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(channels, f, indent=4, ensure_ascii=False)

    print("--------------------------------")
    print(f"Generated: {len(channels)} channels")
    print(f"Output: {OUTPUT}")
    print(f"File size: {OUTPUT.stat().st_size} bytes")
    print("--------------------------------")


if __name__ == "__main__":
    convert()
