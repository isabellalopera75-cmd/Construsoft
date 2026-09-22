/**
 * ConstruSoft — API Mock Layer
 * Intercepta fetch() globalmente y resuelve todos los endpoints /api/*
 * usando localStorage. No se requiere servidor.
 */

const MOCK_KEYS = {
  RESOURCES: 'construsoft_resources',
  APUS:      'construsoft_apus',
  BUDGETS:   'construsoft_budgets',
};

// ── DATOS DEMO: Recursos ────────────────────────────────────
const DEMO_RESOURCES = [
  { id:1,  codigo:'MAT-001', nombre:'Cemento Portland tipo I (50 kg)',            tipo:'Materiales', unidad:'sac', precioBase:28500, ivaPorcentaje:19, precioTotal:33915, enUso:true,  apusVinculados:['APU-001','APU-003'] },
  { id:2,  codigo:'MAT-002', nombre:'Arena de río lavada',                        tipo:'Materiales', unidad:'m³',  precioBase:68000, ivaPorcentaje:0,  precioTotal:68000, enUso:true,  apusVinculados:['APU-001'] },
  { id:3,  codigo:'MAT-003', nombre:'Grava triturada 3/4"',                       tipo:'Materiales', unidad:'m³',  precioBase:72000, ivaPorcentaje:0,  precioTotal:72000, enUso:true,  apusVinculados:['APU-001'] },
  { id:4,  codigo:'MAT-004', nombre:'Acero de refuerzo Fy=420 MPa (varilla 1/2")',tipo:'Materiales', unidad:'kg',  precioBase:3800,  ivaPorcentaje:19, precioTotal:4522,  enUso:true,  apusVinculados:['APU-002'] },
  { id:5,  codigo:'MAT-005', nombre:'Bloque de arcilla #5 (12x20x33 cm)',         tipo:'Materiales', unidad:'un',  precioBase:2100,  ivaPorcentaje:5,  precioTotal:2205,  enUso:true,  apusVinculados:['APU-004'] },
  { id:6,  codigo:'MAT-006', nombre:'Agua potable para mezcla',                   tipo:'Materiales', unidad:'m³',  precioBase:4200,  ivaPorcentaje:0,  precioTotal:4200,  enUso:true,  apusVinculados:['APU-001'] },
  { id:7,  codigo:'MAT-007', nombre:'Pintura tipo 1 vinilo interior (galón)',      tipo:'Materiales', unidad:'gl',  precioBase:38000, ivaPorcentaje:19, precioTotal:45220, enUso:false, apusVinculados:[] },
  { id:8,  codigo:'MAT-008', nombre:'Impermeabilizante cementicio bicomponente',  tipo:'Materiales', unidad:'kg',  precioBase:14500, ivaPorcentaje:19, precioTotal:17255, enUso:false, apusVinculados:[] },
  { id:9,  codigo:'MAT-009', nombre:'Puntilla 2" (caja x 500 g)',                 tipo:'Materiales', unidad:'un',  precioBase:12000, ivaPorcentaje:19, precioTotal:14280, enUso:false, apusVinculados:[] },
  { id:10, codigo:'MAT-010', nombre:'Alambre negro recocido calibre 18',           tipo:'Materiales', unidad:'kg',  precioBase:4800,  ivaPorcentaje:19, precioTotal:5712,  enUso:true,  apusVinculados:['APU-002'] },
  { id:20, codigo:'EQU-001', nombre:'Mezcladora de concreto 1 saco (gasolina)',    tipo:'Equipos',    unidad:'hr',  precioBase:35000, ivaPorcentaje:19, precioTotal:41650, enUso:true,  apusVinculados:['APU-001'] },
  { id:21, codigo:'EQU-002', nombre:'Vibrador para concreto (eléctrico)',          tipo:'Equipos',    unidad:'hr',  precioBase:22000, ivaPorcentaje:19, precioTotal:26180, enUso:false, apusVinculados:[] },
  { id:22, codigo:'EQU-003', nombre:'Compactador tipo rana (gasolina)',            tipo:'Equipos',    unidad:'hr',  precioBase:42000, ivaPorcentaje:19, precioTotal:49980, enUso:false, apusVinculados:[] },
  { id:23, codigo:'EQU-004', nombre:'Andamio metálico tubular (alquiler mes)',     tipo:'Equipos',    unidad:'mes', precioBase:85000, ivaPorcentaje:19, precioTotal:101150,enUso:false, apusVinculados:[] },
  { id:24, codigo:'EQU-005', nombre:'Cortadora de bloque eléctrica',              tipo:'Equipos',    unidad:'hr',  precioBase:18000, ivaPorcentaje:19, precioTotal:21420, enUso:true,  apusVinculados:['APU-004'] },
  { id:30, codigo:'PER-001', nombre:'Maestro de obras categoría A',               tipo:'Personal',   unidad:'hr',  precioBase:18500, ivaPorcentaje:0,  precioTotal:18500, enUso:true,  apusVinculados:['APU-001','APU-002','APU-004'] },
  { id:31, codigo:'PER-002', nombre:'Oficial de construcción',                    tipo:'Personal',   unidad:'hr',  precioBase:14200, ivaPorcentaje:0,  precioTotal:14200, enUso:true,  apusVinculados:['APU-001','APU-003'] },
  { id:32, codigo:'PER-003', nombre:'Ayudante de construcción',                   tipo:'Personal',   unidad:'hr',  precioBase:10800, ivaPorcentaje:0,  precioTotal:10800, enUso:true,  apusVinculados:['APU-001','APU-002','APU-004'] },
  { id:33, codigo:'PER-004', nombre:'Fierrero — Armador de acero',                tipo:'Personal',   unidad:'hr',  precioBase:16000, ivaPorcentaje:0,  precioTotal:16000, enUso:true,  apusVinculados:['APU-002'] },
  { id:34, codigo:'PER-005', nombre:'Topógrafo con equipo',                       tipo:'Personal',   unidad:'hr',  precioBase:35000, ivaPorcentaje:0,  precioTotal:35000, enUso:false, apusVinculados:[] },
];

// ── DATOS DEMO: APUs ────────────────────────────────────────
const DEMO_APUS = [
  { id:1, codigo:'APU-001', nombre:"Concreto ciclópeo f'c=15 MPa con piedra rajón (60/40)", unidad:'m³', estado:'activo', costoDirecto:485200,
    lineas:[
      { resourceId:1,  codigo:'MAT-001', nombre:'Cemento Portland tipo I (50 kg)', tipo:'Materiales', unidad:'sac', precioTotal:33915, cantidad:3.5,  rendimiento:1, desperdicio:5,  subtotal:124887 },
      { resourceId:2,  codigo:'MAT-002', nombre:'Arena de río lavada',             tipo:'Materiales', unidad:'m³',  precioTotal:68000, cantidad:0.65, rendimiento:1, desperdicio:10, subtotal:48620  },
      { resourceId:3,  codigo:'MAT-003', nombre:'Grava triturada 3/4"',            tipo:'Materiales', unidad:'m³',  precioTotal:72000, cantidad:0.70, rendimiento:1, desperdicio:10, subtotal:55440  },
      { resourceId:6,  codigo:'MAT-006', nombre:'Agua potable para mezcla',        tipo:'Materiales', unidad:'m³',  precioTotal:4200,  cantidad:0.22, rendimiento:1, desperdicio:0,  subtotal:924    },
      { resourceId:20, codigo:'EQU-001', nombre:'Mezcladora de concreto 1 saco',   tipo:'Equipos',    unidad:'hr',  precioTotal:41650, cantidad:2.0,  rendimiento:1, desperdicio:0,  subtotal:83300  },
      { resourceId:30, codigo:'PER-001', nombre:'Maestro de obras categoría A',    tipo:'Personal',   unidad:'hr',  precioTotal:18500, cantidad:2.0,  rendimiento:1, desperdicio:0,  subtotal:37000  },
      { resourceId:31, codigo:'PER-002', nombre:'Oficial de construcción',         tipo:'Personal',   unidad:'hr',  precioTotal:14200, cantidad:4.0,  rendimiento:1, desperdicio:0,  subtotal:56800  },
      { resourceId:32, codigo:'PER-003', nombre:'Ayudante de construcción',        tipo:'Personal',   unidad:'hr',  precioTotal:10800, cantidad:7.0,  rendimiento:1, desperdicio:0,  subtotal:75600  },
    ]
  },
  { id:2, codigo:'APU-002', nombre:'Acero de refuerzo Fy=420 MPa — suministro e instalación', unidad:'kg', estado:'activo', costoDirecto:6890,
    lineas:[
      { resourceId:4,  codigo:'MAT-004', nombre:'Acero de refuerzo Fy=420 MPa',   tipo:'Materiales', unidad:'kg', precioTotal:4522,  cantidad:1.05, rendimiento:1, desperdicio:5, subtotal:4990 },
      { resourceId:10, codigo:'MAT-010', nombre:'Alambre negro recocido cal. 18',  tipo:'Materiales', unidad:'kg', precioTotal:5712,  cantidad:0.03, rendimiento:1, desperdicio:0, subtotal:171  },
      { resourceId:30, codigo:'PER-001', nombre:'Maestro de obras categoría A',   tipo:'Personal',   unidad:'hr', precioTotal:18500, cantidad:0.02, rendimiento:1, desperdicio:0, subtotal:370  },
      { resourceId:33, codigo:'PER-004', nombre:'Fierrero — Armador de acero',    tipo:'Personal',   unidad:'hr', precioTotal:16000, cantidad:0.06, rendimiento:1, desperdicio:0, subtotal:960  },
      { resourceId:32, codigo:'PER-003', nombre:'Ayudante de construcción',       tipo:'Personal',   unidad:'hr', precioTotal:10800, cantidad:0.04, rendimiento:1, desperdicio:0, subtotal:432  },
    ]
  },
  { id:3, codigo:'APU-003', nombre:'Pañete de muros exteriores (1:3) espesor 2 cm', unidad:'m²', estado:'activo', costoDirecto:28450,
    lineas:[
      { resourceId:1,  codigo:'MAT-001', nombre:'Cemento Portland tipo I (50 kg)', tipo:'Materiales', unidad:'sac', precioTotal:33915, cantidad:0.22, rendimiento:1, desperdicio:5,  subtotal:7840  },
      { resourceId:2,  codigo:'MAT-002', nombre:'Arena de río lavada',             tipo:'Materiales', unidad:'m³',  precioTotal:68000, cantidad:0.06, rendimiento:1, desperdicio:10, subtotal:4488  },
      { resourceId:31, codigo:'PER-002', nombre:'Oficial de construcción',         tipo:'Personal',   unidad:'hr',  precioTotal:14200, cantidad:0.80, rendimiento:1, desperdicio:0,  subtotal:11360 },
      { resourceId:32, codigo:'PER-003', nombre:'Ayudante de construcción',        tipo:'Personal',   unidad:'hr',  precioTotal:10800, cantidad:0.43, rendimiento:1, desperdicio:0,  subtotal:4644  },
    ]
  },
  { id:4, codigo:'APU-004', nombre:'Muro en bloque de arcilla #5 (e=12 cm) con mortero 1:4', unidad:'m²', estado:'activo', costoDirecto:52800,
    lineas:[
      { resourceId:5,  codigo:'MAT-005', nombre:'Bloque de arcilla #5',            tipo:'Materiales', unidad:'un',  precioTotal:2205,  cantidad:12.5, rendimiento:1, desperdicio:5,  subtotal:28913 },
      { resourceId:1,  codigo:'MAT-001', nombre:'Cemento Portland tipo I (50 kg)', tipo:'Materiales', unidad:'sac', precioTotal:33915, cantidad:0.18, rendimiento:1, desperdicio:5,  subtotal:6410  },
      { resourceId:2,  codigo:'MAT-002', nombre:'Arena de río lavada',             tipo:'Materiales', unidad:'m³',  precioTotal:68000, cantidad:0.06, rendimiento:1, desperdicio:10, subtotal:4488  },
      { resourceId:24, codigo:'EQU-005', nombre:'Cortadora de bloque eléctrica',   tipo:'Equipos',    unidad:'hr',  precioTotal:21420, cantidad:0.15, rendimiento:1, desperdicio:0,  subtotal:3213  },
      { resourceId:30, codigo:'PER-001', nombre:'Maestro de obras categoría A',    tipo:'Personal',   unidad:'hr',  precioTotal:18500, cantidad:0.25, rendimiento:1, desperdicio:0,  subtotal:4625  },
      { resourceId:32, codigo:'PER-003', nombre:'Ayudante de construcción',        tipo:'Personal',   unidad:'hr',  precioTotal:10800, cantidad:0.48, rendimiento:1, desperdicio:0,  subtotal:5184  },
    ]
  },
];

// ── DATOS DEMO: Presupuestos ────────────────────────────────
const DEMO_BUDGETS = [
  {
    id:1, codigo:'PPTO-2026-001',
    nombre:'Construcción Vivienda Unifamiliar — Barrio El Prado',
    descripcion:'Presupuesto para construcción de vivienda de 2 pisos, 120 m² en área construida.',
    estado:'Activo', aiu:{ administracion:10, imprevistos:3, utilidad:7 },
    fechaCreacion:'2026-07-15',
    chapters:[
      { id:1, orden:1, nombre:'CAPÍTULO 01 — PRELIMINARES', items:[
        { id:1, codigo:'ITM-001', nombre:'Localización y replanteo topográfico', unidad:'m²', cantidad:120, cantidadEjecutada: 20, precioUnitario:4500,  subtotal:540000,  apuId:null, apuCodigo:null },
        { id:2, codigo:'ITM-002', nombre:'Descapote manual (h=20 cm)',           unidad:'m²', cantidad:120, cantidadEjecutada: 120, precioUnitario:8200,  subtotal:984000,  apuId:null, apuCodigo:null },
      ]},
      { id:2, orden:2, nombre:'CAPÍTULO 02 — CIMENTACIÓN', items:[
        { id:3, codigo:'ITM-003', nombre:"Concreto ciclópeo f'c=15 MPa", unidad:'m³', cantidad:18.5, cantidadEjecutada: 5, precioUnitario:485200, subtotal:8976200, apuId:1, apuCodigo:'APU-001' },
        { id:4, codigo:'ITM-004', nombre:'Acero de refuerzo Fy=420 MPa',  unidad:'kg', cantidad:850, cantidadEjecutada: 0, precioUnitario:6890,   subtotal:5856500, apuId:2, apuCodigo:'APU-002' },
      ]},
      { id:3, orden:3, nombre:'CAPÍTULO 03 — MAMPOSTERÍA', items:[
        { id:5, codigo:'ITM-005', nombre:'Muro bloque arcilla #5 e=12 cm', unidad:'m²', cantidad:310, cantidadEjecutada: 0, precioUnitario:52800, subtotal:16368000, apuId:4, apuCodigo:'APU-004' },
        { id:6, codigo:'ITM-006', nombre:'Pañete exterior 1:3 e=2 cm',     unidad:'m²', cantidad:280, cantidadEjecutada: 0, precioUnitario:28450, subtotal:7966000,  apuId:3, apuCodigo:'APU-003' },
      ]},
    ]
  },
  {
    id:2, codigo:'PPTO-2026-002',
    nombre:'Adecuación Oficinas — Centro Empresarial Norte',
    descripcion:'Remodelación y adecuación de 3 oficinas en piso 4, área total 85 m².',
    estado:'abierto', aiu:{ administracion:12, imprevistos:5, utilidad:8 },
    fechaCreacion:'2026-08-20',
    chapters:[
      { id:4, orden:1, nombre:'CAPÍTULO 01 — ACABADOS MUROS', items:[
        { id:7, codigo:'ITM-001', nombre:'Pañete interior 1:3 e=1.5 cm', unidad:'m²', cantidad:195, precioUnitario:28450, subtotal:5547750, apuId:3, apuCodigo:'APU-003' },
      ]},
    ]
  },
];

// ============================================================
// HELPERS
// ============================================================
function _getUser() {
  try { return JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}'); } catch { return {}; }
}
function _getCompanyId() {
  return _getUser().company?.id || 'comp_01';
}
function _mk(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
function _loadData(key, companyId) {
  _ensureDemo(companyId);
  try { return JSON.parse(localStorage.getItem(key + '_' + companyId) || '[]'); } catch { return []; }
}
function _saveData(key, companyId, data) {
  localStorage.setItem(key + '_' + companyId, JSON.stringify(data));
}
function _nextId(arr) {
  return arr.length === 0 ? 1 : Math.max(...arr.map(x => x.id || 0)) + 1;
}
function _ensureDemo(companyId) {
  if (!localStorage.getItem(MOCK_KEYS.RESOURCES + '_' + companyId)) {
    _saveData(MOCK_KEYS.RESOURCES, companyId, DEMO_RESOURCES.map(r => ({ ...r, companyId })));
  }
  if (!localStorage.getItem(MOCK_KEYS.APUS + '_' + companyId)) {
    _saveData(MOCK_KEYS.APUS, companyId, DEMO_APUS.map(a => ({ ...a, companyId })));
  }
  if (!localStorage.getItem(MOCK_KEYS.BUDGETS + '_' + companyId)) {
    _saveData(MOCK_KEYS.BUDGETS, companyId, DEMO_BUDGETS.map(b => ({ ...b, companyId })));
  }
}
function _getCompanyRec(companyId) {
  try {
    const list = JSON.parse(localStorage.getItem('contrusoft_companies') || '[]');
    return list.find(c => c.id === companyId) || {};
  } catch { return {}; }
}
function _saveCompanyField(companyId, updates) {
  try {
    const list = JSON.parse(localStorage.getItem('contrusoft_companies') || '[]');
    const i = list.findIndex(c => c.id === companyId);
    if (i !== -1) { list[i] = { ...list[i], ...updates }; localStorage.setItem('contrusoft_companies', JSON.stringify(list)); }
  } catch {}
}
function _calcSubtotal(budget) {
  return (budget.chapters || []).reduce((s, ch) => s + (ch.items || []).reduce((si, it) => si + (it.subtotal || 0), 0), 0);
}
function _refreshLinks(companyId) {
  const resources = _loadData(MOCK_KEYS.RESOURCES, companyId);
  const apus = _loadData(MOCK_KEYS.APUS, companyId);
  resources.forEach(r => { r.enUso = false; r.apusVinculados = []; });
  apus.filter(a => a.estado === 'activo').forEach(apu => {
    (apu.lineas || []).forEach(l => {
      const i = resources.findIndex(r => r.id === l.resourceId);
      if (i !== -1) { resources[i].enUso = true; if (!resources[i].apusVinculados.includes(apu.codigo)) resources[i].apusVinculados.push(apu.codigo); }
    });
  });
  _saveData(MOCK_KEYS.RESOURCES, companyId, resources);
}

// ============================================================
// FETCH INTERCEPTOR
// ============================================================
const _origFetch = window.fetch.bind(window);
window.fetch = async function(input, init) {
  init = init || {};
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return _origFetch(input, init);

  const method = (init.method || 'GET').toUpperCase();
  let body = {};
  if (init.body) { try { body = JSON.parse(init.body); } catch {} }

  const companyId = _getCompanyId();
  _ensureDemo(companyId);

  const qIdx = url.indexOf('?');
  const pathStr = (qIdx === -1 ? url : url.slice(0, qIdx)).replace('/api/', '');
  const seg = pathStr.split('/');
  const qParams = new URLSearchParams(qIdx === -1 ? '' : url.slice(qIdx + 1));

  // ── UNITS ──────────────────────────────────────────────────
  if (seg[0] === 'units') {
    const c = _getCompanyRec(companyId);
    const units = c.unidadesMedida || [];
    if (method === 'GET' && !seg[1]) return _mk({ success: true, units });
    if ((method === 'POST' || method === 'PUT') && !seg[1]) {
      const newU = { id: 'u_' + Date.now(), ...body, editable: true };
      _saveCompanyField(companyId, { unidadesMedida: [...units, newU] });
      return _mk({ success: true });
    }
    if (method === 'PUT' && seg[1]) {
      const updated = units.map(u => u.id === seg[1] ? { ...u, ...body } : u);
      _saveCompanyField(companyId, { unidadesMedida: updated });
      return _mk({ success: true });
    }
    if (method === 'DELETE' && seg[1]) {
      _saveCompanyField(companyId, { unidadesMedida: units.filter(u => u.id !== seg[1]) });
      return _mk({ success: true });
    }
  }

  // ── RESOURCES ──────────────────────────────────────────────
  if (seg[0] === 'resources') {
    const resources = _loadData(MOCK_KEYS.RESOURCES, companyId);
    if (method === 'GET' && !seg[1]) return _mk({ success: true, resources });
    if (method === 'POST') {
      const r = { id: _nextId(resources), companyId, ...body, enUso: false, apusVinculados: [] };
      resources.push(r);
      _saveData(MOCK_KEYS.RESOURCES, companyId, resources);
      return _mk({ success: true, resource: r });
    }
    if (seg[1]) {
      const id = parseInt(seg[1]);
      const i = resources.findIndex(r => r.id === id);
      if (method === 'GET')    return _mk({ success: true, resource: resources[i] || null });
      if (method === 'PUT')  { if (i !== -1) resources[i] = { ...resources[i], ...body }; _saveData(MOCK_KEYS.RESOURCES, companyId, resources); return _mk({ success: true }); }
      if (method === 'DELETE') {
        if (i !== -1 && resources[i].enUso) return _mk({ success: false, message: 'Recurso en uso en APUs.' }, 400);
        if (i !== -1) resources.splice(i, 1);
        _saveData(MOCK_KEYS.RESOURCES, companyId, resources);
        return _mk({ success: true });
      }
    }
  }

  // ── APUS ───────────────────────────────────────────────────
  if (seg[0] === 'apus') {
    const apus = _loadData(MOCK_KEYS.APUS, companyId);
    if (method === 'GET' && !seg[1]) return _mk({ success: true, apus });
    if (method === 'POST') {
      const a = { id: _nextId(apus), companyId, estado: 'activo', ...body };
      apus.push(a); _saveData(MOCK_KEYS.APUS, companyId, apus); _refreshLinks(companyId);
      return _mk({ success: true, apu: a });
    }
    if (seg[1]) {
      const param = seg[1].trim();
      const numId = parseInt(param, 10);
      let i = apus.findIndex(a => (numId && a.id === numId) || String(a.id) === param || (a.codigo && a.codigo.toLowerCase() === param.toLowerCase()));
      let targetApu = i !== -1 ? apus[i] : DEMO_APUS.find(a => (numId && a.id === numId) || String(a.id) === param || (a.codigo && a.codigo.toLowerCase() === param.toLowerCase()));

      if (seg[2] === 'toggle-active') {
        if (i !== -1) apus[i].estado = apus[i].estado === 'activo' ? 'inactivo' : 'activo';
        _saveData(MOCK_KEYS.APUS, companyId, apus); _refreshLinks(companyId);
        return _mk({ success: true });
      }
      if (method === 'GET')    return _mk({ success: true, apu: targetApu || null });
      if (method === 'PUT')  { if (i !== -1) apus[i] = { ...apus[i], ...body }; _saveData(MOCK_KEYS.APUS, companyId, apus); _refreshLinks(companyId); return _mk({ success: true }); }
      if (method === 'DELETE') { if (i !== -1) apus.splice(i, 1); _saveData(MOCK_KEYS.APUS, companyId, apus); _refreshLinks(companyId); return _mk({ success: true }); }
    }
  }

  // ── BUDGETS ────────────────────────────────────────────────
  if (seg[0] === 'budgets') {
    const budgets = _loadData(MOCK_KEYS.BUDGETS, companyId);

    // check-code
    if (seg[1] === 'check-code') {
      const exists = budgets.some(b => b.codigo === qParams.get('codigo'));
      // presupuestos.js chequea data.available (no data.exists)
      return _mk({ success: true, available: !exists, exists });
    }

    if (method === 'GET' && !seg[1]) {
      return _mk({ success: true, budgets: budgets.map(b => {
        const sub = _calcSubtotal(b);
        const aiu = b.aiu || { administracion: 10, imprevistos: 3, utilidad: 7 };
        const aiuMult = 1 + (aiu.administracion + aiu.imprevistos + aiu.utilidad) / 100;
        // Normalizar estado a capitalized
        const estadoNorm = (b.estado || 'abierto').charAt(0).toUpperCase() + b.estado.slice(1);
        return {
          id: b.id, codigo: b.codigo, nombre: b.nombre, descripcion: b.descripcion,
          estado: estadoNorm,
          ubicacion: b.ubicacion || null,
          moneda: b.moneda || 'COP',
          fechaElaboracion: b.fechaCreacion || null,
          fechaUltimaModificacion: b.fechaCreacion || null,
          totalChapters: (b.chapters||[]).length,
          totalItems: (b.chapters||[]).reduce((s,c)=>s+(c.items||[]).length,0),
          subtotal: sub,
          valorTotal: Math.round(sub * aiuMult),
          aiu: b.aiu
        };
      })});
    }
    if (method === 'POST' && !seg[1]) {
      if (budgets.some(b => b.codigo === body.codigo)) return _mk({ success: false, message: 'Código duplicado.' }, 400);
      const nb = { id: _nextId(budgets), companyId, estado: 'abierto', chapters: [], fechaCreacion: new Date().toISOString().split('T')[0], ...body };
      budgets.push(nb); _saveData(MOCK_KEYS.BUDGETS, companyId, budgets);
      return _mk({ success: true, budget: { id: nb.id } });
    }
    if (seg[1]) {
      const bid = seg[1];
      const bi = budgets.findIndex(b => String(b.id) === String(bid));
      if (!seg[2]) {
        if (method === 'GET') {
          if (bi === -1) return _mk({ success: false }, 404);
          const b = budgets[bi];
          const rawChapters = b.chapters || [];
          const chapters = rawChapters.map(ch => {
            const rawItems = (ch.items || []).filter(it => {
              const isDummyName = !it.nombre || it.nombre === 'Actividad' || it.nombre === 'Nueva Actividad';
              const hasZeroPrice = !it.precioUnitario && !it.precio_unitario && !it.total && !it.subtotal;
              return !(isDummyName && hasZeroPrice);
            });
            ch.items = rawItems;
            const allApus = [..._loadData(MOCK_KEYS.APUS, companyId), ...DEMO_APUS];
            const items = rawItems.map((it, idx) => {
              const apuCode = it.apuCodigo || (it.codigo && it.codigo.startsWith('APU-') ? it.codigo : null);
              const itmCode = (it.codigo && it.codigo.startsWith('ITM-')) ? it.codigo : ('ITM-' + String(idx + 1).padStart(3, '0'));
              const targetApu = allApus.find(a => (it.apuId && String(a.id) === String(it.apuId)) || (apuCode && a.codigo && a.codigo.toLowerCase() === apuCode.toLowerCase()));
              const apuLines = it.apuLines || (targetApu ? (targetApu.lineas || targetApu.lines || []) : []);
              return {
                id: it.id,
                apuId: it.apuId || (targetApu ? targetApu.id : null),
                apuCodigo: apuCode || (targetApu ? targetApu.codigo : null),
                codigo: itmCode,
                nombre: it.nombre || it.descripcion || (targetApu ? targetApu.nombre : 'Actividad'),
                unidad: it.unidad || (targetApu ? targetApu.unidad : 'un'),
                cantidad: it.cantidad !== undefined ? it.cantidad : 1,
                precioUnitario: it.precioUnitario !== undefined ? it.precioUnitario : (it.precio_unitario || (targetApu ? targetApu.costoDirecto : 0)),
                total: it.total !== undefined ? it.total : (it.subtotal !== undefined ? it.subtotal : ((it.cantidad || 1) * (it.precioUnitario || 0))),
                apuLines: apuLines
              };
            });
            const montoAcumulado = ch.montoAcumulado !== undefined ? ch.montoAcumulado : items.reduce((s, i) => s + i.total, 0);
            return {
              id: ch.id,
              parentId: ch.parentId !== undefined ? ch.parentId : null,
              numero: ch.numero || (ch.orden !== undefined ? ('0' + ch.orden) : '01'),
              titulo: ch.titulo || ch.nombre || 'Capítulo',
              tipo: ch.tipo || 'Directo',
              montoAcumulado,
              items,
              subcapitulos: ch.subcapitulos || []
            };
          });

          budgets[bi].chapters = rawChapters;
          _saveData(MOCK_KEYS.BUDGETS, companyId, budgets);

          // Calcular resumen financiero
          const costoDirecto = _calcSubtotal(b);
          const aiu = b.aiu || { administracion: 10, imprevistos: 3, utilidad: 7 };
          const adminVal   = costoDirecto * (aiu.administracion / 100);
          const imprevVal  = costoDirecto * (aiu.imprevistos   / 100);
          const utilVal    = costoDirecto * (aiu.utilidad      / 100);
          const aiuTotal   = adminVal + imprevVal + utilVal;
          const totalFinal = costoDirecto + aiuTotal;
          const resumen = {
            costoDirecto,
            aiuAdminPct: aiu.administracion,
            aiuAdminMonto: adminVal,
            aiuImprevistosPct: aiu.imprevistos,
            aiuImprevistosMonto: imprevVal,
            aiuUtilidadPct: aiu.utilidad,
            aiuUtilidadMonto: utilVal,
            aiuTotalPct: aiu.administracion + aiu.imprevistos + aiu.utilidad,
            montoAiu: aiuTotal,
            costoIndirecto: 0,
            valorTotal: totalFinal
          };
          // Normalizar estado a capitalized (presupuestos.js compara 'Abierto', 'Activo', 'Cerrado')
          const estadoNorm = (b.estado || 'abierto').charAt(0).toUpperCase() + b.estado.slice(1);
          const budgetNorm = { ...b, estado: estadoNorm };
          // presupuestos.js espera data.data.budget + data.data.capitulos + data.data.resumen
          return _mk({ success: true, data: { budget: budgetNorm, capitulos: chapters, resumen } });
        }
        if (method === 'PUT')  { if (bi !== -1) budgets[bi] = { ...budgets[bi], ...body }; _saveData(MOCK_KEYS.BUDGETS, companyId, budgets); return _mk({ success: true }); }
        if (method === 'DELETE') { if (bi !== -1) budgets.splice(bi, 1); _saveData(MOCK_KEYS.BUDGETS, companyId, budgets); return _mk({ success: true }); }
      }
      if (seg[2] === 'chapters' && bi !== -1) {
        const chapters = budgets[bi].chapters || [];
        const save = () => { budgets[bi].chapters = chapters; _saveData(MOCK_KEYS.BUDGETS, companyId, budgets); };
        if (!seg[3]) {
          if (method === 'GET')  return _mk({ success: true, chapters });
          if (method === 'POST') { const nc = { id: _nextId(chapters), budgetId: bid, orden: chapters.length+1, nombre: body.nombre, items: [] }; chapters.push(nc); save(); return _mk({ success: true, chapter: nc }); }
        }
          if (seg[3]) {
            const cid = seg[3];
            const ci = chapters.findIndex(c => String(c.id) === String(cid));
          if (!seg[4]) {
            if (method === 'PUT')    { if (ci !== -1) chapters[ci] = { ...chapters[ci], ...body }; save(); return _mk({ success: true }); }
            if (method === 'DELETE') { if (ci !== -1) chapters.splice(ci, 1); save(); return _mk({ success: true }); }
          }
          if (seg[4] === 'items' && ci !== -1) {
            const items = chapters[ci].items || [];
            const saveI = () => { chapters[ci].items = items; save(); };
            if (!seg[5]) {
              if (method === 'POST') {
                const apuList = _loadData(MOCK_KEYS.APUS, companyId);
                const searchVal = String(body.apuId || '').trim();
                const numVal = parseInt(searchVal, 10);
                const allApus = [...apuList, ...DEMO_APUS];
                const apu = allApus.find(a => 
                  (numVal && a.id === numVal) || 
                  String(a.id) === searchVal || 
                  (a.codigo && a.codigo.toLowerCase() === searchVal.toLowerCase())
                );

                const cant = parseFloat(body.cantidad || 1.0);
                const pUnit = apu ? (apu.costoDirecto || apu.costo_directo || apu.precioTotal || 0) : (parseFloat(body.precioUnitario) || 0);
                const itemCode = apu ? apu.codigo : (body.codigo || ('ITM-' + String(items.length + 1).padStart(3, '0')));
                const itemName = apu ? apu.nombre : (body.nombre || body.descripcion || 'Nueva Actividad');
                const itemUnit = apu ? apu.unidad : (body.unidad || 'un');

                const ni = {
                  id: _nextId(items),
                  chapterId: cid,
                  apuId: apu ? apu.id : numVal,
                  codigo: itemCode,
                  nombre: itemName,
                  unidad: itemUnit,
                  cantidad: cant,
                  precioUnitario: pUnit,
                  subtotal: Math.round(cant * pUnit),
                  total: Math.round(cant * pUnit)
                };
                items.push(ni); saveI(); return _mk({ success: true, item: ni });
              }
            }
            if (seg[5]) {
              const iid = parseInt(seg[5]);
              const ii = items.findIndex(x => x.id === iid);
              if (method === 'PUT') {
                if (ii !== -1) {
                  const cant = parseFloat(body.cantidad !== undefined ? body.cantidad : items[ii].cantidad);
                  const pUnit = items[ii].precioUnitario !== undefined ? items[ii].precioUnitario : (items[ii].precio_unitario || 0);
                  items[ii] = { ...items[ii], ...body, cantidad: cant, subtotal: Math.round(cant * pUnit), total: Math.round(cant * pUnit) };
                }
                saveI(); return _mk({ success: true });
              }
              if (method === 'DELETE') { if (ii !== -1) items.splice(ii, 1); saveI(); return _mk({ success: true }); }
            }
          }
        }
      }
    }
  }

  // ── COMPANIES ──────────────────────────────────────────────
  if (seg[0] === 'companies' && seg[1]) {
    const cId = seg[1]; const action = seg[2];
    const c = _getCompanyRec(cId);

    if (action === 'config')    return _mk({ success: true, config: { ...c, preferences: c.preferences||{moneda:'COP',separadores:'punto_coma',decimales:'0'}, aiuDefaults: c.aiuDefaults||{administracion:10,imprevistos:3,utilidad:7}, notificaciones: c.notificaciones||{} }});
    if (action === 'info' && method === 'PUT') { _saveCompanyField(cId, body); return _mk({ success: true }); }
    if (action === 'preferences' && method === 'PUT') { _saveCompanyField(cId, { preferences: body }); return _mk({ success: true }); }
    if (action === 'aiu-defaults' && method === 'PUT') { _saveCompanyField(cId, { aiuDefaults: body }); return _mk({ success: true }); }
    if (action === 'notifications' && method === 'PUT') { _saveCompanyField(cId, { notificaciones: body }); return _mk({ success: true }); }
    if (action === 'billing') {
      const pays = JSON.parse(localStorage.getItem('contrusoft_payments')||'[]');
      return _mk({ success: true, billing: pays.filter(p => p.companyId === cId) });
    }
    if (action === 'users') {
      const allU = JSON.parse(localStorage.getItem('contrusoft_users')||'[]');
      if (method === 'GET') return _mk({ success: true, users: allU.filter(u => u.companyId === cId) });
      if (method === 'POST') {
        const nu = { id: 'user_'+Date.now(), companyId: cId, activo: true, requiereCambioClave: true, ...body };
        allU.push(nu); localStorage.setItem('contrusoft_users', JSON.stringify(allU));
        return _mk({ success: true, user: nu });
      }
    }
    if (action === 'roles') {
      const roles = JSON.parse(localStorage.getItem('construsoft_roles_'+cId)||'[]');
      if (method === 'GET') return _mk({ success: true, roles });
      if (method === 'POST') {
        const nr = { id: 'rol_'+Date.now(), companyId: cId, ...body };
        roles.push(nr); localStorage.setItem('construsoft_roles_'+cId, JSON.stringify(roles));
        return _mk({ success: true, role: nr });
      }
      if (seg[3] && method === 'DELETE') {
        localStorage.setItem('construsoft_roles_'+cId, JSON.stringify(roles.filter(r => r.id !== seg[3])));
        return _mk({ success: true });
      }
      if (seg[3] && method === 'PUT') {
        const ri = roles.findIndex(r => r.id === seg[3]);
        if (ri !== -1) roles[ri] = { ...roles[ri], ...body };
        localStorage.setItem('construsoft_roles_'+cId, JSON.stringify(roles));
        return _mk({ success: true });
      }
    }
  }

  // ── USERS ──────────────────────────────────────────────────
  if (seg[0] === 'users' && seg[1]) {
    const uid = seg[1]; const action = seg[2];
    const allU = JSON.parse(localStorage.getItem('contrusoft_users')||'[]');
    const ui = allU.findIndex(u => u.id === uid);
    if (action === 'change-password') {
      if (ui !== -1) { allU[ui].password = body.newPassword; allU[ui].requiereCambioClave = false; localStorage.setItem('contrusoft_users', JSON.stringify(allU)); }
      const cu = _getUser(); if (cu.id === uid) { cu.requiereCambioClave = false; localStorage.setItem('contrusoft_current_user', JSON.stringify(cu)); }
      return _mk({ success: true });
    }
    if (action === 'status') {
      if (ui !== -1) { allU[ui].activo = body.activo; localStorage.setItem('contrusoft_users', JSON.stringify(allU)); }
      return _mk({ success: true });
    }
  }

  console.warn('[api-mock] Sin mapeo:', method, url);
  return _mk({ success: false, message: 'Endpoint no mapeado.' }, 501);
};

console.log('[api-mock] ✓ Activo — /api/* resuelto con localStorage + datos de demo');
