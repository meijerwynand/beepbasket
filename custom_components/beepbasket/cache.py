import json
import aiofiles
from datetime import datetime
from typing import Dict, Any, Optional

class BarcodeCache:
    """Structured cache aligned with OpenFoodFacts schema."""
    
    def __init__(self, cache_path: str):
        self._cache_path = cache_path
        self._cache: Dict[str, Dict[str, Any]] = {}
    
    async def load(self):
        """Load structured cache from custom_components folder."""
        try:
            async with aiofiles.open(self._cache_path, 'r', encoding='utf-8') as f:
                content = await f.read()
                self._cache = json.loads(content) if content.strip() else {}
            _LOGGER.info("📂 Loaded %d structured cache entries", len(self._cache))
        except FileNotFoundError:
            _LOGGER.info("📂 New cache file created")
            self._cache = {}
        except json.JSONDecodeError as e:
            _LOGGER.error("❌ Cache JSON corrupt: %s", e)
            self._cache = {}
    
    async def _save(self):
        """Persist structured cache."""
        async with aiofiles.open(self._cache_path, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(self._cache, indent=2, ensure_ascii=False))
    
    async def get(self, barcode: str) -> Optional[Dict[str, Any]]:
        """Get full structured entry."""
        return self._cache.get(barcode)
    
    async def get_display_name(self, barcode: str) -> str:
        """For shopping list - safe fallback."""
        entry = self._cache.get(barcode)
        if entry and entry.get("status") == "complete":
            return entry.get("name", barcode)
        return barcode
    
    async def set_product(self, barcode: str, product_data: Dict[str, Any]):
        """Set complete product (API or manual)."""
        product_data["status"] = "complete"
        product_data["scanned_count"] = product_data.get("scanned_count", 0) + 1
        product_data["last_updated"] = datetime.now().isoformat()
        self._cache[barcode] = product_data
        await self._save()
        _LOGGER.info("💾 Cached product: %s → %s", barcode, product_data.get("name"))
    
    async def set_unknown(self, barcode: str):
        """Track unknown barcode scans."""
        if barcode not in self._cache:
            self._cache[barcode] = {
                "status": "unknown",
                "scanned_count": 0,
                "first_seen": datetime.now().isoformat()
            }
        
        entry = self._cache[barcode]
        entry["scanned_count"] += 1
        
        if entry["scanned_count"] >= 3:
            entry["ready_to_contribute"] = True
        
        await self._save()
        _LOGGER.info("❓ Unknown #%d: %s", entry["scanned_count"], barcode)
    
    async def remove(self, barcode: str):
        """Remove entry."""
        if barcode in self._cache:
            del self._cache[barcode]
            await self._save()
            _LOGGER.info("🗑️ Removed: %s", barcode)
    
    def get_cache_for_api(self) -> Dict[str, Dict[str, Any]]:
        """Return full structured cache for REST API."""
        return self._cache
