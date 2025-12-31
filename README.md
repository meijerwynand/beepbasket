# BeepBasket 

**Beep barcodes straight into your shopping basket!**

## Features
- Instant barcode → shopping list  
- OpenFoodFacts auto-lookup
- Local product cache (JSON)
- Custom UI card (`beepbasket-card`)
- Dustbin sensor support

## Usage
```
type: custom:beepbasket-card
```

## Services
```
beepbasket.add_mapping
beepbasket.remove_mapping
```


## External barcode scanner support

Here is a TTL comms for a R35C-B scanner with a ESP32-S2-mini that scans directly into BeepBasket. This is the ESPHome config for read barcodes for Home Assistant usage.

```yaml
logger:
  level: INFO  # Clean logs

uart:
  id: r35c
  tx_pin: GPIO17
  rx_pin: GPIO16
  baud_rate: 57600
  parity: NONE

# Global storage for HA
globals:
  - id: barcode_buffer
    type: std::string
    initial_value: '""'
  - id: last_scan_time
    type: uint32_t
    initial_value: '0'

interval:
  - interval: 500ms
    then:
      - lambda: |-
          static char buf[64];  
          static int pos = 0;
          static uint32_t clear_time = 0;
          
          uint8_t byte;
          while (id(r35c).available()) {
            if (!id(r35c).read_byte(&byte)) break;
            
            if (byte == '\r' || byte == '\n') {
              if (pos > 0) {
                buf[pos] = '\0';
                if (millis() - id(last_scan_time) > 1000) {
                  id(barcode_buffer) = std::string(buf, pos);
                  id(dustbin_barcode).publish_state(id(barcode_buffer));
                  ESP_LOGI("BARCODE", "Dustbin: '%s'", buf);
                  id(last_scan_time) = millis();
                  clear_time = millis() + 3000;  // Clear in 3s
                }
                pos = 0;
              }
              break;
            }
            if (pos < 63) buf[pos++] = byte;
          }
          
          // Clear buffer after 3s delay
          if (clear_time > 0 && millis() > clear_time && id(barcode_buffer).length() > 0) {
            id(barcode_buffer) = "";
            id(dustbin_barcode).publish_state("");
            clear_time = 0;
            ESP_LOGI("BARCODE", "Buffer cleared");
          }

text_sensor:
  - platform: template
    name: "Dustbin Barcode"
    id: dustbin_barcode
    lambda: |-
      return id(barcode_buffer);
    update_interval: never

```

## Barcode scanner details
