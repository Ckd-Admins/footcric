
import json
import urllib.request
from pathlib import Path

API_URL = "https://dd-pearl-sigma.vercel.app/main"

OUTPUT_FILE = Path(__file__).resolve().parent / "response.json"

headers = {
    "Accept": "*/*",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Origin": "https://pro-live-cric.pages.dev",
    "User-Agent": "Mozilla/5.0"
}

request = urllib.request.Request(
    API_URL,
    headers=headers,
    method="GET"
)

try:
    with urllib.request.urlopen(request, timeout=60) as response:

        raw_response = response.read().decode(
            "utf-8",
            errors="replace"
        )

        try:
            data = json.loads(raw_response)

            output = json.dumps(
                data,
                indent=4,
                ensure_ascii=False
            )

        except json.JSONDecodeError:
            output = raw_response

        OUTPUT_FILE.write_text(
            output,
            encoding="utf-8"
        )

        print("Status:", response.status)
        print("Response saved:", OUTPUT_FILE)
        print("Response size:", len(raw_response), "characters")
        print("API fetch completed!")

except Exception as error:
    print("API Error:", error)
    raise
