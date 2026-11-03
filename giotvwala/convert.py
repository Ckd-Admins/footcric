import re
import json
import urllib.request
import os

# Source M3U URL
M3U_URL = "https://raw.githubusercontent.com/sportlive18/sportlink-update/refs/heads/main/zio.m3u"

def parse_m3u(content):
    channels = []
    lines = content.splitlines()
    current_channel = {}
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        if line.startswith("#EXTINF:"):
            if current_channel:
                channels.append(current_channel)
                current_channel = {}
                
            tvg_id_match = re.search(r'tvg-id="([^"]*)"', line)
            tvg_name_match = re.search(r'tvg-name="([^"]*)"', line)
            logo_match = re.search(r'tvg-logo="([^"]*)"', line)
            group_match = re.search(r'group-title="([^"]*)"', line)
            
            name_parts = line.split(",")
            name = name_parts[-1].strip() if len(name_parts) > 1 else ""
            
            current_channel["name"] = tvg_name_match.group(1) if tvg_name_match else name
            current_channel["id"] = tvg_id_match.group(1) if tvg_id_match else ""
            current_channel["category"] = group_match.group(1) if group_match else ""
            if logo_match:
                current_channel["logo"] = logo_match.group(1)
                
            current_channel["keys_list"] = []
            
        elif line.startswith("#KODIPROP:inputstream.adaptive.license_key="):
            key_data = line.split("=", 1)[1].strip()
            key_pairs = key_data.split(",")
            for kp in key_pairs:
                if ":" in kp:
                    kid, k = kp.split(":", 1)
                    current_channel["keys_list"].append({"keyId": kid.strip(), "key": k.strip()})
                    
        elif line.startswith("#KODIPROP:inputstream.adaptive.stream_headers="):
            headers_str = line.split("=", 1)[1].strip()
            cookie_match = re.search(r'Cookie=([^&]+)', headers_str)
            if cookie_match:
                current_channel["cookie"] = cookie_match.group(1)
                
        elif not line.startswith("#"):
            url = line
            if "cookie" in current_channel and current_channel["cookie"]:
                cookie_val = current_channel["cookie"]
                if "?" in url:
                    url += f"&{cookie_val}"
                else:
                    url += f"?{cookie_val}"
            
            current_channel["url"] = url
            
            keys = current_channel.pop("keys_list", [])
            current_channel.pop("cookie", None)
            
            if len(keys) == 1:
                current_channel["keyId"] = keys[0]["keyId"]
                current_channel["key"] = keys[0]["key"]
            elif len(keys) > 1:
                current_channel["keys"] = keys
            else:
                current_channel["keyId"] = "null"
                current_channel["key"] = "null"
                
            channels.append(current_channel)
            current_channel = {}

    if current_channel:
        channels.append(current_channel)
        
    return channels

def main():
    print(f"Fetching M3U from {M3U_URL}...")
    req = urllib.request.Request(
        M3U_URL, 
        headers={"User-Agent": "Mozilla/5.0"}
    )
    with urllib.request.urlopen(req) as response:
        content = response.read().decode('utf-8')
        
    json_data = parse_m3u(content)
    
    # Same folder me channels.json update karega
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_filename = os.path.join(script_dir, "channels.json")
    
    with open(output_filename, "w", encoding="utf-8") as f:
        json.dump(json_data, f, indent=4, ensure_ascii=False)
        
    print(f"Successfully updated {output_filename} with {len(json_data)} channels.")

if __name__ == "__main__":
    main()
