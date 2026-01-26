#!/usr/bin/env python3
"""
Test script to check supported DeepL languages
"""
import deepl
import os

# Use your API key from environment or paste it here
auth_key = os.environ.get("DEEPL_API_KEY", "YOUR_API_KEY_HERE")

try:
    # Initialize client (auto-detects free vs pro)
    if ":fx" in auth_key:
        client = deepl.DeepLClient(auth_key)
    else:
        client = deepl.DeepLClient(auth_key, server_url="https://api-free.deepl.com")

    print("✅ DeepL Client initialized successfully\n")

    # Get source languages
    print("📝 SOURCE LANGUAGES:")
    source_langs = client.get_source_languages()
    for lang in source_langs:
        if lang.code in ["DE", "EN", "ES", "FR", "IT", "PT", "RU", "UK"]:
            print(f"  {lang.code:6s} - {lang.name}")

    print("\n📝 TARGET LANGUAGES:")
    target_langs = client.get_target_languages()
    for lang in target_langs:
        if lang.code in ["DE", "EN", "EN-US", "EN-GB", "ES", "FR", "IT",
                        "PT-BR", "PT-PT", "RU", "UK", "JA", "ZH"]:
            print(f"  {lang.code:6s} - {lang.name}{f' ({lang.supported_formality})' if hasattr(lang, 'supported_formality') else ''}")

    print("\n🔍 TESTING TRANSLATION:")
    # Test translation
    result = client.translate_text(
        "Hallo Welt",
        target_lang="EN-US",
        source_lang="DE"
    )
    print(f"  DE → EN-US: 'Hallo Welt' → '{result.text}'")

    result = client.translate_text(
        "Hallo Welt",
        target_lang="ES",
        source_lang="DE"
    )
    print(f"  DE → ES:    'Hallo Welt' → '{result.text}'")

except deepl.DeepLException as e:
    print(f"❌ DeepL Error: {e}")
except Exception as e:
    print(f"❌ Error: {e}")
