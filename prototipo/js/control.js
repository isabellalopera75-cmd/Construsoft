// ============================================================================
// MÓDULO DE CONTROL DE OBRA (OPCIÓN A)
// ============================================================================

let controlActivoBudgets = [];
let controlSelectedBudget = null;
let controlAllItems = [];

async function initControlModule() {
  const view = document.getElementById('view-module-control');
  if (view) view.style.display = 'block';

  await loadActivoBudgets();
}

async function loadActivoBudgets() {
  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  const cid = user.company?.id || 'comp_01';
  
  try {
    const res = await fetch(`/api/budgets?company_id=${cid}`);
    const data = await res.json();
    if (data.success) {
      controlActivoBudgets = data.budgets.filter(b => b.estado.toLowerCase() === 'activo');
      renderControlBudgetSelect();
    }
  } catch (err) {
    console.error('Error cargando presupuestos para control', err);
  }
}

function renderControlBudgetSelect() {
  const select = document.getElementById('control-budget-select');
  if (!select) return;
  
  select.innerHTML = '<option value="">-- Selecciona un proyecto activo --</option>';
  controlActivoBudgets.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = `${b.codigo} | ${b.nombre} (Activo)`;
    select.appendChild(opt);
  });
}

function onControlBudgetSelectChange(e) {
  const bid = e.target.value;
  if (!bid) {
    controlSelectedBudget = null;
    renderControlTable();
    return;
  }
  
  const b = controlActivoBudgets.find(x => String(x.id) === String(bid));
  if (b) {
    controlSelectedBudget = b;
    loadControlChapters(b.id);
  }
}

async function loadControlChapters(budgetId) {
  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  const cid = user.company?.id || 'comp_01';
  
  try {
    const res = await fetch(`/api/budgets/${budgetId}/chapters?company_id=${cid}`);
    const data = await res.json();
    if (data.success) {
      const chapters = data.chapters;
      controlAllItems = [];
      chapters.forEach(ch => {
        (ch.items || []).forEach(it => {
          controlAllItems.push({
            chapterId: ch.id,
            chapterName: ch.nombre,
            ...it
          });
        });
      });
      renderControlTable();
    }
  } catch(err) {
    console.error('Error', err);
  }
}

function renderControlTable() {
  const tbody = document.getElementById('control-table-body');
  if (!tbody) return;
  
  if (!controlSelectedBudget) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">Por favor selecciona un proyecto arriba.</td></tr>';
    return;
  }
  
  if (controlAllItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">El presupuesto no tiene actividades registradas.</td></tr>';
    return;
  }
  
  tbody.innerHTML = '';
  
  controlAllItems.forEach((it, idx) => {
    const tr = document.createElement('tr');
    
    const qty = it.cantidad || 0;
    const qtyEj = it.cantidadEjecutada || 0;
    let pct = 0;
    if (qty > 0) {
      pct = Math.round((qtyEj / qty) * 100);
    }
    
    // Si la cantidad ejecutada se pasa, cap a 100 para el bar, pero mostrar ms
    const barPct = Math.min(pct, 100);
    
    let colorClass = '#10b981'; // Green
    if (pct < 100 && pct > 0) colorClass = '#f59e0b'; // Amber
    else if (pct === 0) colorClass = 'rgba(255,255,255,0.2)';
    
    tr.innerHTML = `
      <td>${it.codigo || `1.${idx+1}`}</td>
      <td>
        <div style="font-weight:600; margin-bottom:0.2rem;">${it.nombre}</div>
        <div style="font-size:0.75rem; color:var(--text-muted);">Cap: ${it.chapterName}</div>
      </td>
      <td>${it.unidad || 'und'}</td>
      <td style="text-align: right; font-weight: 600;">${qty.toFixed(2)}</td>
      <td style="text-align: right; color: ${pct === 100 ? '#10b981' : (pct > 0 ? '#f59e0b' : 'var(--text-main)')}; font-weight: 600;">
        ${qtyEj.toFixed(2)}
      </td>
      <td style="text-align: center;">
        <div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
          <div style="width: 80px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
            <div style="width: ${barPct}%; height: 100%; background: ${colorClass};"></div>
          </div>
          <span style="font-size: 0.8rem; font-weight: 600; color: ${colorClass};">${pct}%</span>
        </div>
      </td>
      <td style="text-align: center;">
        ${pct >= 100 
          ? `<button type="button" class="btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" disabled>Completado</button>`
          : `<button type="button" class="btn-terracota" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; width: auto;" onclick="event.stopPropagation(); openAvanceModalProxy(this)" data-budget="${controlSelectedBudget.id}" data-chapter="${it.chapterId}" data-item="${it.id}" data-name="${escapeHtml(it.nombre)}" data-unit="${it.unidad}">+ Registrar</button>`
        }
      </td>
    `;
    tbody.appendChild(tr);
  });
}


