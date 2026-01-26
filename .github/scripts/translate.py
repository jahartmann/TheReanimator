#!/usr/bin/env python3
"""
DeepL Auto-Translation Script for TheReanimator-i18n

Automatically translates new keys from default locale to all other locales.
Reads supported languages from src/i18n/routing.ts

Features:
- Uses official DeepL Python library
- Tracks value changes with MD5 hashes
- Only translates missing or changed keys
- Preserves existing translations

Uses official DeepL Python library: https://pypi.org/project/deepl/
"""
import hashlib
import json
import os
import re
import sys
from pathlib import Path

try:
    import deepl
except ImportError:
    print("❌ Error: deepl module not found")
    print("   Run: pip install deepl")
    sys.exit(1)

# Configuration
DEEPL_API_KEY = os.environ.get("DEEPL_API_KEY")
if not DEEPL_API_KEY:
    print("❌ Error: DEEPL_API_KEY environment variable not set")
    print("   Set it in GitHub Secrets: DEEPL_API_KEY")
    sys.exit(1)

# Use free API endpoint for keys ending with ':fx' or set server URL explicitly
if ":fx" in DEEPL_API_KEY:
    deepl_client = deepl.DeepLClient(DEEPL_API_KEY)
else:
    # For backward compatibility with old free keys
    deepl_client = deepl.DeepLClient(DEEPL_API_KEY, server_url="https://api-free.deepl.com")

LOCALES_DIR = Path("src/messages")
ROUTING_FILE = Path("src/i18n/routing.ts")
HASHES_FILE = Path("src/messages/.translation_hashes.json")

# DeepL language code mapping (target languages only)
# Full list: https://developers.deepl.com/docs/api-reference/languages
DEEPL_LANG_CODES = {
    "en": "EN-US",  # English (American)
    "ru": "RU",     # Russian
    "es": "ES",     # Spanish
    "fr": "FR",     # French
    "it": "IT",     # Italian
    "pt": "PT-BR",  # Portuguese (Brazilian)
    "nl": "NL",     # Dutch
    "pl": "PL",     # Polish
    "uk": "UK",     # Ukrainian
    "ja": "JA",     # Japanese
    "zh": "ZH",     # Chinese (simplified)
    # Add more as needed
}

def get_hash(text: str) -> str:
    """Generate MD5 hash of text for change tracking"""
    return hashlib.md5(str(text).encode('utf-8')).hexdigest()[:8]

def load_hashes() -> dict:
    """Load existing hashes from .translation_hashes.json"""
    if HASHES_FILE.exists():
        try:
            with open(HASHES_FILE, encoding="utf-8") as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_hashes(hashes: dict):
    """Save hashes to .translation_hashes.json"""
    with open(HASHES_FILE, "w", encoding="utf-8") as f:
        json.dump(hashes, f, ensure_ascii=False, indent=2)

def get_nested_value(obj: dict, path: str):
    """Get value from nested dict using dot notation path"""
    keys = path.split('.')
    current = obj
    for key in keys:
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return None
    return current

def get_locales_from_routing():
    """Extract locales array from routing.ts"""
    if not ROUTING_FILE.exists():
        print(f"❌ Error: {ROUTING_FILE} not found")
        sys.exit(1)

    content = ROUTING_FILE.read_text(encoding="utf-8")

    # Extract locales array using regex
    match = re.search(r"locales\s*:\s*\[([^\]]+)\]", content)
    if not match:
        print("❌ Error: Could not find locales array in routing.ts")
        sys.exit(1)

    # Parse the array
    locales_str = match.group(1)
    locales = re.findall(r"'([a-z]{2})'", locales_str)

    return locales

def get_default_locale():
    """Extract default locale from routing.ts"""
    content = ROUTING_FILE.read_text(encoding="utf-8")
    match = re.search(r"defaultLocale\s*:\s*'([a-z]{2})'", content)
    return match.group(1) if match else "de"

def get_all_namespaces():
    """Get all JSON files - using flat structure (de.json, en.json, ru.json)"""
    if not (LOCALES_DIR / "de.json").exists():
        print(f"❌ Error: File {LOCALES_DIR / 'de.json'} not found")
        return []

    # Flat structure - single file per language
    return ["messages"]

def translate_text(text: str, target_lang: str, source_lang: str = None) -> str:
    """Translate text using DeepL API (official library)"""
    if not text.strip():
        return text

    # Skip if already contains HTML/React placeholders
    if text.startswith("__") and text.endswith("__"):
        return text

    try:
        # Build translation parameters
        params = {
            "text": text,
            "target_lang": target_lang,
            "preserve_formatting": True,
            "tag_handling": "xml"
        }

        # Only set source_lang if provided (DeepL can auto-detect)
        if source_lang:
            params["source_lang"] = source_lang

        # Use official DeepL library
        result = deepl_client.translate_text(**params)
        return result.text

    except deepl.DeepLException as e:
        print(f"      ❌ Translation error: {e}")
        return text  # Return original on error
    except Exception as e:
        print(f"      ❌ Unexpected error: {e}")
        return text  # Return original on error

def collect_all_keys(data: dict, prefix: str = "") -> dict:
    """Collect all keys with their values from nested structure"""
    result = {}
    for key, value in data.items():
        current_path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            result.update(collect_all_keys(value, current_path))
        else:
            result[current_path] = value
    return result

def main():
    print("🌍 Starting DeepL Auto-Translation (using official library with hash tracking)...")

    # Get locales from routing.ts
    all_locales = get_locales_from_routing()
    default_locale = get_default_locale()
    source_lang_code = default_locale.upper()  # DeepL source lang (e.g., 'de' -> 'DE')

    print(f"   Source locale: {default_locale}")
    print(f"   All locales: {', '.join(all_locales)}")

    # Filter target locales (all except default)
    target_locales = [loc for loc in all_locales if loc != default_locale]

    if not target_locales:
        print("   ⚠️  No target locales found (only default locale configured)")
        return

    print(f"   Target locales: {', '.join(target_locales)}")
    print()

    namespaces = get_all_namespaces()
    if not namespaces:
        print("❌ No namespaces found")
        return

    # Load existing hashes
    hashes = load_hashes()
    total_translations = 0
    changed_keys = 0

    for ns in namespaces:
        src_file = LOCALES_DIR / f"{default_locale}.json"

        if not src_file.exists():
            print(f"⚠️  Skipping {ns} - source file not found")
            continue

        with open(src_file, encoding="utf-8") as f:
            src_data = json.load(f)

        print(f"📦 Processing: {src_file}")
        print(f"   Total namespaces: {len(src_data)}")

        # Collect all keys from source (flattened)
        src_keys = collect_all_keys(src_data)

        # Check for changed values in source
        for key_path, value in src_keys.items():
            current_hash = get_hash(str(value))
            stored_hash = hashes.get(key_path)

            if stored_hash != current_hash:
                if stored_hash is not None:
                    print(f"   🔑 Changed key detected: {key_path}")
                    changed_keys += 1
                hashes[key_path] = current_hash

        for target_locale in target_locales:
            # Get DeepL language code
            dl_lang_code = DEEPL_LANG_CODES.get(target_locale)
            if not dl_lang_code:
                print(f"   {target_locale}: ⚠️  Skip - not supported by DeepL")
                continue

            target_file = LOCALES_DIR / f"{target_locale}.json"

            # Load existing translations
            try:
                with open(target_file, encoding="utf-8") as f:
                    target_data = json.load(f)
            except:
                target_data = {}

            # Find missing or changed keys
            missing_or_changed = []

            for key_path, value in src_keys.items():
                target_value = get_nested_value(target_data, key_path)

                # Missing key
                if target_value is None:
                    missing_or_changed.append((key_path, value, "missing"))
                    continue

                # Check if value changed (hash mismatch)
                current_hash = hashes.get(key_path)
                if current_hash:
                    # Value exists in target but source changed
                    # We need to re-translate
                    missing_or_changed.append((key_path, value, "changed"))

            if not missing_or_changed:
                print(f"   {target_locale}: ✅ All keys present and up-to-date")
                continue

            print(f"   {target_locale}: Translating {len(missing_or_changed)} keys", end="")
            if changed_keys > 0:
                print(f" (including {changed_keys} changed)")
            else:
                print()

            # Translate missing or changed keys
            for full_path, value, reason in missing_or_changed:
                translated = translate_text(str(value), dl_lang_code, source_lang_code)

                # Build nested structure and set value
                parts = full_path.split('.')
                current = target_data
                for i, part in enumerate(parts[:-1]):
                    if part not in current:
                        current[part] = {}
                    if not isinstance(current[part], dict):
                        current[part] = {}
                    current = current[part]

                # Set the translated value
                current[parts[-1]] = translated

                status_icon = "🔄" if reason == "changed" else "✓"
                print(f"      {status_icon} {full_path}")
                total_translations += 1

            # Save updated translations
            target_file.parent.mkdir(parents=True, exist_ok=True)
            with open(target_file, "w", encoding="utf-8") as f:
                json.dump(target_data, f, ensure_ascii=False, indent=2)

            print(f"   {target_locale}: ✅ Saved translations")

        print()

    # Save updated hashes
    save_hashes(hashes)

    print(f"✅ Translation complete!")
    print(f"   Total translations: {total_translations}")
    print(f"   Changed keys re-translated: {changed_keys}")
    print(f"   DeepL quota used: ~{total_translations} characters")

if __name__ == "__main__":
    main()
