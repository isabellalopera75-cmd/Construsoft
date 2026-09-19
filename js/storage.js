/**
 * ConstruSoft - Almacenamiento y Mock Data (LocalStorage)
 * Gestiona inquilinos, usuarios, roles, suscripciones y las 12 unidades estándar.
 */

const STORAGE_KEYS = {
  USERS: 'contrusoft_users',
  COMPANIES: 'contrusoft_companies',
  CURRENT_USER: 'contrusoft_current_user',
  SUPERADMIN: 'contrusoft_superadmin',
  SUPERADMIN_SESSION: 'contrusoft_superadmin_session'
};

// 12 Unidades de Medida Estándar obligatorias (Precarga del sistema)
const DEFAULT_MEASUREMENT_UNITS = [
  { id: 'u1', codigo: 'm', nombre: 'Metro lineal', categoria: 'Longitud', editable: true },
  { id: 'u2', codigo: 'm²', nombre: 'Metro cuadrado', categoria: 'Superficie', editable: true },
  { id: 'u3', codigo: 'm³', nombre: 'Metro cúbico', categoria: 'Volumen', editable: true },
  { id: 'u4', codigo: 'kg', nombre: 'Kilogramo', categoria: 'Peso', editable: true },
  { id: 'u5', codigo: 'ton', nombre: 'Tonelada', categoria: 'Peso', editable: true },
  { id: 'u6', codigo: 'gl', nombre: 'Galón', categoria: 'Volumen líquido', editable: true },
  { id: 'u7', codigo: 'un', nombre: 'Unidad', categoria: 'Conteo', editable: true },
  { id: 'u8', codigo: 'hr', nombre: 'Hora (MO/Equipo)', categoria: 'Tiempo', editable: true },
  { id: 'u9', codigo: 'mes', nombre: 'Mes', categoria: 'Tiempo', editable: true },
  { id: 'u10', codigo: 'pza', nombre: 'Pieza', categoria: 'Conteo', editable: true },
  { id: 'u11', codigo: 'sac', nombre: 'Saco / Bulto (50kg)', categoria: 'Empaque', editable: true },
  { id: 'u12', codigo: 'jor', nombre: 'Jornal', categoria: 'Mano de obra', editable: true }
];

// Empresas de demostración iniciales
const INITIAL_COMPANIES = [
  {
    id: 'comp_01',
    razonSocial: 'Ingeniería y Construcciones Andinas S.A.S.',
    nit: '901.458.789-3',
    logoUrl: null,
    plan: 'Empresarial',
    estadoSuscripcion: 'trial', // 'trial', 'active', 'expired', 'suspended'
    diasPruebaRestantes: 15,
    fechaRegistro: '2026-09-01',
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
    unidadesMedida: [...DEFAULT_MEASUREMENT_UNITS]
  },
  {
    id: 'comp_03',
    razonSocial: 'Obras y Pavimentos del Norte Ltda.',
    nit: '900.871.233-6',
    logoUrl: null,
    plan: 'Empresarial',
    estadoSuscripcion: 'expired',
    diasPruebaRestantes: 0,
    fechaRegistro: '2026-01-15',
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
    unidadesMedida: [...DEFAULT_MEASUREMENT_UNITS]
  }
];

// Cuentas de demostración iniciales
const INITIAL_USERS = [
  {
    id: 'usr_01',
    nombre: 'Ing. Carlos Mendoza',
    email: 'admin@constructora.com',
    password: 'Constru2026!',
    rol: 'Administrador',
    companyId: 'comp_01',
    requiereCambioClave: false
  },
  {
    id: 'usr_02',
    nombre: 'Ing. Juan Pérez',
    email: 'ing.perez@civil.com',
    password: 'Constru2026!',
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
    requiereCambioClave: true // Debe cambiar contraseña temporal en primer ingreso
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

// Inicialización
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
}

// Obtener datos
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

// Autenticación de inquilino por correo único
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

// Cambio obligatorio de contraseña temporal
function updateTemporaryPassword(userId, newPassword) {
  const users = getUsers();
  const userIndex = users.findIndex(u => u.id === userId);
  if (userIndex === -1) return { success: false, message: 'Usuario no encontrado.' };

  users[userIndex].password = newPassword;
  users[userIndex].requiereCambioClave = false;

  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));

  // Actualizar sesión actual
  const current = getCurrentUser();
  if (current && current.id === userId) {
    current.password = newPassword;
    current.requiereCambioClave = false;
    setCurrentUser(current);
  }

  return { success: true, message: 'Contraseña actualizada exitosamente.' };
}

// Registro de empresa nueva (Paso 1 + 2 + 3 encadenados)
function registerNewTenant({ cuenta, empresa, plan }) {
  const users = getUsers();
  const companies = getCompanies();

  // Validar unicidad de correo
  const exists = users.some(u => u.email.toLowerCase() === cuenta.email.trim().toLowerCase());
  if (exists) {
    return { success: false, message: 'El correo ya se encuentra registrado en la plataforma.' };
  }

  // 1. Crear empresa con 15 días de prueba y las 12 unidades estándar
  const newCompanyId = 'comp_' + Date.now();
  const newCompany = {
    id: newCompanyId,
    razonSocial: empresa.razonSocial,
    nit: empresa.nit,
    logoUrl: empresa.logoData || null,
    plan: plan, // 'Personal' | 'Empresarial'
    estadoSuscripcion: 'trial', // Siempre inicia con 15 días de prueba gratis
    diasPruebaRestantes: 15,
    fechaRegistro: new Date().toISOString().split('T')[0],
    unidadesMedida: [...DEFAULT_MEASUREMENT_UNITS] // 12 unidades precargadas
  };

  // 2. Crear usuario Administrador
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

  // Iniciar sesión automáticamente
  setCurrentUser({ ...newUser, company: newCompany });

  return {
    success: true,
    user: newUser,
    company: newCompany
  };
}

// Superadministrador
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

// Superadmin modifica estado de suscripción de empresa
function updateCompanySubscription(companyId, nuevoEstado, diasPrueba = 0) {
  const companies = getCompanies();
  const comp = companies.find(c => c.id === companyId);
  if (!comp) return false;

  comp.estadoSuscripcion = nuevoEstado;
  if (nuevoEstado === 'trial') {
    comp.diasPruebaRestantes = diasPrueba > 0 ? diasPrueba : 15;
  }
  localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(companies));

  // Si la empresa modificada es la del usuario en sesión, actualizarlo
  const current = getCurrentUser();
  if (current && current.companyId === companyId) {
    current.company.estadoSuscripcion = nuevoEstado;
    current.company.diasPruebaRestantes = comp.diasPruebaRestantes;
    setCurrentUser(current);
  }
  return true;
}

// Inicializar al cargar
initStorage();
