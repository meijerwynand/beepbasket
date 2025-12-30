window.BeepBasketCamera = {
  async openScanner(card) {
    // 1. Load ZXing FIRST
    if (!window.ZXing) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@zxing/library@latest/umd/index.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    // 2. Direct dialog
    const dialog = document.createElement("ha-dialog");
    dialog.hass = card._hass;
    dialog.heading = "📷 Camera Scanner";
    
    const content = document.createElement("div");
    content.style.cssText = "text-align: center; padding: 1em;";
    content.innerHTML = `
      <video id="scannerVideo" autoplay playsinline muted 
             style="width: 100%; max-width: 400px; border-radius: 8px; background: #000; display: block;"></video>
      <div id="scannerStatus" style="margin-top: 1em; font-size: 0.9em; color: var(--secondary-text-color);">
        Click OK to start camera
      </div>
    `;
    dialog.appendChild(content);
    
    const okBtn = document.createElement("ha-button");
    okBtn.slot = "primaryAction";
    okBtn.innerText = "Start Camera";
    okBtn.addEventListener("click", () => this._startCamera(card, dialog));
    
    const closeBtn = document.createElement("ha-button");
    closeBtn.slot = "secondaryAction";
    closeBtn.innerText = "Close";
    closeBtn.addEventListener("click", () => dialog.close());
    
    dialog.append(okBtn, closeBtn);
    document.body.appendChild(dialog);
    dialog.open = true;
  },

  async _startCamera(card, dialog) {
    const video = dialog.querySelector("#scannerVideo");
    const status = dialog.querySelector("#scannerStatus");
    
    try {
      // ZXing handles stream + scanning in ONE call
      const codeReader = new ZXing.BrowserMultiFormatReader();
      
      // Silence ZXing noise
      const originalConsoleError = console.error;
      console.error = () => {};
      
      status.textContent = "Starting camera...";
      
      // ✅ THIS WORKS - ZXing manages everything
      codeReader.decodeFromVideoDevice(
        null, 
        video,
        (result, err) => {
          console.error = originalConsoleError;
          
          if (result) {
            console.log('✅ SCANNED:', result.text);
            status.textContent = `✅ Found: ${result.text}`;
            codeReader.reset();
            card._barcodeField.value = result.text;
            setTimeout(() => {
              card._addQuick();
              dialog.close();
            }, 500);
            BarcodeUI.showToast(card, `📷 Scanned: ${result.text}`);
          }
        },
        {
          delayBetweenScanAttempts: 1000,
          tryHarder: true,
          videoConstraints: {
            facingMode: 'environment',
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        }
      );
      
      status.textContent = "📷 Point barcode at camera";
      
      // Cleanup
      dialog.addEventListener('closed', () => {
        codeReader.reset();
        console.error = originalConsoleError;
        if (video.srcObject) {
          video.srcObject.getTracks().forEach(track => track.stop());
        }
      }, { once: true });
      
    } catch (e) {
      console.error = originalConsoleError;
      status.textContent = "Camera failed";
      BarcodeUI.showToast(card, "Camera error", true);
    }
  }
};
