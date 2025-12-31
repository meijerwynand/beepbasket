import logging
import aiohttp
import asyncio
import json
import aiofiles
from datetime import datetime
from typing import Dict, Any, Optional
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import callback

DOMAIN = "beepbasket"
TODO_DOMAIN = "todo"

_LOGGER = logging.getLogger(__name__)

class BarcodeCache:
    """Structured cache aligned with OpenFoodFacts schema."""
    
    # def __init__(self, cache_path: str):
    #     self._cache_path = cache_path
    #     self._cache: Dict[str, Dict[str, Any]] = {}
    

    def __init__(self, cache_path: str, hass):  # ← ADD hass param
        self._cache_path = cache_path
        self.hass = hass  # ← ADD hass reference
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
        self.hass.bus.async_fire("barcode_cache_updated")
        _LOGGER.info("💾 Cached product: %s → %s", barcode, product_data.get("name"))
    
    # async def set_unknown(self, barcode: str):
    #     """Track unknown barcode scans."""
    #     if barcode not in self._cache:
    #         self._cache[barcode] = {
    #             "status": "unknown",
    #             "scanned_count": 0,
    #             "first_seen": datetime.now().isoformat()
    #         }
        
    #     entry = self._cache[barcode]
    #     entry["scanned_count"] += 1
        
    #     if entry["scanned_count"] >= 3:
    #         entry["ready_to_contribute"] = True
        
    #     await self._save()
    #     _LOGGER.info("❓ Unknown #%d: %s", entry["scanned_count"], barcode)


    async def set_unknown(self, barcode: str):
        """Track unknown barcode scans WITH name=barcode."""
        if barcode not in self._cache:
            self._cache[barcode] = {
                "status": "unknown",
                "name": barcode,  # ← ADD THIS
                "scanned_count": 0,
                "first_seen": datetime.now().isoformat()
            }
        
        entry = self._cache[barcode]
        entry["scanned_count"] += 1
        if entry["scanned_count"] >= 3:
            entry["ready_to_contribute"] = True
        
        await self._save()
        self.hass.bus.async_fire("barcode_cache_updated")
        _LOGGER.info("❓ Unknown #%d: %s (%s)", entry["scanned_count"], barcode, entry["name"])




    async def remove(self, barcode: str):
        """Remove entry."""
        if barcode in self._cache:
            del self._cache[barcode]
            await self._save()
            self.hass.bus.async_fire("barcode_cache_updated")
            _LOGGER.info("🗑️ Removed: %s", barcode)
    
    def get_cache_for_api(self) -> Dict[str, Dict[str, Any]]:
        """Return full structured cache for REST API."""
        return self._cache

class BarcodeListView(HomeAssistantView):
    """REST endpoint for barcode cache (GET mappings)."""
    url = "/api/beepbasket/mappings"
    name = "api:beepbasket:mappings"
    requires_auth = True

    def __init__(self, cache):
        self._cache = cache

    async def get(self, request):
        return self.json(self._cache.get_cache_for_api())

class BarcodeCacheAddView(HomeAssistantView):
    """REST endpoint to add cache entry."""
    url = "/api/beepbasket/cache/add"
    name = "api:beepbasket:cache:add"
    requires_auth = True

    def __init__(self, cache):
        self._cache = cache

    async def post(self, request):
        data = await request.json()
        barcode = data.get("barcode")
        product_data = data.get("product_data", {})
        if barcode and product_data:
            await self._cache.set_product(barcode.strip(), product_data)
            return self.json({"success": True})
        return self.json({"error": "Missing barcode or product_data"}, 400)

class BarcodeCacheRemoveView(HomeAssistantView):
    """REST endpoint to remove cache entry."""
    url = "/api/beepbasket/cache/remove"
    name = "api:beepbasket:cache:remove"
    requires_auth = True

    def __init__(self, cache):
        self._cache = cache

    async def post(self, request):
        data = await request.json()
        barcode = data.get("barcode")
        if barcode:
            await self._cache.remove(barcode.strip())
            return self.json({"success": True})
        return self.json({"error": "Missing barcode"}, 400)

class BarcodeLookupView(HomeAssistantView):
    """Lookup single barcode."""
    url = "/api/beepbasket/lookup/{barcode}"      # ← FIRST
    name = "api:beepbasket:lookup"               # ← SECOND
    requires_auth = True

    def __init__(self, hass):
        self.hass = hass

    async def get(self, request, barcode: str):
        result = await lookup_product(self.hass, barcode)
        if result:
            return self.json(result)
        return self.json({"error": "Product not found"})






def is_valid_barcode(code: str) -> bool:
    """Filter barcodes vs QR codes"""
    if len(code) < 8:
        return False
    if code.isdigit() and 8 <= len(code) <= 14:
        return True
    if len(code) > 20 or '.' in code or '/' in code or '=' in code:
        return False
    return True

async def get_cache_path(hass: HomeAssistant) -> str:
    """HA-standard: custom_components/beepbasket/barcode_cache.json"""
    return hass.config.path(f"custom_components/{DOMAIN}/barcode_cache.json")

async def lookup_product(hass: HomeAssistant, barcode: str) -> Optional[Dict[str, Any]]:
    """Robust OpenFoodFacts lookup returning structured data."""
    url = f"https://world.openfoodfacts.org/api/v0/product/{barcode}.json"
    timeout = aiohttp.ClientTimeout(total=10)
    
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    _LOGGER.warning("Lookup failed, HTTP %s for %s", resp.status, barcode)
                    return None
                
                data = await resp.json()
                
                if data.get("status") != 1:
                    _LOGGER.debug("Product not found: %s", barcode)
                    return None
                
                product = data.get("product", {})
                name = (product.get("product_name") or 
                       product.get("generic_name") or
                       product.get("brands") or
                       product.get("categories", "").split(",")[0].strip()).strip()
                
                if name:
                    _LOGGER.debug("Found: %s → %s", barcode, name)
                    return {
                        "name": name,
                        "brands": product.get("brands", ""),
                        "categories": product.get("categories", ""),
                        "source": "openfoodfacts"
                    }
                
                _LOGGER.debug("Valid product but no name data: %s", barcode)
                return None
                
    except Exception as err:
        _LOGGER.warning("API lookup error for %s: %s", barcode, err)
        return None

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry):
    hass.data.setdefault(DOMAIN, {})

    shopping_list_entity = entry.data.get("shopping_list_entity")
    if not shopping_list_entity:
        _LOGGER.error("❌ No shopping list configured in entry data")
        return False

    # Wait for shopping list
    for attempt in range(15):
        todo_states = [state.entity_id for state in hass.states.async_all() if state.entity_id.startswith("todo.")]
        if shopping_list_entity in todo_states:
            _LOGGER.info("✅ Shopping list '%s' ready", shopping_list_entity)
            break
        _LOGGER.info("⏳ Waiting for todo lists... (%s/15)", attempt + 1)
        await asyncio.sleep(2)
    else:
        _LOGGER.error("❌ Shopping list '%s' not available after 30s", shopping_list_entity)
        return False

    hass.data[DOMAIN]["shopping_list_entity"] = shopping_list_entity
    hass.data[DOMAIN]["config_entry"] = entry

    # Structured cache
    cache_path = await get_cache_path(hass)
    # cache = BarcodeCache(cache_path)
    cache = BarcodeCache(cache_path, hass)
    await cache.load()
    hass.data[DOMAIN]["cache"] = cache
    _LOGGER.info("📂 Cache ready at: %s", cache_path)

    # REST API endpoints
    hass.http.register_view(BarcodeListView(cache))
    hass.http.register_view(BarcodeCacheAddView(cache))
    hass.http.register_view(BarcodeCacheRemoveView(cache))
    hass.http.register_view(BarcodeLookupView(hass))
    _LOGGER.info("🌐 REST APIs registered")

    # # SERVICES
    # async def add_mapping_service(call):
    #     barcode = str(call.data["barcode"]).strip()
    #     product = str(call.data["product"]).strip()
        
    #     if not barcode or not product:
    #         return
        
    #     product_data = {
    #         "name": product,
    #         "source": "manual",
    #         "local_override": True
    #     }
    #     await cache.set_product(barcode, product_data)
        
    #     display_name = await cache.get_display_name(barcode)
    #     _LOGGER.info("🖥️ Added manual: %s → %s", barcode, display_name)

    async def add_mapping_service(call):
        barcode = str(call.data.get("code") or call.data.get("barcode", "")).strip()
        name = str(call.data.get("product_name") or call.data.get("product", "")).strip()
        
        _LOGGER.debug("🖥️ add_mapping called: %s → %s", barcode, name)
        
        if not barcode or not name:
            _LOGGER.warning("add_mapping: missing code/barcode or product_name/product")
            return
            
        cache = hass.data[DOMAIN]["cache"] 
        old_entry = await cache.get(barcode)
        old_name = old_entry.get("name") if old_entry else barcode
        
        # Build OFF-compatible product_data (backwards + forwards compatible)
        product_data = {
            "name": name,
            "brands": call.data.get("brands", ""),
            "quantity": call.data.get("quantity", ""),
            "stores": call.data.get("stores", ""),
            "source": call.data.get("source", "manual"),
            "local_override": True
        }
        
        await cache.set_product(barcode, product_data)
        
        # Sync shopping list (unchanged)
        if old_name != name:
            _LOGGER.debug("add_mapping: syncing shopping list %s → %s", old_name, name)
            shopping_list_entity = hass.data[DOMAIN]["shopping_list_entity"]
            
            try:
                response = await hass.services.async_call(
                    "todo", "get_items", {"entity_id": shopping_list_entity, "status": "needs_action"},
                    return_response=True, blocking=True
                )
                items = response.get(shopping_list_entity, {}).get('items', [])
                matching_items = [item for item in items if old_name in item.get("summary", "") or barcode in item.get("summary", "")]
                
                for item in matching_items:
                    await hass.services.async_call(
                        "todo", "update_item",
                        {"entity_id": shopping_list_entity, "item": old_name, "rename": name, "status": "needs_action"},
                        blocking=True
                    )
                
                if matching_items:
                    _LOGGER.info("🔄 Synced %d items: %s → %s", len(matching_items), old_name, name)
            except Exception as e:
                _LOGGER.error("Shopping list sync FAILED: %s", str(e))
        
        _LOGGER.info("🖥️ Updated: %s → %s", barcode, name)


    async def remove_mapping_service(call):
        barcode = str(call.data["barcode"]).strip()
        if barcode:
            await cache.remove(barcode)
            _LOGGER.info("🖥️ Removed: %s", barcode)

    hass.services.async_register(DOMAIN, "add_mapping", add_mapping_service)
    hass.services.async_register(DOMAIN, "remove_mapping", remove_mapping_service)

    # Handle barcode_scanned events
    async def handle_barcode(event):
        barcode = event.data.get("barcode", "").strip()
        
        invalid_states = {"unavailable", "unknown", "none", ""}
        if not barcode or barcode in invalid_states:
            _LOGGER.debug("Skipping invalid barcode event: %r", barcode)
            return

        if not is_valid_barcode(barcode):
            _LOGGER.debug("❌ QR/Rejected: '%s'", barcode)
            return

        cache = hass.data[DOMAIN]["cache"]
        entry = await cache.get(barcode)

        if entry and entry.get("status") == "complete":
            product = entry.get("name")
            _LOGGER.info("💾 Cache hit %s → %s", barcode, product)
        else:
            product_data = await lookup_product(hass, barcode)
            if product_data:
                await cache.set_product(barcode, product_data)
                product = product_data["name"]
                _LOGGER.info("🌐 API success %s → %s", barcode, product)
            else:
                await cache.set_unknown(barcode)
                product = barcode
                _LOGGER.warning("❓ Unknown: %s", barcode)

        await asyncio.sleep(1)
        target_entity = hass.data[DOMAIN]["shopping_list_entity"]

        # Check active items
        try:
            response = await hass.services.async_call(
                "todo", "get_items",
                {"entity_id": target_entity},
                return_response=True,
                blocking=True
            )
            
            active_items = []
            if response and isinstance(response, dict) and target_entity in response:
                items = response[target_entity].get('items', [])
                active_items = [
                    item["summary"].lower().strip()
                    for item in items
                    if isinstance(item, dict) and item.get("status") == "needs_action"
                ]

            if product.lower().strip() in active_items:
                _LOGGER.info("⏭️ '%s' already ACTIVE in %s", product, target_entity)
                return
                
        except Exception as e:
            _LOGGER.warning("Todo check failed: %s", e)

        _LOGGER.info("📦 Adding '%s' to %s", product, target_entity)
        await hass.services.async_call(
            "todo", "add_item",
            {"entity_id": target_entity, "item": product},
            blocking=True
        )

    unsub_event = hass.bus.async_listen("barcode_scanned", handle_barcode)
    hass.data[DOMAIN]["unsub_event"] = unsub_event

    # Dustbin sensor listener
    async def handle_dustbin_sensor(event):
        entity_id = event.data.get("entity_id")
        if "dustbin_barcode" in entity_id:
            new_state = hass.states.get(entity_id)
            if new_state and new_state.state != "":
                barcode = new_state.state.strip()
                hass.bus.async_fire("barcode_scanned", {"barcode": barcode})
                _LOGGER.info("🔗 Dustbin → barcode_scanned: %s", barcode)

    dustbin_listener = hass.bus.async_listen("state_changed", handle_dustbin_sensor)
    hass.data[DOMAIN]["dustbin_listener"] = dustbin_listener

    _LOGGER.info("🚀 Barcode → Shopping List initialized")
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry):
    listeners = hass.data.get(DOMAIN, {})
    dustbin_listener = listeners.pop("dustbin_listener", None)
    if dustbin_listener:
        dustbin_listener()
    unsub_event = listeners.pop("unsub_event", None)
    if unsub_event:
        unsub_event()
    hass.data.pop(DOMAIN, None)
    return True
