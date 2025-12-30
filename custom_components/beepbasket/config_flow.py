"""Config flow for Barcode → Shopping List."""
import logging
import voluptuous as vol

from homeassistant.config_entries import ConfigFlow
from homeassistant.helpers import selector

DOMAIN = "beepbasket"

_LOGGER = logging.getLogger(__name__)

class BarcodeShoppingListConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="Only one shopping list allowed")        
            
        errors = {}
        if user_input:
            entity_id = user_input["shopping_list_entity"]
            if self.hass.states.get(entity_id):
                return self.async_create_entry(
                    title="Barcode → Shopping List", 
                    data={"shopping_list_entity": entity_id}
                )
            errors["shopping_list_entity"] = "not_found"

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required("shopping_list_entity"):
                    selector.EntitySelector(selector.EntitySelectorConfig(domain="todo"))
            }),
            errors=errors
        )
