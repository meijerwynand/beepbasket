class BeepBasketCard extends HTMLElement {
  _refreshTimeout = null;
  _refreshPending = false;
  _initialized = false;
  _unsubCache = null;
  _allData = null;
  _selected = {};
  _hass = null;
  _shoppingItems = new Set();
  _lastShoppingHash = '';
  _lastShoppingState = null;

  set hass(hass) {
    const oldShoppingState = this._hass?.states?.['todo.shopping_list'];
    this._hass = hass;

    if (!this._initialized) {
      this._initialized = true;
      this._loadModules().then(async () => {
        this._build();
        setTimeout(() => this._debouncedRefresh(), 100);
        this._subscribeUpdates();
      });
    } else {
      const newShoppingState = hass.states?.['todo.shopping_list'];
      if (
        newShoppingState &&
        oldShoppingState &&
        (oldShoppingState.state !== newShoppingState.state ||
          oldShoppingState.last_changed !== newShoppingState.last_changed)
      ) {
        this._debouncedRefresh();
      }
    }
  }

  async _subscribeUpdates() {
    if (this._unsubCache) {
      this._unsubCache();
      this._unsubCache = null;
    }

    const shoppingListEntity = 'todo.shopping_list';
    this._unsubCache = this._hass.connection.subscribeEvents(
      async (event) => {
        if (
          event.event_type === 'state_changed' &&
          event.data?.entity_id === shoppingListEntity
        ) {
          await this._debouncedRefresh();
        }
      },
      'state_changed'
    );
  }

  disconnectedCallback() {
    if (typeof this._unsubCache === 'function') {
      this._unsubCache();
      this._unsubCache = null;
    }

    if (this._refreshTimeout) {
      clearTimeout(this._refreshTimeout);
      this._refreshTimeout = null;
    }

    if (window.BeepBasketTable?._refreshTimeout) {
      clearTimeout(window.BeepBasketTable._refreshTimeout);
    }
  }

  async _loadModules() {
    if (!window.BeepBasketTable) {
      await Promise.all([
        this._loadScript('/local/beepbasket-camera.js'),
        this._loadScript('/local/beepbasket-table.js'),
        this._loadScript('/local/beepbasket-ui.js'),
      ]);
    }
  }

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

_build() {
  const card = document.createElement('ha-card');
  card.header = 'BeepBasket';
  card.style.padding = '1em';

  const inputContainer = document.createElement('div');
  inputContainer.style.cssText = `
    position: relative;
    width: 100%;
    margin-bottom: 1em;
  `;

  this._barcodeField = document.createElement('ha-textfield');
  this._barcodeField.label = 'Scan or add barcode';
  this._barcodeField.style.width = '100%';

  const quickAddBtn = document.createElement('ha-icon-button');
  quickAddBtn.title = 'Add';
  quickAddBtn.style.cssText = `
    position: absolute;
    right: 52px;
    top: 50%;
    transform: translateY(-50%);
    --mdc-icon-button-size: 32px;
    pointer-events: auto;
    z-index: 1;
  `;
  const plusIcon = document.createElement('ha-icon');
  plusIcon.icon = 'mdi:plus';
  quickAddBtn.appendChild(plusIcon);
  quickAddBtn.addEventListener('click', () => this._addQuick());

  const scanBtn = document.createElement('ha-icon-button');
  scanBtn.title = 'Scan';
  scanBtn.style.cssText = `
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    --mdc-icon-button-size: 32px;
    pointer-events: auto;
    z-index: 1;
  `;
  const cameraIcon = document.createElement('ha-icon');
  cameraIcon.icon = 'mdi:camera';
  scanBtn.appendChild(cameraIcon);
  scanBtn.addEventListener('click', () => BeepBasketCamera.openScanner(this));

  inputContainer.append(this._barcodeField, quickAddBtn, scanBtn);

  this._searchField = document.createElement('ha-textfield');
  this._searchField.label = 'Search barcode or product';
  this._searchField.style.width = '100%';
  this._searchField.style.marginBottom = '1em';
  this._searchField.addEventListener('input', () => this._filterTable());

  this._bulkActions = document.createElement('div');
  this._bulkActions.style.cssText =
    'display: flex; gap: 1em; margin-bottom: 1em; align-items: center;';
  this._bulkActions.innerHTML = `
    <span style="font-size: 0.9em; color: var(--secondary-text-color);">0 selected</span>
    <ha-button id="bulk-delete" size="small" style="--mdc-theme-primary: var(--error-color);" disabled>
      Delete Selected
    </ha-button>
  `;

  this._content = document.createElement('div');
  this._content.className = 'barcode-table-wrapper';
  this._content.innerHTML = '<p>Loading…</p>';

  // ✅ Export button BELOW table
  this._exportContainer = document.createElement('div');
  this._exportContainer.style.cssText = `
    display: flex;
    justify-content: center;
    margin-top: 1em;
    padding-top: 1em;
    border-top: 1px solid var(--divider-color);
  `;
  const exportBtn = document.createElement('ha-button');
  exportBtn.size = 'medium';
  exportBtn.innerText = '📤 Export Data';
  exportBtn.addEventListener('click', () => this._exportData());
  this._exportContainer.appendChild(exportBtn);

  card.append(inputContainer, this._searchField, this._bulkActions, this._content, this._exportContainer);
  this.innerHTML = '';
  this.append(card);

  this._initStyles();
}



  _initStyles() {
    if (document.getElementById('barcode-final')) return;

    const style = document.createElement('style');
    style.id = 'barcode-final';
    style.textContent = `
      .barcode-table-wrapper {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }

      .barcode-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .barcode-table col:nth-child(1) { width: 48px; }
      .barcode-table col:nth-child(2) { width: auto; }
      .barcode-table col:nth-child(3) { width: 120px; }

      .barcode-table tbody tr {
        transition: background-color 150ms ease;
      }

      .barcode-table tbody tr:hover {
        background: rgba(var(--primary-color-rgb), 0.04);
      }

      .barcode-table td {
        vertical-align: middle;
        padding: 8px 4px;
        overflow: hidden;
      }

      .action-buttons {
        display: flex;
        gap: 2px;
        justify-content: flex-end;
        flex-wrap: nowrap;
        min-width: 96px;
      }

      @media (min-width: 800px) {
        .barcode-table { min-width: 600px; }
        .barcode-table col:nth-child(3) { width: 160px; }
      }

      @media (min-width: 500px) {
        .barcode-table { min-width: 480px; }
        .barcode-table col:nth-child(3) { width: 120px; }
      }

      @media (max-width: 499px) {
        .barcode-table { min-width: 420px; }
        .barcode-table col:nth-child(3) { width: 96px; }
      }

      ha-dialog {
        --mdc-dialog-max-width: 600px;
        --mdc-dialog-min-width: 400px;
        max-width: 90vw;
      }

      ha-dialog .mdc-dialog__surface {
        padding: 24px;
        max-height: 90vh;
        overflow-y: auto;
      }

      ha-dialog ha-textfield {
        width: 100%;
        margin-bottom: 16px;
      }
    `;
    document.head.appendChild(style);
  }

  async _debouncedRefresh() {
    if (this._refreshPending) {
      clearTimeout(this._refreshTimeout);
    }
    this._refreshPending = true;

    this._refreshTimeout = setTimeout(async () => {
      try {
        const data = await this._hass.callApi('GET', 'beepbasket/mappings');
        this._allData = data;
        this._selected = {};

        const shoppingListItems = await this._hass.callApi('GET', 'shopping_list');
        const pendingItems = shoppingListItems.filter(
          (item) => item.status === 'needs_action' || !item.complete
        );
        this._shoppingItems = new Map(
          pendingItems.map((item) => [item.name.toLowerCase().trim(), item])
        );

        BeepBasketTable.render(this, data, this._shoppingItems);
      } catch (err) {
        this._content.innerHTML = `<p style="color:var(--error-color)">Error: ${err.message}</p>`;
      } finally {
        this._refreshPending = false;
      }
    }, 800);
  }

  _filterTable() {
    const term = this._searchField.value.toLowerCase();
    this._selected = {};
    const filtered = {};
    Object.entries(this._allData || {}).forEach(([k, v]) => {
      if (k.includes(term) || (v.name && v.name.toLowerCase().includes(term))) {
        filtered[k] = v;
      }
    });
    BeepBasketTable.render(this, filtered, this._shoppingItems);
  }

  _exportData() {
    if (!this._allData) return;
    const blob = new Blob([JSON.stringify(this._allData, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `barcode_mappings_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    BeepBasketUI.showToast(this, 'Data exported');
  }

  async _addQuick() {
    const barcode = this._barcodeField.value.trim();
    if (!barcode) {
      BeepBasketUI.shakeField(this._barcodeField);
      return BeepBasketUI.showToast(this, 'Enter barcode first', true);
    }

    BeepBasketUI.showToast(this, 'Looking up product...');

    let suggestedData = { name: barcode };
    let showAutoFill = false;

    try {
      const lookup = await this._hass.callApi('GET', `beepbasket/lookup/${barcode}`);
      if (lookup && !lookup.error) {
        suggestedData = lookup;
        showAutoFill = true;
      }
    } catch {}

    await BeepBasketUI.showDialog(
      this,
      'Add Product',
      `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <ha-textfield label="Barcode" id="barcodeField" value="${barcode}" readOnly style="font-family: monospace;"></ha-textfield>
          <ha-textfield label="Product Name *" id="nameField" value="${suggestedData.name}" dialogInitialFocus></ha-textfield>
          <ha-textfield label="Quantity" id="quantityField" value="${suggestedData.quantity || ''}" placeholder="Optional"></ha-textfield>
          <ha-textfield label="Stores" id="storesField" value="${suggestedData.stores || ''}" placeholder="Optional"></ha-textfield>
          <ha-textfield label="Brands" id="brandsField" value="${suggestedData.brands || ''}" placeholder="Optional"></ha-textfield>
          ${showAutoFill ? '<div style="font-size: 0.85em; color: var(--success-color); padding: 12px; background: rgba(0,255,0,0.1); border-radius: 4px; margin-top: 8px;">Auto-filled from OpenFoodFacts</div>' : ''}
        </div>
      `,
      async (dialog) => {
        const nameField = dialog.querySelector('#nameField');
        const quantityField = dialog.querySelector('#quantityField');
        const storesField = dialog.querySelector('#storesField');
        const brandsField = dialog.querySelector('#brandsField');

        const name = nameField.value.trim();
        if (!name) return BeepBasketUI.showToast(this, 'Name required', true);

        await this._hass.callService('beepbasket', 'add_mapping', {
          code: barcode,
          product_name: name,
          brands: brandsField.value.trim(),
          quantity: quantityField.value.trim(),
          stores: storesField.value.trim(),
        });
        BeepBasketUI.showToast(this, 'Product added');
        this._barcodeField.value = '';
        this._debouncedRefresh();
      },
      'Add Product',
      'Cancel'
    );
  }

  _updateBulkActions(count) {
    const bulkDelete = this._bulkActions.querySelector('#bulk-delete');
    const countSpan = this._bulkActions.querySelector('span');
    if (bulkDelete) bulkDelete.disabled = count === 0;
    if (countSpan) countSpan.textContent = `${count} selected`;
  }

  async _showEditDialog(barcode, entry) {
    try {
      const freshData = await this._hass.callApi('GET', 'beepbasket/mappings');
      const freshEntry = freshData[barcode] || entry;

      BeepBasketUI.showDialog(
        this,
        'Edit Product',
        `
          <div style="display: flex; flex-direction: column; gap: 16px;">
            <ha-textfield label="Barcode" id="barcodeField" value="${barcode}" readOnly style="font-family: monospace;"></ha-textfield>
            <ha-textfield label="Product Name *" id="nameField" value="${freshEntry.name || ''}" dialogInitialFocus></ha-textfield>
            <ha-textfield label="Quantity" id="quantityField" value="${freshEntry.quantity || ''}" placeholder="Optional"></ha-textfield>
            <ha-textfield label="Stores" id="storesField" value="${freshEntry.stores || ''}" placeholder="Optional"></ha-textfield>
            <ha-textfield label="Brands" id="brandsField" value="${freshEntry.brands || ''}" placeholder="Optional"></ha-textfield>
          </div>
        `,
        async (dialog) => {
          const nameField = dialog.querySelector('#nameField');
          const quantityField = dialog.querySelector('#quantityField');
          const storesField = dialog.querySelector('#storesField');
          const brandsField = dialog.querySelector('#brandsField');

          const name = nameField.value.trim();
          if (!name) return BeepBasketUI.showToast(this, 'Name required', true);

          await this._hass.callService('beepbasket', 'add_mapping', {
            code: barcode,
            product_name: name,
            brands: brandsField.value.trim(),
            quantity: quantityField.value.trim(),
            stores: storesField.value.trim(),
          });
          BeepBasketUI.showToast(this, 'Product updated');
          this._debouncedRefresh();
        },
        'Save Changes',
        'Cancel'
      );
    } catch {
      BeepBasketUI.showDialog(
        this,
        'Edit Product',
        `
          <div style="display: flex; flex-direction: column; gap: 16px;">
            <ha-textfield label="Barcode" id="barcodeField" value="${barcode}" readOnly style="font-family: monospace;"></ha-textfield>
            <ha-textfield label="Product Name *" id="nameField" value="${entry.name || ''}" dialogInitialFocus></ha-textfield>
            <ha-textfield label="Quantity" id="quantityField" value="${entry.quantity || ''}" placeholder="Optional"></ha-textfield>
            <ha-textfield label="Stores" id="storesField" value="${entry.stores || ''}" placeholder="Optional"></ha-textfield>
            <ha-textfield label="Brands" id="brandsField" value="${entry.brands || ''}" placeholder="Optional"></ha-textfield>
          </div>
        `,
        async (dialog) => {
          const nameField = dialog.querySelector('#nameField');
          const quantityField = dialog.querySelector('#quantityField');
          const storesField = dialog.querySelector('#storesField');
          const brandsField = dialog.querySelector('#brandsField');

          const name = nameField.value.trim();
          if (!name) return BeepBasketUI.showToast(this, 'Name required', true);

          await this._hass.callService('beepbasket', 'add_mapping', {
            code: barcode,
            product_name: name,
            brands: brandsField.value.trim(),
            quantity: quantityField.value.trim(),
            stores: storesField.value.trim(),
          });
          BeepBasketUI.showToast(this, 'Product updated');
          this._debouncedRefresh();
        },
        'Save Changes',
        'Cancel'
      );
    }
  }

  _showDeleteDialog(barcode, entry) {
    BeepBasketUI.showDialog(
      this,
      'Delete Product',
      `<div style="padding: 24px; text-align: center;">
        <ha-icon icon="mdi:alert-circle" style="width: 64px; height: 64px; color: var(--error-color); margin-bottom: 16px;"></ha-icon>
        <div style="font-size: 18px; font-weight: 500;">Delete this product?</div>
        <div style="font-size: 14px; color: var(--secondary-text-color);">
          <strong>${entry.name || 'unknown'}</strong><br>
          <code style="font-family: monospace; font-size: 12px; background: var(--disabled-background-color); padding: 4px 8px; border-radius: 4px;">${barcode}</code>
        </div>
      </div>`,
      async () => {
        try {
          await this._hass.callService('beepbasket', 'remove_mapping', { barcode });
          BeepBasketUI.showToast(this, 'Product deleted');
          this._debouncedRefresh();
        } catch (e) {
          BeepBasketUI.showToast(this, `Error: ${e.message}`, true);
        }
      },
      'Delete',
      'Cancel',
      true
    );
  }

  async _deleteSelected() {
    const selected = Object.keys(this._selected).filter((k) => this._selected[k]);
    if (selected.length === 0) return;

    await BeepBasketUI.showDialog(
      this,
      'Delete Selected',
      `<div style="padding: 24px; text-align: center;">
        <ha-icon icon="mdi:alert-circle" style="width: 64px; height: 64px; color: var(--error-color); margin-bottom: 16px;"></ha-icon>
        <div style="font-size: 18px; font-weight: 500;">Delete ${selected.length} selected items?</div>
      </div>`,
      async () => {
        await Promise.all(
          selected.map((barcode) =>
            this._hass.callService('beepbasket', 'remove_mapping', { barcode })
          )
        );
        BeepBasketUI.showToast(this, `Deleted ${selected.length} items`);
        this._selected = {};
        this._debouncedRefresh();
      },
      'Delete All',
      'Cancel',
      true
    );
  }

  setConfig() {}
  getCardSize() {
    return 8;
  }
}

customElements.define('beepbasket-card', BeepBasketCard);
