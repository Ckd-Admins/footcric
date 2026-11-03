import re
import json
import urllib.request

# Apna GitHub Raw M3U URL yahan dalein
M3U_URL = "YOUR_M3U_RAW_URL"

def get_attr(line, attr):
    match = re.search(
        rf'{re.escape(attr)}="([^"]*)"', line
    )
    return match.group(1) if match else ""

def convert():
    request = urllib.request.Request(
        M3U_URL,
        headers={"User-Agent": "Mozilla/5.0"}
    )

    with urllib.request.urlopen(request) as response:
        content = response.read().decode("utf-8")

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

    with open("channels.json", "w", encoding="utf-8") as f:
        json.dump(channels, f, indent=4, ensure_ascii=False)

    print(f"Generated {len(channels)} channels")

if __name__ == "__main__":
    convert()
