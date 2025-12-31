window.BeepBasketUI = {
  showToast(card, msg, error = false) {
    const toast = document.createElement("div");
    Object.assign(toast.style, {
      position: "fixed", top: "24px", right: "24px", zIndex: "10000",
      background: error ? "var(--error-color)" : "var(--success-color)",
      color: "white", padding: "16px 24px", borderRadius: "8px", fontWeight: "500",
      fontSize: "14px", boxShadow: "0 8px 32px rgba(0,0,0,0.24)",
      transform: "translateX(400px)", opacity: "0",
      transition: "all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      maxWidth: "400px", wordWrap: "break-word"
    });
    toast.textContent = msg;
    
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.transform = "translateX(0)";
      toast.style.opacity = "1";
    });
    
    setTimeout(() => {
      toast.style.transform = "translateX(400px)";
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  shakeField(field) {
    field.style.borderColor = "var(--error-color)";
    field.style.boxShadow = "0 0 0 2px var(--error-color)";
    field.style.animation = "shake 0.5s ease-in-out";
    
    setTimeout(() => {
      field.style.borderColor = "";
      field.style.boxShadow = "";
      field.style.animation = "";
    }, 500);
  },

  async showDialog(card, title, contentHTML, onConfirm, confirmText = "Save", cancelText = "Cancel", isDanger = false) {
    return new Promise((resolve) => {
      const dialog = document.createElement("ha-dialog");
      dialog.hass = card._hass;
      dialog.heading = title;

      const content = document.createElement("div");
      content.style.cssText = "display: flex; flex-direction: column; gap: 16px; padding: 16px 0;";
      content.innerHTML = contentHTML;
      dialog.appendChild(content);

      const cancelBtn = document.createElement("ha-button");
      cancelBtn.slot = "secondaryAction";
      cancelBtn.variant = "primary";
      cancelBtn.type = "button";
      cancelBtn.innerText = cancelText;
      cancelBtn.addEventListener("click", () => {
        dialog.close();
        resolve(dialog);
      });

      const confirmBtn = document.createElement("ha-button");
      confirmBtn.slot = "primaryAction";
      confirmBtn.variant = isDanger ? "danger" : "primary";
      confirmBtn.type = "button";
      confirmBtn.innerText = confirmText;
      confirmBtn.addEventListener("click", async () => {
        try {
          await onConfirm(dialog);
        } catch (e) {
          BarcodeUI.showToast(card, `Error: ${e.message || e.body?.message || e}`, true);
          return;
        }
        dialog.close();
        resolve(dialog);
      });

      dialog.append(cancelBtn, confirmBtn);

      dialog.addEventListener("closed", () => {
        if (document.body.contains(dialog)) document.body.removeChild(dialog);
        resolve(dialog);
      });

      document.body.appendChild(dialog);
      dialog.updateComplete.then(() => dialog.open = true);
    });
  }
};
