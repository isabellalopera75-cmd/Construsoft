/**
 * ConstruSoft - Almacenamiento y Mock Data (LocalStorage)
 * Gestiona inquilinos, usuarios, roles, suscripciones, pagos y las 12 unidades estándar.
 *
 * Estados de suscripción:
 *  - 'trial'     : Período de prueba de 15 días
 *  - 'active'    : Suscripción activa y al día
 *  - 'pending'   : Pago no registrado (5 días de gracia tras la fecha de vencimiento)
 *  - 'expired'   : Vencida definitivamente (pasaron los 5 días de gracia)
 *  - 'cancelled' : Cancelación manual por el Administrador del tenant
 *  - 'suspended' : Suspendida manualmente por el Superadministrador (D-25)
 */

const STORAGE_KEYS = {
  USERS: 'contrusoft_users',
  COMPANIES: 'contrusoft_companies',
  CURRENT_USER: 'contrusoft_current_user',
  SUPERADMIN: 'contrusoft_superadmin',
  SUPERADMIN_SESSION: 'contrusoft_superadmin_session',
  PAYMENTS: 'contrusoft_payments'
};

// 12 Unidades de Medida Estándar obligatorias (Precarga del sistema)
const DEFAULT_MEASUREMENT_UNITS = [
  { id: 'u1',  codigo: 'm',   nombre: 'Metro lineal',       categoria: 'Longitud',        editable: true },
  { id: 'u2',  codigo: 'm²',  nombre: 'Metro cuadrado',     categoria: 'Superficie',       editable: true },
  { id: 'u3',  codigo: 'm³',  nombre: 'Metro cúbico',       categoria: 'Volumen',          editable: true },
  { id: 'u4',  codigo: 'kg',  nombre: 'Kilogramo',          categoria: 'Peso',             editable: true },
  { id: 'u5',  codigo: 'ton', nombre: 'Tonelada',           categoria: 'Peso',             editable: true },
  { id: 'u6',  codigo: 'gl',  nombre: 'Galón',              categoria: 'Volumen líquido',  editable: true },
  { id: 'u7',  codigo: 'un',  nombre: 'Unidad',             categoria: 'Conteo',           editable: true },
  { id: 'u8',  codigo: 'hr',  nombre: 'Hora (MO/Equipo)',   categoria: 'Tiempo',           editable: true },
  { id: 'u9',  codigo: 'mes', nombre: 'Mes',                categoria: 'Tiempo',           editable: true },
  { id: 'u10', codigo: 'pza', nombre: 'Pieza',              categoria: 'Conteo',           editable: true },
  { id: 'u11', codigo: 'sac', nombre: 'Saco / Bulto (50kg)',categoria: 'Empaque',          editable: true },
  { id: 'u12', codigo: 'jor', nombre: 'Jornal',             categoria: 'Mano de obra',     editable: true }
];

// Empresas de demostración — cubre todos los estados posibles del sistema
const INITIAL_COMPANIES = [
  {
    id: 'comp_01',
    razonSocial: 'Ingeniería y Construcciones Andinas S.A.S.',
    nit: '901.458.789-3',
    logoUrl: null,
    plan: 'Empresarial',
    estadoSuscripcion: 'trial',
    diasPruebaRestantes: 11,
    fechaRegistro: '2026-09-08',
    fechaVencimiento: '2026-09-23',
    unidadesMedida: [...DEFAULT_MEASUREMENT_UNITS]
  },
  {
    id: 'comp_02',
    razonSocial: 'Pérez & Asociados Consultores Civiles',
    nit: '800.124.952-1',
    logoUrl: null,
    plan: 'Personal',
    estadoSuscripcion: 'active',
    diasPruebaRestantes: 0,
    fechaRegistro: '2026-05-10',
    fechaVencimiento: '2026-10-10',
    unidadesMedida: [...DEFAULT_MEASUREMENT_UNITS]
  },
  {
    id: 'comp_03',
    razonSocial: 'Obras y Pavimentos del Norte Ltda.',
    nit: '900.871.233-6',
    logoUrl: null,
    plan: 'Empresarial',
    estadoSuscripcion: 'pending',
    diasPruebaRestantes: 0,
    fechaRegistro: '2026-01-15',
    fechaVencimiento: '2026-09-17',
    unidadesMedida: [...DEFAULT_MEASUREMENT_UNITS]
  },
  {
    id: 'comp_04',
    razonSocial: 'Estructuras Metálicas Bolívar',
    nit: '901.112.554-0',
    logoUrl: null,
    plan: 'Empresarial',
    estadoSuscripcion: 'suspended',
    diasPruebaRestantes: 0,
    fechaRegistro: '2026-03-20',
    fechaVencimiento: '2026-08-20',
    unidadesMedida: [...DEFAULT_MEASUREMENT_UNITS]
  },
  {
    id: 'comp_05',
    razonSocial: 'Constructora Alianza del Pacífico',
    nit: '900.334.812-5',
    logoUrl: null,
    plan: 'Personal',
    estadoSuscripcion: 'expired',
    diasPruebaRestantes: 0,
    fechaRegistro: '2026-02-01',
    fechaVencimiento: '2026-09-01',
    unidadesMedida: [...DEFAULT_MEASUREMENT_UNITS]
  },
  {
    id: 'comp_06',
    razonSocial: 'Ingecivil Montoya & Cía S.A.S.',
    nit: '901.774.325-8',
    logoUrl: null,
    plan: 'Empresarial',
    estadoSuscripcion: 'cancelled',
    diasPruebaRestantes: 0,
    fechaRegistro: '2026-04-12',
    fechaVencimiento: '2026-09-12',
    fechaCancelacion: '2026-09-10',
    unidadesMedida: [...DEFAULT_MEASUREMENT_UNITS]
  }
];

// Cuentas de demostración iniciales
const INITIAL_USERS = [
  {
    id: 'usr_01',
    nombre: 'Ing. Carlos Mendoza',
    email: 'empresarial@gmail.com',
    password: '123456',
    rol: 'Administrador',
    companyId: 'comp_01',
    requiereCambioClave: false
  },
  {
    id: 'usr_02',
    nombre: 'Ing. Juan Pérez',
    email: 'personal@gmail.com',
    password: '123456',
    rol: 'Administrador',
    companyId: 'comp_02',
    requiereCambioClave: false
  },
  {
    id: 'usr_03',
    nombre: 'Arq. Andrés Morales',
    email: 'moroso@obras.com',
    password: 'Constru2026!',
    rol: 'Administrador',
    companyId: 'comp_03',
    requiereCambioClave: false
  },
  {
    id: 'usr_04',
    nombre: 'Ing. Sofía Valderrama',
    email: 'bloqueado@ingenieria.com',
    password: 'Constru2026!',
    rol: 'Administrador',
    companyId: 'comp_04',
    requiereCambioClave: false
  },
  {
    id: 'usr_05',
    nombre: 'Residente Laura Gómez',
    email: 'nuevo@constructora.com',
    password: 'Temp1234!',
    rol: 'Residente de Obra',
    companyId: 'comp_01',
    requiereCambioClave: true
  },
  {
    id: 'usr_06',
    nombre: 'Ing. Ricardo Ospina',
    email: 'admin@alianza.com',
    password: 'Constru2026!',
    rol: 'Administrador',
    companyId: 'comp_05',
    requiereCambioClave: false
  },
  {
    id: 'usr_07',
    nombre: 'Arq. Valentina Montoya',
    email: 'admin@ingecivil.com',
    password: 'Constru2026!',
    rol: 'Administrador',
    companyId: 'comp_06',
    requiereCambioClave: false
  }
];

// Historial de pagos simulados (mock)
const INITIAL_PAYMENTS = [
  // comp_01 — Empresarial, trial actualmente (solo tiene el cobro pendiente del primer mes)
  {
    id: 'pay_001',
    companyId: 'comp_01',
    plan: 'Empresarial',
    periodo: 'Oct 2026',
    fechaPago: null,
    fechaVencimiento: '2026-10-08',
    monto: 380000,
    estado: 'pendiente',
    referencia: null,
    notas: 'Primer período post-prueba'
  },

  // comp_02 — Personal, activa. Varios pagos históricos
  {
    id: 'pay_010',
    companyId: 'comp_02',
    plan: 'Personal',
    periodo: 'Jun 2026',
    fechaPago: '2026-06-08',
    fechaVencimiento: '2026-06-10',
    monto: 120000,
    estado: 'pagado',
    referencia: 'TRF-20260608-001',
    notas: ''
  },
  {
    id: 'pay_011',
    companyId: 'comp_02',
    plan: 'Personal',
    periodo: 'Jul 2026',
    fechaPago: '2026-07-09',
    fechaVencimiento: '2026-07-10',
    monto: 120000,
    estado: 'pagado',
    referencia: 'TRF-20260709-002',
    notas: ''
  },
  {
    id: 'pay_012',
    companyId: 'comp_02',
    plan: 'Personal',
    periodo: 'Ago 2026',
    fechaPago: '2026-08-10',
    fechaVencimiento: '2026-08-10',
    monto: 120000,
    estado: 'pagado',
    referencia: 'TRF-20260810-003',
    notas: ''
  },
  {
    id: 'pay_013',
    companyId: 'comp_02',
    plan: 'Personal',
    periodo: 'Sep 2026',
    fechaPago: '2026-09-09',
    fechaVencimiento: '2026-09-10',
    monto: 120000,
    estado: 'pagado',
    referencia: 'TRF-20260909-004',
    notas: ''
  },
  {
    id: 'pay_014',
    companyId: 'comp_02',
    plan: 'Personal',
    periodo: 'Oct 2026',
    fechaPago: null,
    fechaVencimiento: '2026-10-10',
    monto: 120000,
    estado: 'pendiente',
    referencia: null,
    notas: ''
  },

  // comp_03 — Empresarial, pending (en gracia). Último pago vencido
  {
    id: 'pay_020',
    companyId: 'comp_03',
    plan: 'Empresarial',
    periodo: 'Feb 2026',
    fechaPago: '2026-02-14',
    fechaVencimiento: '2026-02-15',
    monto: 380000,
    estado: 'pagado',
    referencia: 'TRF-20260214-005',
    notas: ''
  },
  {
    id: 'pay_021',
    companyId: 'comp_03',
    plan: 'Empresarial',
    periodo: 'Mar 2026',
    fechaPago: '2026-03-15',
    fechaVencimiento: '2026-03-15',
    monto: 380000,
    estado: 'pagado',
    referencia: 'TRF-20260315-006',
    notas: ''
  },
  {
    id: 'pay_022',
    companyId: 'comp_03',
    plan: 'Empresarial',
    periodo: 'Abr 2026',
    fechaPago: '2026-04-13',
    fechaVencimiento: '2026-04-15',
    monto: 380000,
    estado: 'pagado',
    referencia: 'TRF-20260413-007',
    notas: ''
  },
  {
    id: 'pay_023',
    companyId: 'comp_03',
    plan: 'Empresarial',
    periodo: 'May 2026',
    fechaPago: '2026-05-15',
    fechaVencimiento: '2026-05-15',
    monto: 380000,
    estado: 'pagado',
    referencia: 'TRF-20260515-008',
    notas: ''
  },
  {
    id: 'pay_024',
    companyId: 'comp_03',
    plan: 'Empresarial',
    periodo: 'Jun 2026',
    fechaPago: '2026-06-14',
    fechaVencimiento: '2026-06-15',
    monto: 380000,
    estado: 'pagado',
    referencia: 'TRF-20260614-009',
    notas: ''
  },
  {
    id: 'pay_025',
    companyId: 'comp_03',
    plan: 'Empresarial',
    periodo: 'Jul 2026',
    fechaPago: '2026-07-16',
    fechaVencimiento: '2026-07-15',
    monto: 380000,
    estado: 'pagado',
    referencia: 'TRF-20260716-010',
    notas: 'Pago con 1 día de retraso'
  },
  {
    id: 'pay_026',
    companyId: 'comp_03',
    plan: 'Empresarial',
    periodo: 'Ago 2026',
    fechaPago: '2026-08-15',
    fechaVencimiento: '2026-08-15',
    monto: 380000,
    estado: 'pagado',
    referencia: 'TRF-20260815-011',
    notas: ''
  },
  {
    id: 'pay_027',
    companyId: 'comp_03',
    plan: 'Empresarial',
    periodo: 'Sep 2026',
    fechaPago: null,
    fechaVencimiento: '2026-09-17',
    monto: 380000,
    estado: 'vencido',
    referencia: null,
    notas: 'En período de gracia (5 días)'
  },

  // comp_04 — Empresarial, suspendida por superadmin
  {
    id: 'pay_030',
    companyId: 'comp_04',
    plan: 'Empresarial',
    periodo: 'Abr 2026',
    fechaPago: '2026-04-19',
    fechaVencimiento: '2026-04-20',
    monto: 380000,
    estado: 'pagado',
    referencia: 'TRF-20260419-012',
    notas: ''
  },
  {
    id: 'pay_031',
    companyId: 'comp_04',
    plan: 'Empresarial',
    periodo: 'May 2026',
    fechaPago: '2026-05-18',
    fechaVencimiento: '2026-05-20',
    monto: 380000,
    estado: 'pagado',
    referencia: 'TRF-20260518-013',
    notas: ''
  },
  {
    id: 'pay_032',
    companyId: 'comp_04',
    plan: 'Empresarial',
    periodo: 'Jun 2026',
    fechaPago: null,
    fechaVencimiento: '2026-06-20',
    monto: 380000,
    estado: 'vencido',
    referencia: null,
    notas: ''
  },
  {
    id: 'pay_033',
    companyId: 'comp_04',
    plan: 'Empresarial',
    periodo: 'Jul 2026',
    fechaPago: null,
    fechaVencimiento: '2026-07-20',
    monto: 380000,
    estado: 'vencido',
    referencia: null,
    notas: ''
  },
  {
    id: 'pay_034',
    companyId: 'comp_04',
    plan: 'Empresarial',
    periodo: 'Ago 2026',
    fechaPago: null,
    fechaVencimiento: '2026-08-20',
    monto: 380000,
    estado: 'vencido',
    referencia: null,
    notas: 'Cuenta suspendida por deuda acumulada (D-25)'
  },

  // comp_05 — Personal, expired
  {
    id: 'pay_040',
    companyId: 'comp_05',
    plan: 'Personal',
    periodo: 'Jun 2026',
    fechaPago: '2026-06-02',
    fechaVencimiento: '2026-07-01',
    monto: 120000,
    estado: 'pagado',
    referencia: 'TRF-20260602-014',
    notas: ''
  },
  {
    id: 'pay_041',
    companyId: 'comp_05',
    plan: 'Personal',
    periodo: 'Jul 2026',
    fechaPago: '2026-07-01',
    fechaVencimiento: '2026-08-01',
    monto: 120000,
    estado: 'pagado',
    referencia: 'TRF-20260701-015',
    notas: ''
  },
  {
    id: 'pay_042',
    companyId: 'comp_05',
    plan: 'Personal',
    periodo: 'Ago 2026',
    fechaPago: null,
    fechaVencimiento: '2026-09-01',
    monto: 120000,
    estado: 'vencido',
    referencia: null,
    notas: 'Suscripción expirada sin renovación'
  },

  // comp_06 — Empresarial, cancelled
  {
    id: 'pay_050',
    companyId: 'comp_06',
    plan: 'Empresarial',
    periodo: 'May 2026',
    fechaPago: '2026-05-12',
    fechaVencimiento: '2026-05-12',
    monto: 380000,
    estado: 'pagado',
    referencia: 'TRF-20260512-016',
    notas: ''
  },
  {
    id: 'pay_051',
    companyId: 'comp_06',
    plan: 'Empresarial',
    periodo: 'Jun 2026',
    fechaPago: '2026-06-12',
    fechaVencimiento: '2026-06-12',
    monto: 380000,
    estado: 'pagado',
    referencia: 'TRF-20260612-017',
    notas: ''
  },
  {
    id: 'pay_052',
    companyId: 'comp_06',
    plan: 'Empresarial',
    periodo: 'Jul 2026',
    fechaPago: '2026-07-12',
    fechaVencimiento: '2026-07-12',
    monto: 380000,
    estado: 'pagado',
    referencia: 'TRF-20260712-018',
    notas: ''
  },
  {
    id: 'pay_053',
    companyId: 'comp_06',
    plan: 'Empresarial',
    periodo: 'Ago 2026',
    fechaPago: '2026-08-11',
    fechaVencimiento: '2026-08-12',
    monto: 380000,
    estado: 'pagado',
    referencia: 'TRF-20260811-019',
    notas: ''
  },
  {
    id: 'pay_054',
    companyId: 'comp_06',
    plan: 'Empresarial',
    periodo: 'Sep 2026',
    fechaPago: null,
    fechaVencimiento: '2026-09-12',
    monto: 380000,
    estado: 'cancelado',
    referencia: null,
    notas: 'Suscripción cancelada por el administrador el 2026-09-10'
  }
];

// Superadministrador de plataforma (URL propia)
const SUPERADMIN_ACCOUNT = {
  id: 'super_01',
  nombre: 'Superadministrador de Plataforma',
  email: 'root@contrusoft.internal',
  password: 'Master2026!',
  rol: 'SuperAdmin'
};

// ============================================================
// INICIALIZACIÓN
// ============================================================

function initStorage() {
  if (!localStorage.getItem(STORAGE_KEYS.USERS)) {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(INITIAL_USERS));
  }
  if (!localStorage.getItem(STORAGE_KEYS.COMPANIES)) {
    localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(INITIAL_COMPANIES));
  }
  if (!localStorage.getItem(STORAGE_KEYS.SUPERADMIN)) {
    localStorage.setItem(STORAGE_KEYS.SUPERADMIN, JSON.stringify(SUPERADMIN_ACCOUNT));
  }
  if (!localStorage.getItem(STORAGE_KEYS.PAYMENTS)) {
    localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(INITIAL_PAYMENTS));
  }
}

// ============================================================
// EMPRESAS
// ============================================================

function getUsers() {
  initStorage();
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
}

function getCompanies() {
  initStorage();
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPANIES) || '[]');
}

function getCompanyById(id) {
  const companies = getCompanies();
  return companies.find(c => c.id === id) || null;
}

function getUsersByCompany(companyId) {
  const users = getUsers();
  return users.filter(u => u.companyId === companyId);
}

// ============================================================
// USUARIO EN SESIÓN
// ============================================================

function getCurrentUser() {
  const userJson = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
  if (!userJson) return null;
  const user = JSON.parse(userJson);
  const company = getCompanyById(user.companyId);
  return { ...user, company };
}

function setCurrentUser(user) {
  localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
}

function clearCurrentUser() {
  localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
}

// ============================================================
// AUTENTICACIÓN
// ============================================================

function authenticateUser(email, password) {
  const users = getUsers();
  const cleanEmail = email.trim().toLowerCase();
  const user = users.find(u => u.email.toLowerCase() === cleanEmail);

  if (!user) {
    return { success: false, message: 'Credenciales inválidas. Correo o contraseña incorrectos.' };
  }

  if (user.password !== password) {
    return { success: false, message: 'Credenciales inválidas. Correo o contraseña incorrectos.' };
  }

  const company = getCompanyById(user.companyId);
  if (!company) {
    return { success: false, message: 'Error de integridad: La empresa asociada no fue encontrada.' };
  }

  return {
    success: true,
    user: { ...user, company },
    requiereCambioClave: user.requiereCambioClave
  };
}

// ============================================================
// CONTRASEÑAS
// ============================================================

function updateTemporaryPassword(userId, newPassword) {
  const users = getUsers();
  const userIndex = users.findIndex(u => u.id === userId);
  if (userIndex === -1) return { success: false, message: 'Usuario no encontrado.' };

  users[userIndex].password = newPassword;
  users[userIndex].requiereCambioClave = false;
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));

  const current = getCurrentUser();
  if (current && current.id === userId) {
    current.password = newPassword;
    current.requiereCambioClave = false;
    setCurrentUser(current);
  }

  return { success: true, message: 'Contraseña actualizada exitosamente.' };
}

// ============================================================
// REGISTRO DE NUEVO TENANT
// ============================================================

function registerNewTenant({ cuenta, empresa, plan }) {
  const users = getUsers();
  const companies = getCompanies();

  const exists = users.some(u => u.email.toLowerCase() === cuenta.email.trim().toLowerCase());
  if (exists) {
    return { success: false, message: 'El correo ya se encuentra registrado en la plataforma.' };
  }

  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + 15);
  const fechaVencimiento = trialEndDate.toISOString().split('T')[0];

  const newCompanyId = 'comp_' + Date.now();
  const newCompany = {
    id: newCompanyId,
    razonSocial: empresa.razonSocial,
    nit: empresa.nit,
    logoUrl: empresa.logoData || null,
    plan: plan, // 'Personal' | 'Empresarial'
    estadoSuscripcion: 'trial',
    diasPruebaRestantes: 15,
    fechaRegistro: new Date().toISOString().split('T')[0],
    fechaVencimiento: fechaVencimiento,
    unidadesMedida: [...DEFAULT_MEASUREMENT_UNITS]
  };

  const newUserId = 'usr_' + Date.now();
  const newUser = {
    id: newUserId,
    nombre: cuenta.nombre,
    email: cuenta.email.trim().toLowerCase(),
    password: cuenta.password,
    rol: 'Administrador',
    companyId: newCompanyId,
    requiereCambioClave: false
  };

  companies.push(newCompany);
  users.push(newUser);

  localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(companies));
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));

  setCurrentUser({ ...newUser, company: newCompany });

  return { success: true, user: newUser, company: newCompany };
}

// ============================================================
// SUPERADMINISTRADOR
// ============================================================

function authenticateSuperAdmin(email, password) {
  initStorage();
  const superAdmin = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUPERADMIN));
  if (superAdmin.email.toLowerCase() === email.trim().toLowerCase() && superAdmin.password === password) {
    sessionStorage.setItem(STORAGE_KEYS.SUPERADMIN_SESSION, JSON.stringify(superAdmin));
    return { success: true, superAdmin };
  }
  return { success: false, message: 'Acceso no autorizado al portal de Superadministrador.' };
}

function getSuperAdminSession() {
  const data = sessionStorage.getItem(STORAGE_KEYS.SUPERADMIN_SESSION);
  return data ? JSON.parse(data) : null;
}

function clearSuperAdminSession() {
  sessionStorage.removeItem(STORAGE_KEYS.SUPERADMIN_SESSION);
}

/**
 * Superadmin cambia el estado de suscripción de una empresa.
 * Estados válidos: 'trial', 'active', 'pending', 'expired', 'cancelled', 'suspended'
 */
function updateCompanySubscription(companyId, nuevoEstado, diasPrueba = 0) {
  const companies = getCompanies();
  const comp = companies.find(c => c.id === companyId);
  if (!comp) return false;

  comp.estadoSuscripcion = nuevoEstado;

  if (nuevoEstado === 'trial') {
    comp.diasPruebaRestantes = diasPrueba > 0 ? diasPrueba : 15;
    const end = new Date();
    end.setDate(end.getDate() + comp.diasPruebaRestantes);
    comp.fechaVencimiento = end.toISOString().split('T')[0];
  }

  if (nuevoEstado === 'cancelled') {
    comp.fechaCancelacion = new Date().toISOString().split('T')[0];
  }

  if (nuevoEstado === 'active') {
    // Al activar, extiende la fecha de vencimiento un mes desde hoy
    const end = new Date();
    end.setMonth(end.getMonth() + 1);
    comp.fechaVencimiento = end.toISOString().split('T')[0];
  }

  localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(companies));

  // Si la empresa modificada es la del usuario en sesión, actualizar localStorage
  const current = getCurrentUser();
  if (current && current.companyId === companyId) {
    current.company.estadoSuscripcion = nuevoEstado;
    current.company.diasPruebaRestantes = comp.diasPruebaRestantes;
    current.company.fechaVencimiento = comp.fechaVencimiento;
    setCurrentUser(current);
  }
  return true;
}

/**
 * Cancelación de suscripción iniciada por el Administrador del tenant.
 * Cambia el estado a 'cancelled' y registra la fecha.
 */
function cancelSubscriptionByTenant(companyId) {
  return updateCompanySubscription(companyId, 'cancelled');
}

// ============================================================
// PAGOS
// ============================================================

function getPayments() {
  initStorage();
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.PAYMENTS) || '[]');
}

function getPaymentsByCompany(companyId) {
  const payments = getPayments();
  return payments.filter(p => p.companyId === companyId).sort((a, b) => b.id.localeCompare(a.id));
}

/**
 * Registra el pago de un período (lo marca como 'pagado' y guarda referencia).
 * Si el pago era el último vencido, puede activar la suscripción via updateCompanySubscription.
 */
function registerPayment(companyId, periodoId, referencia, notas = '') {
  const payments = getPayments();
  const idx = payments.findIndex(p => p.id === periodoId && p.companyId === companyId);
  if (idx === -1) return { success: false, message: 'Registro de pago no encontrado.' };

  payments[idx].estado = 'pagado';
  payments[idx].fechaPago = new Date().toISOString().split('T')[0];
  payments[idx].referencia = referencia;
  payments[idx].notas = notas;

  localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(payments));

  // Si la empresa estaba en pending o expired, pasarla a active
  const company = getCompanyById(companyId);
  if (company && ['pending', 'expired'].includes(company.estadoSuscripcion)) {
    updateCompanySubscription(companyId, 'active');
  }

  return { success: true, payment: payments[idx] };
}

/**
 * Agrega un nuevo registro de pago pendiente para un período.
 */
function addPaymentRecord(companyId, plan, periodo, monto, fechaVencimiento) {
  const payments = getPayments();
  const newPayment = {
    id: 'pay_' + Date.now(),
    companyId,
    plan,
    periodo,
    fechaPago: null,
    fechaVencimiento,
    monto,
    estado: 'pendiente',
    referencia: null,
    notas: ''
  };
  payments.push(newPayment);
  localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(payments));
  return newPayment;
}

// ============================================================
// MÉTRICAS DEL SISTEMA (para SuperAdmin)
// ============================================================

function getSystemMetrics() {
  const companies = getCompanies();
  const users = getUsers();
  const payments = getPayments();

  const PLAN_PRICES = { 'Personal': 120000, 'Empresarial': 380000 };

  const byStatus = {
    trial: companies.filter(c => c.estadoSuscripcion === 'trial').length,
    active: companies.filter(c => c.estadoSuscripcion === 'active').length,
    pending: companies.filter(c => c.estadoSuscripcion === 'pending').length,
    expired: companies.filter(c => c.estadoSuscripcion === 'expired').length,
    cancelled: companies.filter(c => c.estadoSuscripcion === 'cancelled').length,
    suspended: companies.filter(c => c.estadoSuscripcion === 'suspended').length
  };

  const byPlan = {
    Personal: companies.filter(c => c.plan === 'Personal').length,
    Empresarial: companies.filter(c => c.plan === 'Empresarial').length
  };

  // MRR: cuentas activas × precio del plan
  const mrr = companies
    .filter(c => c.estadoSuscripcion === 'active')
    .reduce((sum, c) => sum + (PLAN_PRICES[c.plan] || 0), 0);

  // ARR: MRR × 12
  const arr = mrr * 12;

  // Ingresos históricos totales (pagos con estado 'pagado')
  const totalCollected = payments
    .filter(p => p.estado === 'pagado')
    .reduce((sum, p) => sum + p.monto, 0);

  // Pagos pendientes de cobro
  const pendingRevenue = payments
    .filter(p => ['pendiente', 'vencido'].includes(p.estado))
    .reduce((sum, p) => sum + p.monto, 0);

  return {
    totalTenants: companies.length,
    totalUsers: users.length,
    byStatus,
    byPlan,
    mrr,
    arr,
    totalCollected,
    pendingRevenue,
    companies,
    payments
  };
}

// Inicializar al cargar
initStorage();

// ============================================================
// AUTH — Login y Registro (100% localStorage, sin backend)
// ============================================================

function loginUser(email, password) {
  const users = getUsers();
  const user = users.find(u => u.email === email && u.password === password);

  if (!user) {
    return { success: false, message: 'Correo o contraseña incorrectos.' };
  }

  const companies = getCompanies();
  const company = companies.find(c => c.id === user.companyId);

  if (!company) {
    return { success: false, message: 'No se encontró la empresa asociada a este usuario.' };
  }

  const blockedStates = ['cancelled', 'suspended', 'expired'];
  if (blockedStates.includes(company.estadoSuscripcion)) {
    const msgs = {
      cancelled: 'Esta suscripción ha sido cancelada. Contacte al soporte.',
      suspended: 'Esta cuenta está suspendida por falta de pago. Contacte al soporte.',
      expired:   'La suscripción venció. Por favor renueve su plan para continuar.'
    };
    return { success: false, message: msgs[company.estadoSuscripcion] };
  }

  const sessionUser = {
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    rol: user.rol,
    companyId: user.companyId,
    requiereCambioClave: user.requiereCambioClave || false,
    company: {
      id: company.id,
      razonSocial: company.razonSocial,
      nit: company.nit,
      plan: company.plan,
      estadoSuscripcion: company.estadoSuscripcion,
      fechaVencimiento: company.fechaVencimiento,
      logoUrl: company.logoUrl || null
    }
  };

  return { success: true, user: sessionUser };
}

function registerCompany(cuenta, empresa, plan) {
  const users = getUsers();
  const companies = getCompanies();

  // Verificar email duplicado
  if (users.find(u => u.email === cuenta.email)) {
    return { success: false, message: 'Ya existe una cuenta registrada con ese correo electrónico.' };
  }

  // Verificar NIT duplicado
  if (companies.find(c => c.nit === empresa.nit)) {
    return { success: false, message: 'Ya existe una empresa registrada con ese NIT.' };
  }

  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + 15);
  const fmt = d => d.toISOString().split('T')[0];

  const companyId = 'comp_' + Date.now();
  const userId    = 'user_' + Date.now();

  const newCompany = {
    id: companyId,
    razonSocial: empresa.razonSocial,
    nit: empresa.nit,
    logoUrl: empresa.logoData || null,
    plan,
    estadoSuscripcion: 'trial',
    diasPruebaRestantes: 15,
    fechaRegistro: fmt(now),
    fechaVencimiento: fmt(trialEnd),
    unidadesMedida: [...DEFAULT_MEASUREMENT_UNITS]
  };

  const newUser = {
    id: userId,
    companyId,
    nombre: cuenta.nombre,
    email: cuenta.email,
    password: cuenta.password,
    rol: 'Administrador',
    activo: true,
    requiereCambioClave: false,
    permisos: null
  };

  companies.push(newCompany);
  users.push(newUser);

  localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(companies));
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));

  const sessionUser = {
    id: newUser.id,
    nombre: newUser.nombre,
    email: newUser.email,
    rol: newUser.rol,
    companyId,
    requiereCambioClave: false,
    company: {
      id: companyId,
      razonSocial: newCompany.razonSocial,
      nit: newCompany.nit,
      plan: newCompany.plan,
      estadoSuscripcion: newCompany.estadoSuscripcion,
      fechaVencimiento: newCompany.fechaVencimiento,
      logoUrl: newCompany.logoUrl
    }
  };

  return { success: true, user: sessionUser };
}
