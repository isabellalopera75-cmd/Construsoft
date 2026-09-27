/**
 * ConstruSoft - Módulo de Recursos (recursos.js)
 * Implementa 5.1 Vista maestra, 5.2 Crear recurso, 5.3 Editar y 5.4 Eliminar
 */

let allResources = [];
let unitsList = [];
let currentCategoryTab = 'Todos';
let activeSearchTerm = '';
let currentEditingResource = null;
let activeViaPrecio = 'A'; // 'A' (Costo base) o 'B' (Costo total)

// Inicializar módulo al cargarse la vista
async function initRecursosModule() {
  await loadUnitsList();
  await loadResourcesData();
  setupRecursosEvents();
}

// Cargar catálogo de recursos desde el servidor SQLite
async function loadResourcesData() {
  try {
    const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
    const companyId = user.company ? user.company.id : 1;
    const response = await fetch(`/api/resources?company_id=${companyId}`);
    const data = await response.json();

    if (data.success) {
      allResources = data.resources || [];
      updateTabCounters();
      renderResourcesTable();
    }
  } catch (err) {
    console.error('Error al cargar recursos:', err);
  }
}

// Cargar unidades de medida de la empresa
async function loadUnitsList() {
  try {
    const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
    const companyId = user.company ? user.company.id : 1;
    const response = await fetch(`/api/units?company_id=${companyId}`);
    const data = await response.json();
    if (data.success) {
      unitsList = data.units || [];
      populateUnitSelects();
    }
  } catch (err) {
    console.error('Error al cargar unidades:', err);
  }
}

function populateUnitSelects() {
  const filterSelect = document.getElementById('filter-unit');
  const modalSelect = document.getElementById('modal-res-unit');
  if (!filterSelect || !modalSelect) return;

  filterSelect.innerHTML = '<option value="">Todas las unidades</option>';
  modalSelect.innerHTML = '<option value="">Seleccione una unidad...</option>';

  unitsList.forEach(u => {
    filterSelect.innerHTML += `<option value="${u.codigo}">${u.codigo} — ${u.nombre}</option>`;
    modalSelect.innerHTML += `<option value="${u.codigo}">${u.codigo} — ${u.nombre} (${u.categoria})</option>`;
  });
}

// Actualizar contadores en pestañas fijas
function updateTabCounters() {
  const counts = {
    'Todos': allResources.length,
    'Materiales': allResources.filter(r => r.tipo === 'Materiales').length,
    'Equipos': allResources.filter(r => r.tipo === 'Equipos').length,
    'Personal': allResources.filter(r => r.tipo === 'Personal').length,
    'Actividades': allResources.filter(r => r.tipo === 'Actividades').length
  };

  document.querySelectorAll('.resource-tab-btn').forEach(btn => {
    const tab = btn.getAttribute('data-tab');
    const badge = btn.querySelector('.tab-count');
    if (badge && counts[tab] !== undefined) {
      badge.textContent = counts[tab];
    }
  });
}

// Renderizar tabla aplicando filtros y regla de buscador que rompe pestañas
function renderResourcesTable() {
  const tbody = document.getElementById('resources-table-body');
  const countIndicator = document.getElementById('filtered-count-indicator');
  if (!tbody) return;

  tbody.innerHTML = '';

  const filterCode = (document.getElementById('filter-code')?.value || '').trim().toLowerCase();
  const filterName = (document.getElementById('filter-name')?.value || '').trim().toLowerCase();
  const filterUnit = (document.getElementById('filter-unit')?.value || '').trim();
  const filterMinPrice = parseFloat(document.getElementById('filter-min-price')?.value || 0);
  const filterMaxPrice = parseFloat(document.getElementById('filter-max-price')?.value || 0);

  let filtered = allResources.filter(r => {
    // 5.1 Regla: Al escribir un término en la barra de búsqueda, el filtro por pestañas se rompe
    if (activeSearchTerm.length > 0) {
      const matchSearch = r.nombre.toLowerCase().includes(activeSearchTerm) ||
                          r.codigo.toLowerCase().includes(activeSearchTerm) ||
                          r.tipo.toLowerCase().includes(activeSearchTerm) ||
                          r.unidad.toLowerCase().includes(activeSearchTerm);
      if (!matchSearch) return false;
    } else {
      // Si no hay búsqueda global activa, respeta la pestaña actual
      if (currentCategoryTab !== 'Todos' && r.tipo !== currentCategoryTab) {
        return false;
      }
    }

    // Filtros secundarios
    if (filterCode && !r.codigo.toLowerCase().includes(filterCode)) return false;
    if (filterName && !r.nombre.toLowerCase().includes(filterName)) return false;
    if (filterUnit && r.unidad !== filterUnit) return false;
    if (filterMinPrice > 0 && r.precioTotal < filterMinPrice) return false;
    if (filterMaxPrice > 0 && r.precioTotal > filterMaxPrice) return false;

    return true;
  });

  if (countIndicator) {
    countIndicator.textContent = `${filtered.length} recurso${filtered.length === 1 ? '' : 's'} encontrado${filtered.length === 1 ? '' : 's'}`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:3rem; color:var(--text-muted);">
          No se encontraron recursos que coincidan con los criterios de búsqueda.
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach(r => {
    const tr = document.createElement('tr');
    const inUseBadge = r.enUso 
      ? `<span title="En uso en: ${r.apusVinculados.join(', ')}" style="font-size:0.68rem; background:rgba(217,107,67,0.15); color:var(--terracota-light); padding:0.15rem 0.4rem; border-radius:3px; margin-left:0.5rem; cursor:help;">EN APU</span>`
      : '';

    tr.innerHTML = `
      <td><span class="res-code-badge">${r.codigo}</span></td>
      <td>
        <div style="font-weight:600; color:var(--text-primary);">${r.nombre} ${inUseBadge}</div>
        <small style="color:var(--text-muted); font-size:0.75rem;">${r.tipo}</small>
      </td>
      <td><span class="res-unit-badge">${r.unidad}</span></td>
      <td style="font-family:var(--font-mono);">$${formatMoney(r.precioBase)}</td>
      <td style="font-family:var(--font-mono); color:var(--text-secondary);">${r.ivaPorcentaje}%</td>
      <td style="font-family:var(--font-mono); font-weight:700; color:#fff;">$${formatMoney(r.precioTotal)}</td>
      <td style="text-align:right;">
        <button class="res-action-btn edit-btn" title="Editar recurso" onclick="handleEditResource(${r.id})">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button class="res-action-btn delete" title="Eliminar recurso" onclick="handleDeleteResource(${r.id})">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function formatMoney(amount) {
  return Math.round(amount || 0).toLocaleString('es-CO');
}

// Configurar eventos de pestañas, búsqueda y filtros
function setupRecursosEvents() {
  // Pestañas
  document.querySelectorAll('.resource-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.resource-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategoryTab = btn.getAttribute('data-tab');

      // Limpiar barra de búsqueda global al hacer clic explícito en pestaña
      const searchInput = document.getElementById('global-resource-search');
      if (searchInput && activeSearchTerm !== '') {
        searchInput.value = '';
        activeSearchTerm = '';
      }

      updateQuickCreateButtonText();
      renderResourcesTable();
    });
  });

  // Barra de búsqueda que rompe el filtro de pestañas
  const searchInput = document.getElementById('global-resource-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      activeSearchTerm = e.target.value.trim().toLowerCase();
      if (activeSearchTerm.length > 0) {
        // Rompe visualmente la pestaña activa marcando 'Todos los recursos'
        document.querySelectorAll('.resource-tab-btn').forEach(b => {
          if (b.getAttribute('data-tab') === 'Todos') b.classList.add('active');
          else b.classList.remove('active');
        });
      }
      renderResourcesTable();
    });
  }

  // Filtros secundarios
  ['filter-code', 'filter-name', 'filter-unit', 'filter-min-price', 'filter-max-price'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => renderResourcesTable());
    }
  });

  // Botón Crear Nuevo Recurso principal
  const btnCreateMain = document.getElementById('btn-create-resource-main');
  if (btnCreateMain) {
    btnCreateMain.addEventListener('click', () => {
      openResourcePopout(null, currentCategoryTab !== 'Todos' ? currentCategoryTab : 'Materiales');
    });
  }

  // Acceso rápido dentro de pestaña
  const btnCreateQuick = document.getElementById('btn-create-resource-quick');
  if (btnCreateQuick) {
    btnCreateQuick.addEventListener('click', () => {
      openResourcePopout(null, currentCategoryTab !== 'Todos' ? currentCategoryTab : 'Materiales');
    });
  }

  // Eventos de Popout de Crear/Editar
  setupPopoutPriceCalculation();
}

function updateQuickCreateButtonText() {
  const btn = document.getElementById('btn-create-resource-quick');
  if (!btn) return;
  if (currentCategoryTab === 'Todos') {
    btn.style.display = 'none';
  } else {
    btn.style.display = 'inline-flex';
    btn.innerHTML = `+ Agregar ${currentCategoryTab.slice(0, -1)}`;
  }
}

// ----------------------------------------------------------------------------
// 5.2 CREAR RECURSO & 5.3 EDITAR RECURSO (Pop-out y Doble Vía de Precio)
// ----------------------------------------------------------------------------

function openResourcePopout(resource = null, preselectedType = 'Materiales') {
  currentEditingResource = resource;
  const modal = document.getElementById('resource-popout-modal');
  const title = document.getElementById('popout-modal-title');
  const codeDisplay = document.getElementById('modal-res-code');
  const nameInput = document.getElementById('modal-res-name');
  const typeSelect = document.getElementById('modal-res-type');
  const unitSelect = document.getElementById('modal-res-unit');
  const baseInput = document.getElementById('modal-res-price-base');
  const ivaInput = document.getElementById('modal-res-price-iva');
  const totalInput = document.getElementById('modal-res-price-total');
  const viaIndicator = document.getElementById('active-via-indicator');
  const alertBox = document.getElementById('modal-res-alert');

  if (alertBox) alertBox.style.display = 'none';

  if (resource) {
    // Modo Edición
    title.textContent = 'Editar Recurso';
    codeDisplay.value = resource.codigo;
    nameInput.value = resource.nombre;
    typeSelect.value = resource.tipo;
    unitSelect.value = resource.unidad;
    baseInput.value = resource.precioBase;
    ivaInput.value = resource.ivaPorcentaje || 0;
    totalInput.value = resource.precioTotal;
    activeViaPrecio = resource.viaPrecio || 'A';

    // 5.2 / 5.3 Regla: Reproducir el mismo bloqueo que se guardó
    applyPriceCrossLock(activeViaPrecio);
  } else {
    // Modo Creación
    title.textContent = 'Crear Nuevo Recurso';
    codeDisplay.value = 'Asignado automáticamente por servidor';
    nameInput.value = '';
    typeSelect.value = preselectedType;
    unitSelect.value = '';
    baseInput.value = '';
    ivaInput.value = '';
    totalInput.value = '';
    activeViaPrecio = 'A';

    // Desbloquear ambos campos para permitir elegir vía
    unlockBothPrices();
  }

  modal.style.display = 'flex';
  nameInput.focus();
}

function closeResourcePopout() {
  const modal = document.getElementById('resource-popout-modal');
  if (modal) modal.style.display = 'none';
  currentEditingResource = null;
}

// Lógica de Doble Vía de Precio y Bloqueo Cruzado (5.2)
function setupPopoutPriceCalculation() {
  const baseInput = document.getElementById('modal-res-price-base');
  const ivaInput = document.getElementById('modal-res-price-iva');
  const totalInput = document.getElementById('modal-res-price-total');

  // Vía A: Usuario escribe en Costo Base
  baseInput.addEventListener('input', () => {
    const val = baseInput.value.trim();
    if (val === '') {
      unlockBothPrices();
      totalInput.value = '';
      return;
    }

    activeViaPrecio = 'A';
    applyPriceCrossLock('A');

    const base = parseFloat(val) || 0;
    const iva = parseFloat(ivaInput.value) || 0;
    const total = Math.round(base * (1 + iva / 100));
    totalInput.value = total;
  });

  // Vía B: Usuario escribe en Costo Total
  totalInput.addEventListener('input', () => {
    const val = totalInput.value.trim();
    if (val === '') {
      unlockBothPrices();
      baseInput.value = '';
      return;
    }

    activeViaPrecio = 'B';
    applyPriceCrossLock('B');

    const total = parseFloat(val) || 0;
    const iva = parseFloat(ivaInput.value) || 0;
    const base = Math.round(total / (1 + iva / 100));
    baseInput.value = base;
  });

  // Modificación del IVA
  ivaInput.addEventListener('input', () => {
    const iva = parseFloat(ivaInput.value) || 0;

    if (activeViaPrecio === 'A' && baseInput.value !== '') {
      const base = parseFloat(baseInput.value) || 0;
      totalInput.value = Math.round(base * (1 + iva / 100));
    } else if (activeViaPrecio === 'B' && totalInput.value !== '') {
      const total = parseFloat(totalInput.value) || 0;
      baseInput.value = Math.round(total / (1 + iva / 100));
    }
  });

  // Formulario Submit
  const form = document.getElementById('resource-popout-form');
  if (form) {
    form.addEventListener('submit', handleSaveResourceSubmit);
  }
}

function applyPriceCrossLock(via) {
  const baseInput = document.getElementById('modal-res-price-base');
  const totalInput = document.getElementById('modal-res-price-total');
  const viaIndicator = document.getElementById('active-via-indicator');

  if (via === 'A') {
    baseInput.disabled = false;
    baseInput.classList.remove('locked-field');
    totalInput.disabled = true;
    totalInput.classList.add('locked-field');
    if (viaIndicator) viaIndicator.textContent = 'Vía A activa: Costo Base digitado (Total calculado)';
  } else if (via === 'B') {
    totalInput.disabled = false;
    totalInput.classList.remove('locked-field');
    baseInput.disabled = true;
    baseInput.classList.add('locked-field');
    if (viaIndicator) viaIndicator.textContent = 'Vía B activa: Costo Total digitado (Base calculada)';
  }
}

function unlockBothPrices() {
  const baseInput = document.getElementById('modal-res-price-base');
  const totalInput = document.getElementById('modal-res-price-total');
  const viaIndicator = document.getElementById('active-via-indicator');

  baseInput.disabled = false;
  baseInput.classList.remove('locked-field');
  totalInput.disabled = false;
  totalInput.classList.remove('locked-field');
  if (viaIndicator) viaIndicator.textContent = 'Escriba en Costo Base (Vía A) o Costo Total (Vía B)';
}

// Guardar Recurso (Crear o Actualizar)
async function handleSaveResourceSubmit(e) {
  e.preventDefault();
  const alertBox = document.getElementById('modal-res-alert');
  const nameInput = document.getElementById('modal-res-name');
  const typeSelect = document.getElementById('modal-res-type');
  const unitSelect = document.getElementById('modal-res-unit');
  const baseInput = document.getElementById('modal-res-price-base');
  const ivaInput = document.getElementById('modal-res-price-iva');
  const totalInput = document.getElementById('modal-res-price-total');

  const nombre = nameInput.value.trim();
  const tipo = typeSelect.value;
  const unidad = unitSelect.value;
  const precioBase = parseFloat(baseInput.value) || 0;
  const ivaPorcentaje = parseFloat(ivaInput.value) || 0;
  const precioTotal = parseFloat(totalInput.value) || 0;

  if (!nombre) {
    showModalAlert('El nombre del recurso es obligatorio.');
    return;
  }
  if (!unidad) {
    showModalAlert('Debe seleccionar una unidad de medida.');
    return;
  }
  if (precioBase <= 0 && precioTotal <= 0) {
    showModalAlert('Debe ingresar un precio válido (Costo base o Costo total).');
    return;
  }

  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  const companyId = user.company ? user.company.id : 1;

  const payload = {
    companyId,
    nombre,
    tipo,
    unidad,
    precioBase,
    ivaPorcentaje,
    precioTotal,
    viaPrecio: activeViaPrecio
  };

  // Si estamos editando y el recurso está en uso en algún APU (5.3)
  if (currentEditingResource && currentEditingResource.enUso) {
    // Abrir diálogo de decisión de presupuestos abiertos
    openApuImpactDialog(payload);
    return;
  }

  await executeSaveResource(payload, false);
}

async function executeSaveResource(payload, actualizarPresupuestosAbiertos = false) {
  payload.actualizarPresupuestosAbiertos = actualizarPresupuestosAbiertos;

  try {
    const isEdit = currentEditingResource !== null;
    const url = isEdit ? `/api/resources/${currentEditingResource.id}` : '/api/resources';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      closeResourcePopout();
      closeApuImpactDialog();
      await loadResourcesData();
    } else {
      showModalAlert(data.message || 'Error al guardar el recurso.');
    }
  } catch (err) {
    showModalAlert('Error de comunicación con el servidor.');
  }
}

function showModalAlert(msg) {
  const alertBox = document.getElementById('modal-res-alert');
  if (alertBox) {
    alertBox.textContent = msg;
    alertBox.style.display = 'block';
  }
}

// ----------------------------------------------------------------------------
// 5.3 DIÁLOGO DE IMPACTO EN APUS Y PRESUPUESTOS ABIERTOS (Regla D-22)
// ----------------------------------------------------------------------------

let pendingSavePayload = null;

function openApuImpactDialog(payload) {
  pendingSavePayload = payload;
  const dialog = document.getElementById('apu-impact-dialog');
  const textEl = document.getElementById('apu-impact-message');
  if (textEl && currentEditingResource) {
    textEl.innerHTML = `
      El recurso <strong>[${currentEditingResource.codigo}] ${currentEditingResource.nombre}</strong> está en uso en 
      <strong>${currentEditingResource.apusVinculados.length}</strong> análisis de precios unitarios (APU).
      <br><br>
      ¿Desea actualizar los presupuestos abiertos vinculados a este nuevo precio?
    `;
  }
  if (dialog) dialog.style.display = 'flex';
}

function closeApuImpactDialog() {
  const dialog = document.getElementById('apu-impact-dialog');
  if (dialog) dialog.style.display = 'none';
  pendingSavePayload = null;
}

function confirmApuImpact(actualizarPresupuestos) {
  if (pendingSavePayload) {
    executeSaveResource(pendingSavePayload, actualizarPresupuestos);
  }
}

// ----------------------------------------------------------------------------
// 5.4 ELIMINAR RECURSO (Bloqueo si está en APU)
// ----------------------------------------------------------------------------

async function handleDeleteResource(resourceId) {
  const resource = allResources.find(r => r.id === resourceId);
  if (!resource) return;

  // 5.4 Regla: Si está vinculado a algún APU, el sistema bloquea y explica
  if (resource.enUso) {
    openDeleteBlockedDialog(resource);
    return;
  }

  // Si no está vinculado, pide confirmación simple
  if (confirm(`¿Está seguro de eliminar el recurso [${resource.codigo}] "${resource.nombre}" del catálogo?`)) {
    try {
      const res = await fetch(`/api/resources/${resourceId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        await loadResourcesData();
      } else {
        alert(data.message || 'No se pudo eliminar el recurso.');
      }
    } catch (e) {
      alert('Error al intentar eliminar el recurso.');
    }
  }
}

function openDeleteBlockedDialog(resource) {
  const dialog = document.getElementById('delete-blocked-dialog');
  const detailsBox = document.getElementById('delete-blocked-apus-list');
  if (detailsBox) {
    detailsBox.innerHTML = resource.apusVinculados.map(apu => `<li>${apu}</li>`).join('');
  }
  if (dialog) dialog.style.display = 'flex';
}

function closeDeleteBlockedDialog() {
  const dialog = document.getElementById('delete-blocked-dialog');
  if (dialog) dialog.style.display = 'none';
}

function handleEditResource(resourceId) {
  const resource = allResources.find(r => r.id === resourceId);
  if (resource) {
    openResourcePopout(resource, resource.tipo);
  }
}

window.handleEditResource = handleEditResource;
window.handleDeleteResource = handleDeleteResource;
window.closeResourcePopout = closeResourcePopout;
window.closeApuImpactDialog = closeApuImpactDialog;
window.confirmApuImpact = confirmApuImpact;
window.closeDeleteBlockedDialog = closeDeleteBlockedDialog;
