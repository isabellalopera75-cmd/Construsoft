/**
 * ConstruSoft - Módulos 7 y 8: Presupuestos de Obra y Mesa de Trabajo WBS
 * Pure Vanilla JavaScript: Sin frameworks externos.
 */

// Estado global del módulo de presupuestos
let currentBudgetDetail = null;
let currentCompanyId = 1;
let allCompanyApus = [];
let pendingApuTargetChapterId = null;

// Formateador de moneda (COP)
function formatCurrency(val) {
  const num = parseFloat(val) || 0;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

// Formateador seguro de incidencia (%)
function formatIncidencia(monto, costoDirectoTotal) {
  if (!costoDirectoTotal || costoDirectoTotal <= 0 || isNaN(costoDirectoTotal) || !isFinite(costoDirectoTotal)) {
    return '—';
  }
  const inc = (parseFloat(monto) / parseFloat(costoDirectoTotal)) * 100.0;
  if (isNaN(inc) || !isFinite(inc)) return '—';
  return inc.toFixed(2) + ' %';
}

function getStoredUser() {
  try {
    const raw = localStorage.getItem('contrusoft_current_user');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

// ============================================================================
// 7. VISTA MAESTRA DE PRESUPUESTOS
// ============================================================================

function initPresupuestosModule() {
  const user = getStoredUser();
  if (user && user.companyId) {
    currentCompanyId = user.companyId;
  } else if (user && user.company && user.company.id) {
    currentCompanyId = user.company.id;
  } else {
    currentCompanyId = 1;
  }

  // Asegurar que la vista maestra esté visible y la mesa oculta
  const masterView = document.getElementById('presupuestos-master-view');
  const workspaceView = document.getElementById('presupuestos-workspace-view');
  if (masterView) masterView.style.display = 'block';
  if (workspaceView) workspaceView.style.display = 'none';

  loadBudgetsMasterList();
  loadCompanyApusCatalog();
  setupPresupuestosMasterEvents();
}

async function loadCompanyApusCatalog() {
  try {
    const res = await fetch(`/api/apus?company_id=${currentCompanyId}`);
    const data = await res.json();
    if (data && data.apus) {
      allCompanyApus = data.apus;
    }
  } catch (e) {
    console.error('Error cargando catálogo de APUs:', e);
  }
}

async function loadBudgetsMasterList() {
  const countIndicator = document.getElementById('presupuestos-count-indicator');
  const tbody = document.getElementById('presupuestos-table-body');
  if (countIndicator) countIndicator.textContent = 'Cargando presupuestos...';

  try {
    const res = await fetch(`/api/budgets?company_id=${currentCompanyId}`);
    const data = await res.json();

    if (!data.success || !data.budgets) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:2rem; color:var(--text-muted);">No se pudieron cargar los presupuestos.</td></tr>`;
      return;
    }

    renderBudgetsTable(data.budgets);
  } catch (err) {
    console.error('Error cargando lista de presupuestos:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:2rem; color:var(--status-danger);">Error de conexión al cargar presupuestos.</td></tr>`;
  }
}

let cachedBudgetsList = [];

function renderBudgetsTable(budgets) {
  cachedBudgetsList = budgets || [];
  applyBudgetsFilters();
}

function applyBudgetsFilters() {
  const searchField = document.getElementById('search-presupuestos-input');
  const statusFilter = document.getElementById('filter-presupuestos-status');
  const tbody = document.getElementById('presupuestos-table-body');
  const countIndicator = document.getElementById('presupuestos-count-indicator');
  if (!tbody) return;

  const query = (searchField ? searchField.value : '').trim().toLowerCase();
  const selectedStatus = (statusFilter ? statusFilter.value : '').trim();

  const filtered = cachedBudgetsList.filter(b => {
    const matchQuery = !query ||
      (b.codigo && b.codigo.toLowerCase().includes(query)) ||
      (b.nombre && b.nombre.toLowerCase().includes(query)) ||
      (b.ubicacion && b.ubicacion.toLowerCase().includes(query));

    const matchStatus = !selectedStatus || b.estado === selectedStatus;
    return matchQuery && matchStatus;
  });

  if (countIndicator) {
    countIndicator.textContent = `${filtered.length} proyecto(s) encontrado(s)`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding:3rem 1rem; color:var(--text-muted);">
          No se encontraron proyectos con los criterios de búsqueda seleccionados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(b => {
    let badgeClass = 'status-badge-abierto';
    if (b.estado === 'Activo') badgeClass = 'status-badge-activo';
    else if (b.estado === 'Cerrado') badgeClass = 'status-badge-cerrado';

    const fechaElab = b.fechaElaboracion ? b.fechaElaboracion.substring(0, 16) : '—';
    const fechaMod = b.fechaUltimaModificacion ? b.fechaUltimaModificacion.substring(0, 16) : '—';

    const canDelete = b.estado === 'Abierto';

    return `
      <tr>
        <td>
          <span style="font-family:var(--font-mono); font-weight:700; color:var(--terracota-light); font-size:0.84rem;">
            ${b.codigo}
          </span>
        </td>
        <td>
          <div style="font-weight:600; color:var(--text-primary);">${escapeHtml(b.nombre)}</div>
        </td>
        <td>${escapeHtml(b.ubicacion || '—')}</td>
        <td><span style="font-family:var(--font-mono); font-size:0.8rem;">${b.moneda || 'COP'}</span></td>
        <td style="font-family:var(--font-mono); font-size:0.78rem; color:var(--text-muted);">${fechaElab}</td>
        <td style="font-family:var(--font-mono); font-size:0.78rem; color:var(--text-muted);">${fechaMod}</td>
        <td>
          <span class="status-badge ${badgeClass}">${b.estado}</span>
        </td>
        <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--text-primary);">
          ${formatCurrency(b.valorTotal)}
        </td>
        <td style="text-align:right; white-space:nowrap;">
          <button type="button" onclick="openBudgetWorkspace(${b.id})" class="btn-terracota" style="padding:0.35rem 0.75rem; font-size:0.75rem; width:auto; display:inline-flex;">
            Abrir
          </button>
          ${canDelete ? `
            <button type="button" onclick="deleteBudgetMaster(${b.id}, '${escapeHtml(b.codigo)}')" class="btn-icon-control danger" title="Eliminar Presupuesto" style="margin-left:0.35rem;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

function setupPresupuestosMasterEvents() {
  const searchField = document.getElementById('search-presupuestos-input');
  if (searchField && !searchField._hasEvent) {
    searchField.addEventListener('input', applyBudgetsFilters);
    searchField._hasEvent = true;
  }

  const statusFilter = document.getElementById('filter-presupuestos-status');
  if (statusFilter && !statusFilter._hasEvent) {
    statusFilter.addEventListener('change', applyBudgetsFilters);
    statusFilter._hasEvent = true;
  }

  const btnCreate = document.getElementById('btn-create-presupuesto-main');
  if (btnCreate && !btnCreate._hasEvent) {
    btnCreate.addEventListener('click', openCreatePresupuestoModal);
    btnCreate._hasEvent = true;
  }

  const btnWsBack = document.getElementById('btn-ws-back-master');
  if (btnWsBack && !btnWsBack._hasEvent) {
    btnWsBack.addEventListener('click', () => {
      document.getElementById('presupuestos-master-view').style.display = 'block';
      document.getElementById('presupuestos-workspace-view').style.display = 'none';
      loadBudgetsMasterList();
    });
    btnWsBack._hasEvent = true;
  }

  // Setup form de creación
  const formCreate = document.getElementById('presupuesto-create-form');
  if (formCreate && !formCreate._hasEvent) {
    formCreate.addEventListener('submit', handleCreateBudgetSubmit);
    formCreate._hasEvent = true;
  }

  // Validación de código en tiempo real
  const inputCodigo = document.getElementById('pres-new-codigo');
  if (inputCodigo && !inputCodigo._hasEvent) {
    let debounceTimer;
    inputCodigo.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const statusSpan = document.getElementById('pres-codigo-status');
      const val = inputCodigo.value.trim();
      if (!val) {
        if (statusSpan) statusSpan.textContent = '';
        return;
      }
      debounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/budgets/check-code?company_id=${currentCompanyId}&codigo=${encodeURIComponent(val)}`);
          const data = await res.json();
          if (statusSpan) {
            if (data.available) {
              statusSpan.textContent = '✓ Disponible';
              statusSpan.style.color = 'var(--status-success)';
            } else {
              statusSpan.textContent = '✕ Ya existe';
              statusSpan.style.color = 'var(--status-danger)';
            }
          }
        } catch (e) {}
      }, 300);
    });
    inputCodigo._hasEvent = true;
  }

  // Form agregar capítulo principal
  const formChapter = document.getElementById('chapter-create-form');
  if (formChapter && !formChapter._hasEvent) {
    formChapter.addEventListener('submit', handleCreateChapterSubmit);
    formChapter._hasEvent = true;
  }

  // Form agregar subcapítulo
  const formSub = document.getElementById('subchapter-create-form');
  if (formSub && !formSub._hasEvent) {
    formSub.addEventListener('submit', handleCreateSubchapterSubmit);
    formSub._hasEvent = true;
  }

  // Form renombrar capítulo
  const formRename = document.getElementById('chapter-rename-form');
  if (formRename && !formRename._hasEvent) {
    formRename.addEventListener('submit', handleRenameChapterSubmit);
    formRename._hasEvent = true;
  }

  // Botón agregar capítulo principal en la mesa de trabajo
  const btnAddRoot = document.getElementById('btn-ws-add-root-chapter');
  if (btnAddRoot && !btnAddRoot._hasEvent) {
    btnAddRoot.addEventListener('click', openCreateChapterModal);
    btnAddRoot._hasEvent = true;
  }
}

// ============================================================================
// 7.1 MODAL DE CREACIÓN DE PRESUPUESTO
// ============================================================================

function openCreatePresupuestoModal() {
  const modal = document.getElementById('presupuesto-create-popout-modal');
  const alertBox = document.getElementById('modal-presupuesto-alert');
  const statusSpan = document.getElementById('pres-codigo-status');
  if (alertBox) alertBox.style.display = 'none';
  if (statusSpan) statusSpan.textContent = '';

  const form = document.getElementById('presupuesto-create-form');
  if (form) form.reset();

  // Pre-generar un código sugerido
  const year = new Date().getFullYear();
  const nextNum = (cachedBudgetsList.length + 1).toString().padStart(3, '0');
  const inputCodigo = document.getElementById('pres-new-codigo');
  if (inputCodigo) inputCodigo.value = `PRE-${year}-${nextNum}`;

  if (modal) modal.style.display = 'flex';
}

function closeCreatePresupuestoModal() {
  const modal = document.getElementById('presupuesto-create-popout-modal');
  if (modal) modal.style.display = 'none';
}

async function handleCreateBudgetSubmit(e) {
  e.preventDefault();
  const alertBox = document.getElementById('modal-presupuesto-alert');
  if (alertBox) alertBox.style.display = 'none';

  const codigo = document.getElementById('pres-new-codigo').value.trim();
  const nombre = document.getElementById('pres-new-nombre').value.trim();
  const ubicacion = document.getElementById('pres-new-ubicacion').value.trim();
  const moneda = 'COP';

  if (!codigo || !nombre || !ubicacion) {
    if (alertBox) {
      alertBox.textContent = 'Por favor complete todos los campos obligatorios (*).';
      alertBox.style.display = 'block';
    }
    return;
  }

  const submitBtn = document.getElementById('btn-submit-presupuesto');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Iniciando...';
  }

  try {
    const res = await fetch('/api/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: currentCompanyId,
        codigo,
        nombre,
        ubicacion,
        moneda
      })
    });

    const data = await res.json();
    if (!data.success) {
      if (alertBox) {
        alertBox.textContent = data.message || 'Error al crear el presupuesto.';
        alertBox.style.display = 'block';
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Iniciar Presupuesto';
      }
      return;
    }

    closeCreatePresupuestoModal();
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Iniciar Presupuesto';
    }

    // Redirige de inmediato a la mesa de trabajo (7.1)
    const newBudget = data.data.budget;
    openBudgetWorkspace(newBudget.id);

  } catch (err) {
    console.error('Error al registrar presupuesto:', err);
    if (alertBox) {
      alertBox.textContent = 'Error de conexión con el servidor al registrar el proyecto.';
      alertBox.style.display = 'block';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Iniciar Presupuesto';
    }
  }
}

async function deleteBudgetMaster(budgetId, codigo) {
  if (!confirm(`¿Está seguro de que desea eliminar el presupuesto '${codigo}'?\nEsta acción no se puede deshacer.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/budgets/${budgetId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || 'No se pudo eliminar el presupuesto.');
      return;
    }
    loadBudgetsMasterList();
  } catch (e) {
    alert('Error al intentar eliminar el proyecto.');
  }
}

// ============================================================================
// 8. MESA DE TRABAJO (LIENZO ÚNICO SIN RECARGAS)
// ============================================================================

async function openBudgetWorkspace(budgetId) {
  // Cambiar vistas sin recargar la página
  document.getElementById('presupuestos-master-view').style.display = 'none';
  const workspaceView = document.getElementById('presupuestos-workspace-view');
  workspaceView.style.display = 'block';

  // Cargar datos detallados del presupuesto
  await reloadBudgetWorkspace(budgetId);
}

async function reloadBudgetWorkspace(budgetId) {
  try {
    const res = await fetch(`/api/budgets/${budgetId}`);
    const data = await res.json();
    if (!data.success || !data.data) {
      alert('Error cargando la mesa de trabajo del presupuesto.');
      return;
    }

    currentBudgetDetail = data.data;
    renderWorkspaceUI(currentBudgetDetail);
  } catch (err) {
    console.error('Error al cargar la mesa de trabajo:', err);
  }
}

function renderWorkspaceUI(detail) {
  const budget = detail.budget;
  const chapters = detail.capitulos;
  const resumen = detail.resumen;

  // 8.1 Encabezado Estático
  document.getElementById('ws-head-code').textContent = budget.codigo;
  document.getElementById('ws-head-name').textContent = budget.nombre;
  document.getElementById('ws-head-ubicacion').textContent = budget.ubicacion || '—';
  document.getElementById('ws-head-moneda').textContent = budget.moneda || 'COP';
  document.getElementById('ws-head-updated').textContent = budget.fechaUltimaModificacion || '—';

  // Badge de Estado
  const badgeEl = document.getElementById('ws-head-status-badge');
  badgeEl.className = 'status-badge';
  if (budget.estado === 'Activo') {
    badgeEl.classList.add('status-badge-activo');
  } else if (budget.estado === 'Cerrado') {
    badgeEl.classList.add('status-badge-cerrado');
  } else {
    badgeEl.classList.add('status-badge-abierto');
  }
  badgeEl.textContent = budget.estado;

  // Control de cambio de estado
  const statusBox = document.getElementById('ws-status-control-box');
  statusBox.innerHTML = renderStatusControl(budget, resumen);

  // Quick direct cost display
  document.getElementById('ws-quick-direct-cost').textContent = formatCurrency(resumen.costoDirecto);

  // Control de habilitación del botón "+ Agregar Capítulo"
  const btnAddRoot = document.getElementById('btn-ws-add-root-chapter');
  if (btnAddRoot) {
    btnAddRoot.style.display = (budget.estado === 'Abierto') ? 'inline-flex' : 'none';
  }

  // 8.2 & 8.5 Renderizar Árbol de Capítulos (Vista Tabla Compacta)
  const chaptersContainer = document.getElementById('ws-chapters-tree-container');
  if (chapters.length === 0) {
    chaptersContainer.innerHTML = buildEmptyBudgetPlaceholder(budget);
  } else {
    chaptersContainer.innerHTML = renderWbsTable(chapters, budget, resumen.costoDirecto);
  }

  // 8.6 Renderizar Pie Financiero
  const pieContainer = document.getElementById('ws-financial-pie-container');
  pieContainer.innerHTML = renderFinancialPie(budget, resumen);
}

function renderStatusControl(budget, resumen) {
  const isAbierto = budget.estado === 'Abierto';
  const isActivo = budget.estado === 'Activo';
  const isCerrado = budget.estado === 'Cerrado';

  if (isAbierto) {
    return `
      <button type="button" onclick="triggerActivateBudget(${budget.id})" class="btn-outline" style="font-size:0.78rem; padding:0.4rem 0.85rem; border-color:var(--status-success); color:var(--status-success);">
        Activar Presupuesto (Congelar)
      </button>
    `;
  } else if (isActivo) {
    return `
      <div style="display:flex; gap:0.4rem;">
        <button type="button" onclick="changeBudgetStatus(${budget.id}, 'Abierto')" class="btn-outline" style="font-size:0.75rem; padding:0.35rem 0.75rem;">
          Reabrir Edición
        </button>
        <button type="button" onclick="changeBudgetStatus(${budget.id}, 'Cerrado')" class="btn-outline" style="font-size:0.75rem; padding:0.35rem 0.75rem; border-color:#9ca3af; color:#9ca3af;">
          Cerrar Obra
        </button>
      </div>
    `;
  } else {
    return `
      <button type="button" onclick="changeBudgetStatus(${budget.id}, 'Activo')" class="btn-outline" style="font-size:0.75rem; padding:0.35rem 0.75rem;">
        Reactivar Proyecto
      </button>
    `;
  }
}

// ============================================================================
// VISTA TABLA PLANA WBS — placeholder vacío
// ============================================================================
function buildEmptyBudgetPlaceholder(budget) {
  return '<div style="background:var(--bg-card); border:1px dashed var(--border-subtle); border-radius:var(--radius-md); padding:3rem 1.5rem; text-align:center; color:var(--text-muted); margin-bottom:1.5rem;">'
    + '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:0.75rem; opacity:0.6;">'
    + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>'
    + '<line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>'
    + '<h4 style="color:var(--text-primary); margin-bottom:0.4rem;">Presupuesto sin cap\u00edtulos</h4>'
    + '<p style="font-size:0.84rem; max-width:480px; margin:0 auto 1.25rem auto;">'
    + 'Comience agregando su primer cap\u00edtulo (ej. Cimentaci\u00f3n, Mampostería o Preliminares).'
    + '</p>'
    + (budget.estado === 'Abierto'
      ? '<button type="button" onclick="openCreateChapterModal()" class="btn-terracota" style="width:auto; padding:0.6rem 1.25rem;">+ Agregar Primer Cap\u00edtulo</button>'
      : '')
    + '</div>';
}

// ============================================================================
// VISTA TABLA PLANA WBS — renderWbsTable + collectWbsRows
// ============================================================================

function renderWbsTable(chapters, budget, totalDirectCost) {
  const isAbierto = budget.estado === 'Abierto';
  const rows = [];
  chapters.forEach(function(ch) { collectWbsRows(ch, budget, totalDirectCost, rows, 0); });

  return '<div class="wbs-table-wrapper">'
    + '<table class="wbs-flat-table">'
    + '<colgroup>'
    + '<col style="width:90px"><col><col style="width:72px"><col style="width:100px">'
    + '<col style="width:130px"><col style="width:140px">'
    + '<col style="width:' + (isAbierto ? '120px' : '0') + '">'
    + '</colgroup>'
    + '<thead><tr class="wbs-thead-row">'
    + '<th>C\u00d3D.</th><th>DESCRIPCI\u00d3N</th>'
    + '<th style="text-align:center;">UNID.</th>'
    + '<th style="text-align:right;">CANT. / %</th>'
    + '<th style="text-align:right;">P. UNITARIO</th>'
    + '<th style="text-align:right;">VALOR</th>'
    + '<th style="text-align:center;">' + (isAbierto ? 'ACCIONES' : '') + '</th>'
    + '</tr></thead>'
    + '<tbody>' + rows.join('') + '</tbody>'
    + '</table></div>';
}

function collectWbsRows(ch, budget, totalDirectCost, rows, depth) {
  var isAbierto = budget.estado === 'Abierto';
  var isDirecto = ch.tipo === 'Directo';
  var incidenciaStr = formatIncidencia(ch.montoAcumulado, totalDirectCost);
  var chNodeId = 'wbs-ch-' + ch.id;
  var indentPx = depth * 22;

  // Nature badge
  var canToggleNature = (ch.parentId === null && isAbierto);
  var natureBadge = '';
  if (depth === 0) {
    var nbClass = 'wbs-nature-badge ' + (isDirecto ? 'wbs-nature-directo' : 'wbs-nature-indirecto');
    if (canToggleNature) {
      natureBadge = '<span class="' + nbClass + '" onclick="toggleChapterNature(' + ch.id + ',\'' + ch.tipo + '\')" style="cursor:pointer;" title="Clic para alternar">'
        + ch.tipo + ' \u21c4</span>';
    } else {
      natureBadge = '<span class="' + nbClass + '">' + ch.tipo + '</span>';
    }
  }

  // Title
  var escapedTitle = escapeHtml(ch.titulo);
  var editIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.4;flex-shrink:0;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';
  var titleHtml = isAbierto
    ? '<span class="wbs-chapter-title wbs-ch-editable" onclick="openRenameChapterModal(' + ch.id + ',\'' + escapedTitle + '\')" title="Clic para renombrar">' + escapedTitle + editIcon + '</span>'
    : '<span class="wbs-chapter-title">' + escapedTitle + '</span>';

  // Toggle button
  var toggleBtn = '<button class="wbs-toggle-btn" onclick="toggleWbsChapter(\'' + chNodeId + '\')" title="Expandir/Colapsar">'
    + '<svg class="wbs-toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">'
    + '<polyline points="6 9 12 15 18 9"></polyline></svg></button>';

  // Chapter num badge
  var numBadge = '<span class="wbs-chapter-num">' + ch.numero + '</span>';

  // Action buttons
  var trashIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
  var actionBtns = '';
  if (isAbierto) {
    actionBtns = '<div class="wbs-row-actions">'
      + '<button class="btn-icon-control" onclick="moveChapterOrder(' + budget.id + ',' + ch.id + ',\'move_up\')" title="Mover arriba">&uarr;</button>'
      + '<button class="btn-icon-control" onclick="moveChapterOrder(' + budget.id + ',' + ch.id + ',\'move_down\')" title="Mover abajo">&darr;</button>'
      + '<button class="btn-icon-control" onclick="openCreateSubchapterModal(' + ch.id + ',\'' + escapedTitle + '\',\'' + ch.tipo + '\')" title="Agregar subnivel" style="color:var(--terracota-light);font-weight:bold;">+</button>'
      + '<button class="btn-icon-control danger" onclick="deleteChapterPrompt(' + budget.id + ',' + ch.id + ',\'' + escapedTitle + '\',' + (ch.subcapitulos.length + ch.items.length) + ')" title="Eliminar">' + trashIcon + '</button>'
      + '</div>';
  }

  // Row depth class
  var depthClass = depth === 0 ? 'wbs-row-chapter' : (depth === 1 ? 'wbs-row-subchapter' : 'wbs-row-deepchapter');

  rows.push(
    '<tr class="wbs-row ' + depthClass + '" data-ch-id="' + ch.id + '" data-depth="' + depth + '">'
    + '<td class="wbs-cell-code"><div style="display:flex;align-items:center;gap:6px;">' + toggleBtn + numBadge + '</div></td>'
    + '<td class="wbs-cell-desc" style="padding-left:' + (12 + indentPx) + 'px;"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' + titleHtml + natureBadge + '</div></td>'
    + '<td style="text-align:center;color:var(--text-muted);font-size:0.75rem;">&mdash;</td>'
    + '<td style="text-align:right;font-family:var(--font-mono);font-size:0.8rem;color:var(--text-muted);">' + incidenciaStr + '</td>'
    + '<td style="text-align:right;color:var(--text-muted);font-size:0.78rem;">&mdash;</td>'
    + '<td class="wbs-cell-total"><span class="wbs-chapter-subtotal">' + formatCurrency(ch.montoAcumulado) + '</span></td>'
    + '<td style="text-align:center;">' + actionBtns + '</td>'
    + '</tr>'
  );

  // Activity rows
  ch.items.forEach(function(item) {
    var qtyCell = isAbierto
      ? '<input type="number" step="any" min="0.001" class="wbs-qty-input" value="' + item.cantidad + '"'
        + ' onchange="updateActivityQuantity(' + budget.id + ',' + ch.id + ',' + item.id + ',this.value)"'
        + ' onblur="updateActivityQuantity(' + budget.id + ',' + ch.id + ',' + item.id + ',this.value)">'
      : '<span style="font-family:var(--font-mono);font-size:0.82rem;font-weight:600;">' + item.cantidad + '</span>';
    var delBtn = isAbierto
      ? '<button class="btn-icon-control danger" onclick="deleteActivityItem(' + budget.id + ',' + ch.id + ',' + item.id + ')" title="Quitar actividad">&#x2715;</button>'
      : '';
    rows.push(
      '<tr class="wbs-row wbs-row-activity" data-parent-ch="' + ch.id + '" data-group="' + chNodeId + '">'
      + '<td class="wbs-cell-code"><span class="wbs-item-code">' + item.codigo + '</span></td>'
      + '<td class="wbs-cell-desc" style="padding-left:' + (12 + indentPx + 28) + 'px;">'
      + '<span style="color:var(--text-secondary);">' + escapeHtml(item.nombre) + '</span>'
      + '<span style="color:var(--text-muted);font-size:0.75rem;margin-left:4px;">\u00b7 ' + item.unidad + '</span></td>'
      + '<td style="text-align:center;font-family:var(--font-mono);font-size:0.79rem;color:var(--text-muted);">' + item.unidad + '</td>'
      + '<td style="text-align:right;">' + qtyCell + '</td>'
      + '<td style="text-align:right;font-family:var(--font-mono);font-size:0.82rem;color:var(--text-muted);">' + formatCurrency(item.precioUnitario) + '</td>'
      + '<td class="wbs-cell-total" style="font-weight:700;color:var(--text-primary);">' + formatCurrency(item.total) + '</td>'
      + '<td style="text-align:center;">' + delBtn + '</td>'
      + '</tr>'
    );
  });

  // Add-activity row
  if (isAbierto) {
    rows.push(
      '<tr class="wbs-row wbs-row-add-activity" data-parent-ch="' + ch.id + '" data-group="' + chNodeId + '">'
      + '<td></td>'
      + '<td colspan="5" style="padding:0;padding-left:' + (12 + indentPx + 28) + 'px;">'
      + '<div class="wbs-add-activity-cell" id="wbs-add-bar-' + ch.id + '">'
      + '<div style="position:relative;flex:1;">'
      + '<input type="text" class="wbs-activity-search-input"'
      + ' placeholder="+ Agregar actividad (nombre o c\u00f3digo del APU)..."'
      + ' oninput="handleActivitySearchInput(event,' + budget.id + ',' + ch.id + ')"'
      + ' onfocus="handleActivitySearchInput(event,' + budget.id + ',' + ch.id + ')">'
      + '<div class="activity-dropdown-results" id="dropdown-apu-' + ch.id + '" style="display:none;"></div>'
      + '</div></div></td><td></td></tr>'
    );
  }

  // Recurse into subchapters
  if (ch.subcapitulos && ch.subcapitulos.length > 0) {
    ch.subcapitulos.forEach(function(sub) { collectWbsRows(sub, budget, totalDirectCost, rows, depth + 1); });
  }
}

function toggleWbsChapter(chNodeId) {
  var chId = chNodeId.replace('wbs-ch-', '');
  var childRows = document.querySelectorAll('[data-group="' + chNodeId + '"]');
  var toggleIcon = document.querySelector('[data-ch-id="' + chId + '"] .wbs-toggle-icon');
  var allHidden = Array.from(childRows).every(function(r) { return r.style.display === 'none'; });
  childRows.forEach(function(r) { r.style.display = allHidden ? '' : 'none'; });
  if (toggleIcon) toggleIcon.style.transform = allHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
}

// LEGACY — kept for reference, no longer called
function renderChapterNode(ch, budget, totalDirectCost) {
  const isAbierto = budget.estado === 'Abierto';
  const isDirecto = ch.tipo === 'Directo';
  const cardClass = isDirecto ? 'chapter-card-directo' : 'chapter-card-indirecto';
  const natureBadgeClass = isDirecto ? 'nature-badge-directo' : 'nature-badge-indirecto';

  const incidenciaStr = formatIncidencia(ch.montoAcumulado, totalDirectCost);

  // Selector o botón para alternar naturaleza solo si es capítulo raíz y está Abierto
  const canToggleNature = (ch.parentId === null && isAbierto);
  const natureToggleHtml = canToggleNature ? `
    <span class="nature-badge ${natureBadgeClass}" onclick="toggleChapterNature(${ch.id}, '${ch.tipo}')" style="cursor:pointer;" title="Clic para alternar entre Costo Directo e Indirecto">
      ${ch.tipo} ⇄
    </span>
  ` : `
    <span class="nature-badge ${natureBadgeClass}">
      ${ch.tipo}
    </span>
  `;

  // Filas de actividades en este capítulo
  const activitiesRowsHtml = ch.items.map(item => {
    return `
      <tr data-item-id="${item.id}">
        <td style="width:110px;">
          <span style="font-family:var(--font-mono); font-weight:700; color:var(--terracota-light); font-size:0.8rem;">
            ${item.codigo}
          </span>
        </td>
        <td>
          <div style="font-weight:600; color:var(--text-primary);">${escapeHtml(item.nombre)}</div>
        </td>
        <td style="width:80px;">
          <span style="font-family:var(--font-mono); font-size:0.8rem;">${item.unidad}</span>
        </td>
        <td style="width:110px;">
          ${isAbierto ? `
            <input type="number" step="any" min="0.001" class="activity-qty-input" value="${item.cantidad}"
                   onchange="updateActivityQuantity(${budget.id}, ${ch.id}, ${item.id}, this.value)"
                   onblur="updateActivityQuantity(${budget.id}, ${ch.id}, ${item.id}, this.value)">
          ` : `
            <span style="font-family:var(--font-mono); font-weight:600;">${item.cantidad}</span>
          `}
        </td>
        <td style="width:140px; text-align:right; font-family:var(--font-mono);">
          ${formatCurrency(item.precioUnitario)}
        </td>
        <td style="width:150px; text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--text-primary);">
          ${formatCurrency(item.total)}
        </td>
        <td style="width:40px; text-align:right;">
          ${isAbierto ? `
            <button type="button" onclick="deleteActivityItem(${budget.id}, ${ch.id}, ${item.id})" class="btn-icon-control danger" title="Quitar actividad">
              ✕
            </button>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');

  // Subcapítulos hijos (recursión)
  const subchaptersHtml = ch.subcapitulos && ch.subcapitulos.length > 0 ? `
    <div class="subchapters-container">
      ${ch.subcapitulos.map(sub => renderChapterNode(sub, budget, totalDirectCost)).join('')}
    </div>
  ` : '';

  return `
    <div class="chapter-node" id="chapter-node-${ch.id}">
      <div class="chapter-card ${cardClass}">
        
        <!-- Barra de Cabecera del Capítulo -->
        <div class="chapter-bar">
          <div class="chapter-bar-left">
            <span class="chapter-num-badge">${ch.numero}</span>
            <span class="chapter-title-text" onclick="${isAbierto ? `openRenameChapterModal(${ch.id}, '${escapeHtml(ch.titulo)}')` : ''}" title="${isAbierto ? 'Clic para renombrar' : ''}">
              ${escapeHtml(ch.titulo)}
              ${isAbierto ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.5;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>` : ''}
            </span>
            ${natureToggleHtml}
          </div>

          <div class="chapter-bar-right">
            <!-- Monto acumulado e incidencia (8.5) -->
            <div class="chapter-financial-stat">
              <span class="chapter-stat-label">Subtotal</span>
              <span class="chapter-stat-val">${formatCurrency(ch.montoAcumulado)}</span>
            </div>

            <div class="chapter-financial-stat" style="align-items:center;">
              <span class="chapter-stat-label">Incidencia</span>
              <span class="chapter-incidencia-pill">${incidenciaStr}</span>
            </div>

            <!-- Acciones por nivel (8.2) -->
            ${isAbierto ? `
              <div class="chapter-action-btns">
                <button type="button" onclick="moveChapterOrder(${budget.id}, ${ch.id}, 'move_up')" class="btn-icon-control" title="Mover Arriba">↑</button>
                <button type="button" onclick="moveChapterOrder(${budget.id}, ${ch.id}, 'move_down')" class="btn-icon-control" title="Mover Abajo">↓</button>
                <button type="button" onclick="openCreateSubchapterModal(${ch.id}, '${escapeHtml(ch.titulo)}', '${ch.tipo}')" class="btn-icon-control" title="Crear Subnivel (+)" style="font-weight:bold; color:var(--terracota-light);">(+)</button>
                <button type="button" onclick="deleteChapterPrompt(${budget.id}, ${ch.id}, '${escapeHtml(ch.titulo)}', ${ch.subcapitulos.length + ch.items.length})" class="btn-icon-control danger" title="Eliminar Nivel">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Tabla de Actividades de este Capítulo -->
        <div class="chapter-activities-wrap">
          ${ch.items.length > 0 ? `
            <table class="activities-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción de la Actividad (APU)</th>
                  <th>Unidad</th>
                  <th>Cantidad</th>
                  <th style="text-align:right;">P. Unitario</th>
                  <th style="text-align:right;">Costo Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${activitiesRowsHtml}
              </tbody>
            </table>
          ` : `
            <div style="padding:0.75rem 0.5rem; font-size:0.78rem; color:var(--text-muted); font-style:italic;">
              Sin actividades directas en este nivel.
            </div>
          `}

          <!-- Casilla de búsqueda rápida "+ Agregar Actividad" (8.3) -->
          ${isAbierto ? `
            <div class="chapter-add-activity-bar" id="activity-search-bar-${ch.id}">
              <div style="position:relative;">
                <input type="text" class="activity-search-input" placeholder="+ Agregar Actividad (escriba nombre o código del APU)..."
                       oninput="handleActivitySearchInput(event, ${budget.id}, ${ch.id})"
                       onfocus="handleActivitySearchInput(event, ${budget.id}, ${ch.id})">
                <div class="activity-dropdown-results" id="dropdown-apu-${ch.id}" style="display:none;"></div>
              </div>
            </div>
          ` : ''}
        </div>

      </div>

      <!-- Subcapítulos Hijos Anidados -->
      ${subchaptersHtml}
    </div>
  `;
}

// 8.6 Pie Financiero
function renderFinancialPie(budget, resumen) {
  const isAbierto = budget.estado === 'Abierto';

  // Aviso cuando no hay capítulos directos (8.6)
  const noDirectWarningHtml = resumen.showNoDirectWarning ? `
    <div class="alert-no-direct">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; margin-top:2px;">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <div>
        <strong>Aviso de clasificación:</strong> Este presupuesto no tiene capítulos de costo directo, así que el AIU da cero aunque esté configurado. Si lo que estás presupuestando es un servicio, esos costos son el costo directo de ese contrato y deberían clasificarse así.
      </div>
    </div>
  ` : '';

  return `
    <div class="financial-pie-card">
      ${noDirectWarningHtml}

      <div class="financial-pie-header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="1" x2="12" y2="23"></line>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
        </svg>
        <span>Resumen Financiero y Liquidación de Obra</span>
      </div>

      <table class="financial-pie-table">
        <tbody>
          <!-- 1. Total Costo Directo -->
          <tr>
            <td style="font-weight:700; color:var(--text-primary); width:45%;">Total Costo Directo</td>
            <td style="color:var(--text-muted); font-size:0.8rem; width:25%;">Suma de capítulos directos (Base AIU)</td>
            <td style="text-align:right; font-family:var(--font-mono); font-weight:700; font-size:1.05rem; color:var(--text-primary);">
              ${formatCurrency(resumen.costoDirecto)}
            </td>
          </tr>

          <!-- 2. Administración (A) -->
          <tr style="background:rgba(255,255,255,0.01);">
            <td style="padding-left:2rem; color:var(--text-secondary);">
              Administración (A)
            </td>
            <td>
              ${isAbierto ? `
                <div style="display:inline-flex; align-items:center; gap:0.35rem;">
                  <input type="number" step="0.1" min="0" max="100" class="aiu-input-inline" value="${resumen.aiuAdminPct}"
                         onchange="updateBudgetAiu(${budget.id}, 'aiuAdmin', this.value)">
                  <span style="font-size:0.8rem; color:var(--text-muted);">%</span>
                </div>
              ` : `
                <span style="font-family:var(--font-mono); font-weight:600;">${resumen.aiuAdminPct} %</span>
              `}
            </td>
            <td style="text-align:right; font-family:var(--font-mono); color:var(--text-primary);">
              ${formatCurrency(resumen.aiuAdminMonto)}
            </td>
          </tr>

          <!-- 3. Imprevistos (I) -->
          <tr style="background:rgba(255,255,255,0.01);">
            <td style="padding-left:2rem; color:var(--text-secondary);">
              Imprevistos (I)
            </td>
            <td>
              ${isAbierto ? `
                <div style="display:inline-flex; align-items:center; gap:0.35rem;">
                  <input type="number" step="0.1" min="0" max="100" class="aiu-input-inline" value="${resumen.aiuImprevistosPct}"
                         onchange="updateBudgetAiu(${budget.id}, 'aiuImprevistos', this.value)">
                  <span style="font-size:0.8rem; color:var(--text-muted);">%</span>
                </div>
              ` : `
                <span style="font-family:var(--font-mono); font-weight:600;">${resumen.aiuImprevistosPct} %</span>
              `}
            </td>
            <td style="text-align:right; font-family:var(--font-mono); color:var(--text-primary);">
              ${formatCurrency(resumen.aiuImprevistosMonto)}
            </td>
          </tr>

          <!-- 4. Utilidad (U) -->
          <tr style="background:rgba(255,255,255,0.01);">
            <td style="padding-left:2rem; color:var(--text-secondary);">
              Utilidad (U)
            </td>
            <td>
              ${isAbierto ? `
                <div style="display:inline-flex; align-items:center; gap:0.35rem;">
                  <input type="number" step="0.1" min="0" max="100" class="aiu-input-inline" value="${resumen.aiuUtilidadPct}"
                         onchange="updateBudgetAiu(${budget.id}, 'aiuUtilidad', this.value)">
                  <span style="font-size:0.8rem; color:var(--text-muted);">%</span>
                </div>
              ` : `
                <span style="font-family:var(--font-mono); font-weight:600;">${resumen.aiuUtilidadPct} %</span>
              `}
            </td>
            <td style="text-align:right; font-family:var(--font-mono); color:var(--text-primary);">
              ${formatCurrency(resumen.aiuUtilidadMonto)}
            </td>
          </tr>

          <!-- 5. Subtotal AIU -->
          <tr>
            <td style="font-weight:600; color:var(--terracota-light); padding-left:1.5rem;">
              Total A.I.U. (A + I + U)
            </td>
            <td style="font-size:0.8rem; color:var(--text-muted);">
              ${(resumen.aiuAdminPct + resumen.aiuImprevistosPct + resumen.aiuUtilidadPct).toFixed(2)} % sobre Costo Directo
            </td>
            <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--terracota-light);">
              ${formatCurrency(resumen.montoAiu)}
            </td>
          </tr>

          <!-- 6. Total Costo Indirecto -->
          <tr>
            <td style="font-weight:700; color:var(--text-primary);">Total Costo Indirecto</td>
            <td style="color:var(--text-muted); font-size:0.8rem;">Suma de capítulos indirectos (sin AIU)</td>
            <td style="text-align:right; font-family:var(--font-mono); font-weight:700; font-size:1.05rem; color:#60a5fa;">
              ${formatCurrency(resumen.costoIndirecto)}
            </td>
          </tr>

          <!-- 7. VALOR TOTAL DEL PROYECTO -->
          <tr class="row-total">
            <td>VALOR TOTAL</td>
            <td style="font-size:0.82rem; font-weight:normal; color:var(--text-muted);">Costo Directo + AIU + Costo Indirecto</td>
            <td style="text-align:right; font-family:var(--font-mono);">
              ${formatCurrency(resumen.valorTotal)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

// ============================================================================
// GESTIÓN DE ACTIVIDADES (8.3)
// ============================================================================

function handleActivitySearchInput(e, budgetId, chapterId) {
  const input = e.target;
  const val = input.value.trim().toLowerCase();
  const dropdown = document.getElementById(`dropdown-apu-${chapterId}`);
  if (!dropdown) return;

  if (!val) {
    dropdown.style.display = 'none';
    return;
  }

  const matches = allCompanyApus.filter(a => {
    return (a.codigo && a.codigo.toLowerCase().includes(val)) ||
           (a.nombre && a.nombre.toLowerCase().includes(val));
  });

  let itemsHtml = '';
  if (matches.length > 0) {
    itemsHtml = matches.slice(0, 8).map(apu => `
      <div class="activity-result-item" onclick="selectApuForChapter(${budgetId}, ${chapterId}, ${apu.id})">
        <div>
          <span style="font-family:var(--font-mono); font-weight:700; color:var(--terracota-light); font-size:0.8rem;">${apu.codigo}</span>
          <span style="font-weight:600; color:var(--text-primary); margin-left:0.5rem; font-size:0.82rem;">${escapeHtml(apu.nombre)}</span>
          <span style="color:var(--text-muted); font-size:0.75rem; margin-left:0.35rem;">(${apu.unidad})</span>
        </div>
        <div style="font-family:var(--font-mono); font-size:0.82rem; color:var(--text-primary);">
          ${formatCurrency(apu.costoDirecto)}
        </div>
      </div>
    `).join('');
  } else {
    itemsHtml = `
      <div class="activity-result-item-empty">
        No se encontró ningún APU que coincida con "${escapeHtml(val)}".
      </div>
    `;
  }

  // Opción "+ Crear Nuevo APU" (8.3)
  itemsHtml += `
    <div class="activity-result-item" style="border-top:1px dashed var(--border-subtle); background:rgba(217,107,67,0.06);"
         onclick="openApuModalFromWorkspace(${budgetId}, ${chapterId}, '${escapeHtml(val)}')">
      <div style="font-weight:700; color:var(--terracota-light); font-size:0.82rem; display:flex; align-items:center; gap:0.4rem;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>+ Crear Nuevo APU "${escapeHtml(val)}"</span>
      </div>
      <span style="font-size:0.75rem; color:var(--text-muted);">Abre pop-out y asigna aquí</span>
    </div>
  `;

  dropdown.innerHTML = itemsHtml;
  dropdown.style.display = 'block';

  // Cerrar dropdown al hacer clic afuera
  const closeDropdownHandler = (evt) => {
    if (!dropdown.contains(evt.target) && evt.target !== input) {
      dropdown.style.display = 'none';
      document.removeEventListener('click', closeDropdownHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeDropdownHandler), 10);
}

async function selectApuForChapter(budgetId, chapterId, apuId) {
  try {
    const res = await fetch(`/api/budgets/${budgetId}/chapters/${chapterId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apuId, cantidad: 1.0 })
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || 'Error al agregar actividad.');
      return;
    }

    currentBudgetDetail = data.data;
    renderWorkspaceUI(currentBudgetDetail);
  } catch (e) {
    console.error('Error agregando actividad:', e);
  }
}

function openApuModalFromWorkspace(budgetId, chapterId, initialName) {
  pendingApuTargetChapterId = { budgetId, chapterId };
  if (typeof openApuModal === 'function') {
    openApuModal(null, 'create');
    const nameInput = document.getElementById('modal-apu-name');
    if (nameInput && initialName) {
      nameInput.value = initialName;
    }
  } else {
    alert('Abra el módulo APU para crear actividades.');
  }
}

// Hook al guardar un nuevo APU para insertarlo si venía de la mesa de trabajo
window.onApuCreatedCallback = async function(newApu) {
  if (pendingApuTargetChapterId && newApu && newApu.id) {
    const { budgetId, chapterId } = pendingApuTargetChapterId;
    pendingApuTargetChapterId = null;
    await selectApuForChapter(budgetId, chapterId, newApu.id);
  }
};

async function updateActivityQuantity(budgetId, chapterId, itemId, newQty) {
  const qty = parseFloat(newQty);
  if (isNaN(qty) || qty <= 0) return;

  try {
    const res = await fetch(`/api/budgets/${budgetId}/chapters/${chapterId}/items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cantidad: qty })
    });
    const data = await res.json();
    if (data.success && data.data) {
      currentBudgetDetail = data.data;
      renderWorkspaceUI(currentBudgetDetail);
    }
  } catch (e) {
    console.error('Error actualizando cantidad:', e);
  }
}

async function deleteActivityItem(budgetId, chapterId, itemId) {
  if (!confirm('¿Desea quitar esta actividad del capítulo?')) return;

  try {
    const res = await fetch(`/api/budgets/${budgetId}/chapters/${chapterId}/items/${itemId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success && data.data) {
      currentBudgetDetail = data.data;
      renderWorkspaceUI(currentBudgetDetail);
    }
  } catch (e) {
    console.error('Error eliminando actividad:', e);
  }
}

// ============================================================================
// GESTIÓN DE CAPÍTULOS Y SUBCAPÍTULOS (8.2 y 8.4)
// ============================================================================

function openCreateChapterModal() {
  const modal = document.getElementById('chapter-create-popout-modal');
  const alertBox = document.getElementById('modal-chapter-alert');
  if (alertBox) alertBox.style.display = 'none';

  const form = document.getElementById('chapter-create-form');
  if (form) form.reset();

  // Reset selección obligatoria
  document.getElementById('chapter-selected-nature').value = '';
  document.getElementById('opt-nature-directo').classList.remove('selected');
  document.getElementById('opt-nature-indirecto').classList.remove('selected');

  if (modal) modal.style.display = 'flex';
}

function closeCreateChapterModal() {
  const modal = document.getElementById('chapter-create-popout-modal');
  if (modal) modal.style.display = 'none';
}

function selectChapterNature(nature) {
  document.getElementById('chapter-selected-nature').value = nature;
  const optDirecto = document.getElementById('opt-nature-directo');
  const optIndirecto = document.getElementById('opt-nature-indirecto');

  if (nature === 'Directo') {
    optDirecto.classList.add('selected');
    optIndirecto.classList.remove('selected');
  } else {
    optIndirecto.classList.add('selected');
    optDirecto.classList.remove('selected');
  }
}

async function handleCreateChapterSubmit(e) {
  e.preventDefault();
  const alertBox = document.getElementById('modal-chapter-alert');
  if (alertBox) alertBox.style.display = 'none';

  const titulo = document.getElementById('chapter-new-titulo').value.trim();
  const tipo = document.getElementById('chapter-selected-nature').value;

  if (!titulo) {
    if (alertBox) {
      alertBox.textContent = 'El título del capítulo es obligatorio.';
      alertBox.style.display = 'block';
    }
    return;
  }

  if (!tipo) {
    if (alertBox) {
      alertBox.textContent = 'Debe seleccionar obligatoriamente si el capítulo es Costo Directo o Costo Indirecto.';
      alertBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await fetch(`/api/budgets/${currentBudgetDetail.budget.id}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, tipo, parentId: null })
    });
    const data = await res.json();
    if (!data.success) {
      if (alertBox) {
        alertBox.textContent = data.message || 'Error al crear capítulo.';
        alertBox.style.display = 'block';
      }
      return;
    }

    closeCreateChapterModal();
    currentBudgetDetail = data.data;
    renderWorkspaceUI(currentBudgetDetail);
  } catch (err) {
    console.error('Error al crear capítulo:', err);
  }
}

function openCreateSubchapterModal(parentId, parentTitle, parentNature) {
  const modal = document.getElementById('subchapter-create-popout-modal');
  const alertBox = document.getElementById('modal-subchapter-alert');
  if (alertBox) alertBox.style.display = 'none';

  const form = document.getElementById('subchapter-create-form');
  if (form) form.reset();

  document.getElementById('subchapter-parent-id').value = parentId;
  document.getElementById('subchapter-modal-subtitle').textContent = `Subnivel subordinado a: "${parentTitle}"`;
  document.getElementById('subchapter-inherited-nature').textContent = parentNature;

  if (modal) modal.style.display = 'flex';
}

function closeCreateSubchapterModal() {
  const modal = document.getElementById('subchapter-create-popout-modal');
  if (modal) modal.style.display = 'none';
}

async function handleCreateSubchapterSubmit(e) {
  e.preventDefault();
  const alertBox = document.getElementById('modal-subchapter-alert');
  if (alertBox) alertBox.style.display = 'none';

  const parentId = document.getElementById('subchapter-parent-id').value;
  const titulo = document.getElementById('subchapter-new-titulo').value.trim();

  if (!titulo) {
    if (alertBox) {
      alertBox.textContent = 'El título del subnivel es obligatorio.';
      alertBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await fetch(`/api/budgets/${currentBudgetDetail.budget.id}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, parentId })
    });
    const data = await res.json();
    if (!data.success) {
      if (alertBox) {
        alertBox.textContent = data.message || 'Error al crear subnivel.';
        alertBox.style.display = 'block';
      }
      return;
    }

    closeCreateSubchapterModal();
    currentBudgetDetail = data.data;
    renderWorkspaceUI(currentBudgetDetail);
  } catch (err) {
    console.error('Error creando subcapítulo:', err);
  }
}

function openRenameChapterModal(chapterId, currentTitle) {
  document.getElementById('rename-chapter-id').value = chapterId;
  document.getElementById('rename-chapter-input').value = currentTitle;
  document.getElementById('chapter-rename-popout-modal').style.display = 'flex';
}

function closeRenameChapterModal() {
  document.getElementById('chapter-rename-popout-modal').style.display = 'none';
}

async function handleRenameChapterSubmit(e) {
  e.preventDefault();
  const chapterId = document.getElementById('rename-chapter-id').value;
  const nuevoTitulo = document.getElementById('rename-chapter-input').value.trim();

  if (!nuevoTitulo) return;

  try {
    const res = await fetch(`/api/budgets/${currentBudgetDetail.budget.id}/chapters/${chapterId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo: nuevoTitulo })
    });
    const data = await res.json();
    if (data.success && data.data) {
      closeRenameChapterModal();
      currentBudgetDetail = data.data;
      renderWorkspaceUI(currentBudgetDetail);
    }
  } catch (e) {
    console.error('Error renombrando capítulo:', e);
  }
}

async function toggleChapterNature(chapterId, currentNature) {
  const newNature = currentNature === 'Directo' ? 'Indirecto' : 'Directo';
  if (!confirm(`¿Desea cambiar la clasificación del capítulo a '${newNature}'?\nTodos sus subniveles y actividades heredarán esta naturaleza.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/budgets/${currentBudgetDetail.budget.id}/chapters/${chapterId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: newNature })
    });
    const data = await res.json();
    if (data.success && data.data) {
      currentBudgetDetail = data.data;
      renderWorkspaceUI(currentBudgetDetail);
    }
  } catch (e) {
    console.error('Error al alternar naturaleza de capítulo:', e);
  }
}

async function moveChapterOrder(budgetId, chapterId, action) {
  try {
    const res = await fetch(`/api/budgets/${budgetId}/chapters/${chapterId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    if (data.success && data.data) {
      currentBudgetDetail = data.data;
      renderWorkspaceUI(currentBudgetDetail);
    }
  } catch (e) {
    console.error('Error reordenando capítulo:', e);
  }
}

async function deleteChapterPrompt(budgetId, chapterId, titulo, elementsCount) {
  let msg = `¿Está seguro de eliminar el capítulo "${titulo}"?`;
  if (elementsCount > 0) {
    msg += `\n\nATENCIÓN: Este nivel contiene ${elementsCount} subnivel(es) o actividad(es) que también serán eliminados.`;
  }

  if (!confirm(msg)) return;

  try {
    const res = await fetch(`/api/budgets/${budgetId}/chapters/${chapterId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success && data.data) {
      currentBudgetDetail = data.data;
      renderWorkspaceUI(currentBudgetDetail);
    }
  } catch (e) {
    console.error('Error eliminando capítulo:', e);
  }
}

// ============================================================================
// GESTIÓN DE AIU Y ESTADOS (8.1 & 8.6)
// ============================================================================

async function updateBudgetAiu(budgetId, field, value) {
  const val = parseFloat(value);
  if (isNaN(val) || val < 0) return;

  const payload = {};
  payload[field] = val;

  try {
    const res = await fetch(`/api/budgets/${budgetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success && data.data) {
      currentBudgetDetail = data.data;
      renderWorkspaceUI(currentBudgetDetail);
    }
  } catch (e) {
    console.error('Error actualizando AIU:', e);
  }
}

async function triggerActivateBudget(budgetId) {
  const resumen = currentBudgetDetail.resumen;
  const aiuIsZero = (resumen.aiuAdminPct === 0 && resumen.aiuImprevistosPct === 0 && resumen.aiuUtilidadPct === 0);

  if (aiuIsZero) {
    // Aviso al activar con el AIU en cero (8.6)
    const modal = document.getElementById('aiu-zero-warning-modal');
    const btnConfirm = document.getElementById('btn-confirm-activate-zero-aiu');
    if (modal && btnConfirm) {
      btnConfirm.onclick = () => {
        closeAiuZeroWarningModal();
        changeBudgetStatus(budgetId, 'Activo');
      };
      modal.style.display = 'flex';
    }
    return;
  }

  if (confirm('¿Desea activar este presupuesto? Se congelará la línea base y se restringirán las modificaciones de actividades y capítulos.')) {
    changeBudgetStatus(budgetId, 'Activo');
  }
}

function closeAiuZeroWarningModal() {
  const modal = document.getElementById('aiu-zero-warning-modal');
  if (modal) modal.style.display = 'none';
}

async function changeBudgetStatus(budgetId, nuevoEstado) {
  try {
    const res = await fetch(`/api/budgets/${budgetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: nuevoEstado })
    });
    const data = await res.json();
    if (data.success && data.data) {
      currentBudgetDetail = data.data;
      renderWorkspaceUI(currentBudgetDetail);
    } else {
      alert(data.message || 'No se pudo cambiar el estado del presupuesto.');
    }
  } catch (e) {
    console.error('Error cambiando estado:', e);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
