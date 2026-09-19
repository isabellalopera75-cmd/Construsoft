/**
 * ConstruSoft - Módulo de APU (Análisis de Precios Unitarios) - apu.js
 * Cumple con 6.1 Vista maestra, 6.2 Crear APU, 6.3 Consultar/Editar, 6.4 Control de cambios y 6.5 Restricciones.
 */

let allApus = [];
let availableResourcesForApu = [];
let apuUnitsList = [];
let activeApuSearch = '';
let selectedUnitFilter = '';

// Estado del APU en edición/creación
let currentEditingApu = null;
let apuModalMode = 'create'; // 'create' | 'view' | 'edit'
let currentApuLines = []; // [{ resourceId, codigo, nombre, tipo, unidad, precioTotal, cantidad, rendimiento, desperdicio, subtotal }]
let pendingApuSaveData = null;

// Inicialización del módulo al activarse la vista
async function initApuModule() {
  await loadApuUnits();
  await loadResourcesForApuPicker();
  await loadApusData();
  setupApuEvents();
}

// Cargar inventario de APUs desde SQLite
async function loadApusData() {
  try {
    const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
    const companyId = user.company ? user.company.id : 1;
    const response = await fetch(`/api/apus?company_id=${companyId}`);
    const data = await response.json();
    if (data.success) {
      allApus = data.apus || [];
      renderApusTable();
    }
  } catch (err) {
    console.error('Error al cargar APUs:', err);
  }
}

// Cargar catálogo de recursos disponibles para añadir al APU
async function loadResourcesForApuPicker() {
  try {
    const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
    const companyId = user.company ? user.company.id : 1;
    const response = await fetch(`/api/resources?company_id=${companyId}`);
    const data = await response.json();
    if (data.success) {
      availableResourcesForApu = data.resources || [];
      populateResourcePickerDropdown();
    }
  } catch (err) {
    console.error('Error al cargar recursos para APU:', err);
  }
}

// Cargar unidades de medida
async function loadApuUnits() {
  try {
    const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
    const companyId = user.company ? user.company.id : 1;
    const response = await fetch(`/api/units?company_id=${companyId}`);
    const data = await response.json();
    if (data.success) {
      apuUnitsList = data.units || [];
      populateApuUnitSelects();
    }
  } catch (err) {
    console.error('Error al cargar unidades para APU:', err);
  }
}

function populateApuUnitSelects() {
  const filterSelect = document.getElementById('filter-apu-unit');
  const modalSelect = document.getElementById('modal-apu-unit');
  if (filterSelect) {
    filterSelect.innerHTML = '<option value="">Todas las unidades</option>';
    apuUnitsList.forEach(u => {
      filterSelect.innerHTML += `<option value="${u.codigo}">${u.codigo} — ${u.nombre}</option>`;
    });
  }
  if (modalSelect) {
    modalSelect.innerHTML = '<option value="">Seleccione unidad de la actividad...</option>';
    apuUnitsList.forEach(u => {
      modalSelect.innerHTML += `<option value="${u.codigo}">${u.codigo} — ${u.nombre} (${u.categoria})</option>`;
    });
  }
}

function populateResourcePickerDropdown() {
  const select = document.getElementById('apu-resource-picker');
  if (!select) return;
  select.innerHTML = '<option value="">Buscar recurso por código o nombre...</option>';
  availableResourcesForApu.forEach(r => {
    // 6.5 Restricción: Los recursos de tipo 'Actividad a todo costo' se vinculan como cualquier recurso.
    // Un APU no contiene a otro APU.
    select.innerHTML += `
      <option value="${r.id}">[${r.codigo}] ${r.nombre} (${r.tipo} - $${formatMoney(r.precioTotal)} / ${r.unidad})</option>
    `;
  });
}

// ----------------------------------------------------------------------------
// 6.1 VISTA MAESTRA: TABLA Y FILTROS EN TIEMPO REAL
// ----------------------------------------------------------------------------

function renderApusTable() {
  const tbody = document.getElementById('apus-table-body');
  const countIndicator = document.getElementById('apus-count-indicator');
  if (!tbody) return;

  tbody.innerHTML = '';

  let filtered = allApus.filter(a => {
    if (activeApuSearch) {
      const matchSearch = a.nombre.toLowerCase().includes(activeApuSearch) ||
                          a.codigo.toLowerCase().includes(activeApuSearch);
      if (!matchSearch) return false;
    }
    if (selectedUnitFilter && a.unidad !== selectedUnitFilter) {
      return false;
    }
    return true;
  });

  if (countIndicator) {
    countIndicator.textContent = `${filtered.length} análisis unitario${filtered.length === 1 ? '' : 's'} registrado${filtered.length === 1 ? '' : 's'}`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:3rem; color:var(--text-muted);">
          No se encontraron APUs registrados que coincidan con la búsqueda.
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach(a => {
    const tr = document.createElement('tr');
    const statusBadge = a.activo
      ? `<span style="font-size:0.7rem; background:rgba(16,185,129,0.15); color:var(--status-success); padding:0.2rem 0.5rem; border-radius:4px; font-weight:600;">ACTIVO</span>`
      : `<span style="font-size:0.7rem; background:rgba(239,68,68,0.15); color:var(--status-danger); padding:0.2rem 0.5rem; border-radius:4px; font-weight:600;">INACTIVO</span>`;

    const budgetTag = a.numPresupuestos > 0
      ? `<small style="display:block; color:var(--terracota-light); font-size:0.72rem; margin-top:0.2rem;">En ${a.numPresupuestos} presupuesto(s)</small>`
      : '';

    tr.innerHTML = `
      <td><span class="res-code-badge" style="cursor:pointer;" onclick="openApuModal(${a.id}, 'view')">${a.codigo}</span></td>
      <td>
        <div style="font-weight:600; color:var(--text-primary); cursor:pointer;" onclick="openApuModal(${a.id}, 'view')">
          ${a.nombre}
        </div>
        ${budgetTag}
      </td>
      <td><span class="res-unit-badge">${a.unidad}</span></td>
      <td style="font-size:0.8rem; color:var(--text-secondary);">${a.numRecursos} insumo(s)</td>
      <td style="font-family:var(--font-mono); font-weight:700; color:#fff; font-size:0.95rem;">
        $${formatMoney(a.costoDirecto)} <small style="color:var(--text-muted); font-size:0.75rem;">/ ${a.unidad}</small>
      </td>
      <td>${statusBadge}</td>
      <td style="text-align:right;">
        <button class="res-action-btn" title="Consultar APU" onclick="openApuModal(${a.id}, 'view')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>
        <button class="res-action-btn" title="Editar APU" onclick="openApuModal(${a.id}, 'edit')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button class="res-action-btn delete" title="Eliminar APU" onclick="handleDeleteApu(${a.id})">
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

function setupApuEvents() {
  const searchInput = document.getElementById('global-apu-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      activeApuSearch = e.target.value.trim().toLowerCase();
      renderApusTable();
    });
  }

  const unitFilter = document.getElementById('filter-apu-unit');
  if (unitFilter) {
    unitFilter.addEventListener('change', (e) => {
      selectedUnitFilter = e.target.value.trim();
      renderApusTable();
    });
  }

  const btnCreateApu = document.getElementById('btn-create-apu-main');
  if (btnCreateApu) {
    btnCreateApu.addEventListener('click', () => {
      openApuModal(null, 'create');
    });
  }

  const btnBackApu = document.getElementById('btn-apu-back');
  if (btnBackApu) {
    btnBackApu.addEventListener('click', () => {
      document.querySelector('.menu-item-btn[data-target="inicio"]')?.click();
    });
  }

  // Evento agregar recurso al APU
  const btnAddResource = document.getElementById('btn-add-resource-to-apu');
  if (btnAddResource) {
    btnAddResource.addEventListener('click', addSelectedResourceToApu);
  }

  // Acceso directo: Crear recurso al vuelo (6.2)
  const btnCreateResourceOnTheFly = document.getElementById('btn-create-resource-on-the-fly');
  if (btnCreateResourceOnTheFly) {
    btnCreateResourceOnTheFly.addEventListener('click', () => {
      // Abre el popout de recursos sin perder el estado del APU actual
      if (typeof openResourcePopout === 'function') {
        openResourcePopout(null, 'Materiales');
        // Sobrescribir temporalmente el callback para auto-asignar el recurso nuevo al APU
        window.onNewResourceCreatedCallback = (newResource) => {
          availableResourcesForApu.push(newResource);
          populateResourcePickerDropdown();
          addResourceLineToApu(newResource);
        };
      }
    });
  }

  const apuForm = document.getElementById('apu-popout-form');
  if (apuForm) {
    apuForm.addEventListener('submit', handleSaveApuSubmit);
  }
}

// ----------------------------------------------------------------------------
// 6.2 CREAR UN APU & 6.3 CONSULTAR Y EDITAR
// ----------------------------------------------------------------------------

async function openApuModal(apuId = null, mode = 'create') {
  apuModalMode = mode;
  currentEditingApu = null;
  currentApuLines = [];

  const modal = document.getElementById('apu-popout-modal');
  const title = document.getElementById('apu-modal-title');
  const subtitle = document.getElementById('apu-modal-subtitle');
  const codeField = document.getElementById('modal-apu-code');
  const nameInput = document.getElementById('modal-apu-name');
  const unitSelect = document.getElementById('modal-apu-unit');
  const editModeBtn = document.getElementById('btn-apu-switch-to-edit');
  const saveBtn = document.getElementById('btn-apu-save-submit');
  const resourcePickerBox = document.getElementById('apu-resource-picker-box');
  const alertBox = document.getElementById('modal-apu-alert');

  if (alertBox) alertBox.style.display = 'none';

  if (apuId) {
    // Cargar datos completos del APU
    try {
      const res = await fetch(`/api/apus/${apuId}`);
      const data = await res.json();
      if (data.success && data.apu) {
        currentEditingApu = data.apu;
        codeField.value = data.apu.codigo;
        nameInput.value = data.apu.nombre;
        unitSelect.value = data.apu.unidad;
        currentApuLines = (data.apu.lines || []).map(l => ({
          resourceId: l.resourceId,
          codigo: l.codigo,
          nombre: l.nombre,
          tipo: l.tipo,
          unidad: l.unidad,
          precioTotal: l.precioTotal,
          cantidad: l.cantidad,
          rendimiento: l.rendimiento,
          desperdicio: l.desperdicio,
          subtotal: l.subtotal
        }));
      }
    } catch (e) {
      console.error(e);
    }
  } else {
    // Modo Creación
    codeField.value = 'Generado automáticamente por servidor';
    nameInput.value = '';
    unitSelect.value = '';
  }

  applyApuModalMode();
  renderApuLinesTable();
  modal.style.display = 'flex';
}

function applyApuModalMode() {
  const title = document.getElementById('apu-modal-title');
  const subtitle = document.getElementById('apu-modal-subtitle');
  const nameInput = document.getElementById('modal-apu-name');
  const unitSelect = document.getElementById('modal-apu-unit');
  const editModeBtn = document.getElementById('btn-apu-switch-to-edit');
  const saveBtn = document.getElementById('btn-apu-save-submit');
  const resourcePickerBox = document.getElementById('apu-resource-picker-box');

  if (apuModalMode === 'view') {
    // 6.3 Consulta: Solo lectura
    title.textContent = `Consulta de APU [${currentEditingApu?.codigo || ''}]`;
    subtitle.textContent = 'Estructura técnica y desglose unitario en solo lectura';
    nameInput.disabled = true;
    unitSelect.disabled = true;
    resourcePickerBox.style.display = 'none';
    editModeBtn.style.display = 'inline-flex';
    saveBtn.style.display = 'none';
  } else if (apuModalMode === 'edit') {
    // 6.3 Edición
    title.textContent = `Editar APU [${currentEditingApu?.codigo || ''}]`;
    subtitle.textContent = 'Modifique la actividad o los consumos de insumos y cuadrillas';
    nameInput.disabled = false;
    unitSelect.disabled = false;
    resourcePickerBox.style.display = 'block';
    editModeBtn.style.display = 'none';
    saveBtn.style.display = 'inline-flex';
    saveBtn.textContent = 'Guardar Cambios en APU';
  } else {
    // 6.2 Creación
    title.textContent = 'Crear Nuevo APU';
    subtitle.textContent = 'Defina la receta matemática de rendimientos e insumos por unidad de obra';
    nameInput.disabled = false;
    unitSelect.disabled = false;
    resourcePickerBox.style.display = 'block';
    editModeBtn.style.display = 'none';
    saveBtn.style.display = 'inline-flex';
    saveBtn.textContent = 'Crear APU';
  }
}

// Transformar ventana de consulta a modo edición
function switchToApuEditMode() {
  apuModalMode = 'edit';
  applyApuModalMode();
  renderApuLinesTable();
}

function closeApuModal() {
  const modal = document.getElementById('apu-popout-modal');
  if (modal) modal.style.display = 'none';
  currentEditingApu = null;
  currentApuLines = [];
}

// Agregar recurso seleccionado a la tabla de composición
function addSelectedResourceToApu() {
  const select = document.getElementById('apu-resource-picker');
  const resourceId = parseInt(select.value);
  if (!resourceId) return;

  const resource = availableResourcesForApu.find(r => r.id === resourceId);
  if (!resource) return;

  addResourceLineToApu(resource);
  select.value = '';
}

function addResourceLineToApu(resource) {
  // Evitar duplicados exactos o sumar
  const exists = currentApuLines.find(l => l.resourceId === resource.id);
  if (exists) {
    alert(`El recurso [${resource.codigo}] ya está incluido en la receta del APU.`);
    return;
  }

  // 6.2 Valores precargados por defecto en 1 (ninguno admite cero)
  const isMaterial = resource.tipo === 'Materiales';
  const cantidad = 1.0;
  const rendimiento = 1.0;
  const desperdicio = isMaterial ? 5.0 : 0.0; // 5% sugerido en material, 0 en otros

  // Fórmula: Cantidad * Rendimiento * (1 + Desp/100) * Precio Total
  const subtotal = Math.round(cantidad * rendimiento * (1 + desperdicio / 100.0) * resource.precioTotal);

  currentApuLines.push({
    resourceId: resource.id,
    codigo: resource.codigo,
    nombre: resource.nombre,
    tipo: resource.tipo,
    unidad: resource.unidad,
    precioTotal: resource.precioTotal,
    cantidad,
    rendimiento,
    desperdicio,
    subtotal
  });

  renderApuLinesTable();
}

function removeApuLine(index) {
  if (apuModalMode === 'view') return;
  currentApuLines.splice(index, 1);
  renderApuLinesTable();
}

// Recalcular subtotal de línea en tiempo real
function updateApuLineValue(index, field, value) {
  const line = currentApuLines[index];
  if (!line) return;

  let numVal = parseFloat(value);
  if (isNaN(numVal) || numVal < 0) numVal = 1;

  // 6.2 Regla: Cantidad y Rendimiento no admiten cero
  if ((field === 'cantidad' || field === 'rendimiento') && numVal <= 0) {
    numVal = 1;
  }

  line[field] = numVal;

  // Recalcular subtotal con la fórmula oficial
  const desp = line.tipo === 'Materiales' ? (line.desperdicio || 0) : 0;
  line.subtotal = Math.round(line.cantidad * line.rendimiento * (1 + desp / 100.0) * line.precioTotal);

  renderApuLinesTable();
}

// Renderizar tabla de composición de recursos del APU
function renderApuLinesTable() {
  const tbody = document.getElementById('apu-composition-tbody');
  const totalDisplay = document.getElementById('apu-direct-cost-total');
  const unitDisplay = document.getElementById('apu-unit-display-badge');
  const unitInput = document.getElementById('modal-apu-unit');

  if (!tbody) return;
  tbody.innerHTML = '';

  const selectedUnit = unitInput?.value || 'unidad';
  if (unitDisplay) unitDisplay.textContent = `/ ${selectedUnit}`;

  let totalCostoDirecto = 0;

  if (currentApuLines.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:2rem; color:var(--text-muted); font-size:0.84rem;">
          No hay recursos agregados a la composición. Busque y agregue materiales, cuadrillas o equipos arriba.
        </td>
      </tr>
    `;
  } else {
    currentApuLines.forEach((line, index) => {
      totalCostoDirecto += line.subtotal;
      const isMaterial = line.tipo === 'Materiales';
      const isReadOnly = apuModalMode === 'view';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div style="font-weight:600; color:var(--text-primary);">[${line.codigo}] ${line.nombre}</div>
          <small style="color:var(--text-muted); font-size:0.75rem;">${line.tipo} • $${formatMoney(line.precioTotal)} / ${line.unidad}</small>
        </td>

        <!-- Columna Cantidad (Cuántas a la vez) -->
        <td style="width:110px;">
          ${isReadOnly 
            ? `<span style="font-family:var(--font-mono);">${line.cantidad}</span>`
            : `<input type="number" class="filter-input" style="width:90px;" min="0.001" step="any" value="${line.cantidad}" onchange="updateApuLineValue(${index}, 'cantidad', this.value)">`
          }
        </td>

        <!-- Columna Rendimiento (Consumo por unidad de obra) -->
        <td style="width:120px;">
          ${isReadOnly 
            ? `<span style="font-family:var(--font-mono);">${line.rendimiento}</span>`
            : `<input type="number" class="filter-input" style="width:90px;" min="0.0001" step="any" value="${line.rendimiento}" onchange="updateApuLineValue(${index}, 'rendimiento', this.value)">`
          }
        </td>

        <!-- Columna Desperdicio % (Solo Materiales) -->
        <td style="width:100px;">
          ${!isMaterial 
            ? `<span style="color:var(--text-muted); font-size:0.85rem;">—</span>`
            : (isReadOnly 
                ? `<span style="font-family:var(--font-mono);">${line.desperdicio}%</span>`
                : `<div style="display:flex; align-items:center; gap:0.2rem;"><input type="number" class="filter-input" style="width:65px;" min="0" max="100" step="any" value="${line.desperdicio}" onchange="updateApuLineValue(${index}, 'desperdicio', this.value)"><span style="font-size:0.75rem; color:var(--text-muted);">%</span></div>`
              )
          }
        </td>

        <!-- Subtotal Calculado -->
        <td style="font-family:var(--font-mono); font-weight:700; color:#fff; width:130px;">
          $${formatMoney(line.subtotal)}
        </td>

        <!-- Quitar línea -->
        <td style="width:50px; text-align:right;">
          ${isReadOnly 
            ? '' 
            : `<button type="button" class="res-action-btn delete" onclick="removeApuLine(${index})" title="Quitar recurso de la receta">✕</button>`
          }
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  if (totalDisplay) {
    totalDisplay.textContent = `$${formatMoney(totalCostoDirecto)}`;
  }
}

// ----------------------------------------------------------------------------
// 6.4 GUARDAR APU & CONTROL DE CAMBIOS EN PRESUPUESTOS ABIERTOS (Regla D-22)
// ----------------------------------------------------------------------------

async function handleSaveApuSubmit(e) {
  e.preventDefault();
  const alertBox = document.getElementById('modal-apu-alert');
  const nameInput = document.getElementById('modal-apu-name');
  const unitSelect = document.getElementById('modal-apu-unit');

  const nombre = nameInput.value.trim();
  const unidad = unitSelect.value.trim();

  if (!nombre) {
    showApuAlert('El nombre de la actividad APU es obligatorio.');
    return;
  }
  if (!unidad) {
    showApuAlert('Debe seleccionar la unidad de medida de la actividad.');
    return;
  }
  if (currentApuLines.length === 0) {
    showApuAlert('Debe agregar al menos un recurso a la composición del APU.');
    return;
  }

  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  const companyId = user.company ? user.company.id : 1;

  const payload = {
    companyId,
    nombre,
    unidad,
    lines: currentApuLines
  };

  // 6.4 Si estamos editando y el APU está vinculado a presupuestos abiertos:
  if (currentEditingApu && currentEditingApu.presupuestosAbiertos && currentEditingApu.presupuestosAbiertos.length > 0) {
    openApuBudgetImpactDialog(payload, currentEditingApu.presupuestosAbiertos);
    return;
  }

  await executeSaveApu(payload, false);
}

async function executeSaveApu(payload, actualizarPresupuestosAbiertos = false) {
  payload.actualizarPresupuestosAbiertos = actualizarPresupuestosAbiertos;

  try {
    const isEdit = currentEditingApu !== null;
    const url = isEdit ? `/api/apus/${currentEditingApu.id}` : '/api/apus';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      closeApuModal();
      closeApuBudgetImpactDialog();
      await loadApusData();
      if (typeof window.onApuCreatedCallback === 'function' && data.apu) {
        window.onApuCreatedCallback(data.apu);
      }
    } else {
      showApuAlert(data.message || 'Error al guardar el APU.');
    }
  } catch (err) {
    showApuAlert('Error de comunicación con el servidor.');
  }
}

function showApuAlert(msg) {
  const alertBox = document.getElementById('modal-apu-alert');
  if (alertBox) {
    alertBox.textContent = msg;
    alertBox.style.display = 'block';
  }
}

// Diálogo de Control de Cambios en Presupuestos Abiertos (6.4)
function openApuBudgetImpactDialog(payload, openBudgets) {
  pendingApuSaveData = payload;
  const dialog = document.getElementById('apu-budget-change-dialog');
  const descEl = document.getElementById('apu-budget-change-desc');
  const listEl = document.getElementById('apu-budget-change-list');

  if (descEl && currentEditingApu) {
    descEl.innerHTML = `
      El análisis unitario <strong>[${currentEditingApu.codigo}] ${currentEditingApu.nombre}</strong> está en uso en 
      <strong>${openBudgets.length}</strong> presupuesto(s) abierto(s).
      <br><br>
      ¿Desea actualizar su valor y recalcular los totales en dichos presupuestos?
    `;
  }

  if (listEl) {
    listEl.innerHTML = openBudgets.map(b => `<li>[${b.codigo}] ${b.nombre} (Abierto)</li>`).join('');
  }

  if (dialog) dialog.style.display = 'flex';
}

function closeApuBudgetImpactDialog() {
  const dialog = document.getElementById('apu-budget-change-dialog');
  if (dialog) dialog.style.display = 'none';
  pendingApuSaveData = null;
}

function confirmApuBudgetChange(actualizar) {
  if (pendingApuSaveData) {
    executeSaveApu(pendingApuSaveData, actualizar);
  }
}

// ----------------------------------------------------------------------------
// 6.5 RESTRICCIONES Y ELIMINACIÓN DE APU (Bloqueo y opción de inactivar)
// ----------------------------------------------------------------------------

async function handleDeleteApu(apuId) {
  const apu = allApus.find(a => a.id === apuId);
  if (!apu) return;

  try {
    const res = await fetch(`/api/apus/${apuId}`, { method: 'DELETE' });
    const data = await res.json();

    if (data.success) {
      await loadApusData();
    } else if (data.bloqueado) {
      // 6.5 Bloqueo: El mensaje dice en cuántas actividades y ofrece marcarlo como inactivo
      openApuDeleteBlockedDialog(apu, data.presupuestos || []);
    } else {
      alert(data.message || 'Error al eliminar el APU.');
    }
  } catch (e) {
    alert('Error de conexión al intentar eliminar el APU.');
  }
}

function openApuDeleteBlockedDialog(apu, budgetList) {
  const dialog = document.getElementById('apu-delete-blocked-dialog');
  const descEl = document.getElementById('apu-delete-blocked-desc');
  const listEl = document.getElementById('apu-delete-blocked-list');
  const btnInactivate = document.getElementById('btn-apu-inactivate-option');

  if (descEl) {
    descEl.innerHTML = `
      El APU <strong>[${apu.codigo}] ${apu.nombre}</strong> no se puede eliminar porque está vinculado a actividades en los siguientes presupuestos de obra:
    `;
  }

  if (listEl) {
    listEl.innerHTML = budgetList.map(b => `<li>${b}</li>`).join('');
  }

  if (btnInactivate) {
    btnInactivate.onclick = async () => {
      await toggleApuActiveStatus(apu.id);
      closeApuDeleteBlockedDialog();
    };
  }

  if (dialog) dialog.style.display = 'flex';
}

function closeApuDeleteBlockedDialog() {
  const dialog = document.getElementById('apu-delete-blocked-dialog');
  if (dialog) dialog.style.display = 'none';
}

async function toggleApuActiveStatus(apuId) {
  try {
    const res = await fetch(`/api/apus/${apuId}/toggle-active`, { method: 'PUT' });
    const data = await res.json();
    if (data.success) {
      await loadApusData();
    }
  } catch (e) {
    console.error(e);
  }
}

// Exponer funciones globales
window.openApuModal = openApuModal;
window.closeApuModal = closeApuModal;
window.switchToApuEditMode = switchToApuEditMode;
window.handleDeleteApu = handleDeleteApu;
window.closeApuBudgetImpactDialog = closeApuBudgetImpactDialog;
window.confirmApuBudgetChange = confirmApuBudgetChange;
window.closeApuDeleteBlockedDialog = closeApuDeleteBlockedDialog;
window.toggleApuActiveStatus = toggleApuActiveStatus;
window.updateApuLineValue = updateApuLineValue;
window.removeApuLine = removeApuLine;
