/**
 * ConstruSoft - Módulo 12: Configuración (configuracion.js)
 * Implementa las 7 secciones de configuración del sistema:
 * 12.1 Mi cuenta
 * 12.2 Datos de empresa
 * 12.3 Suscripción (Estado derivado "Vencida", pago manual fuera de plataforma, historial con PDF)
 * 12.4 Usuarios (Gating por plan Personal vs Empresarial, estados Pendiente/Activo/Revocado, permisos granulares)
 * 12.5 Preferencias del sistema (Moneda bloqueada si hay registros, separadores, decimales, preview en vivo)
 * 12.6 Parametrización (AIU estándar precargado, lista maestra de unidades de medida con validación case-insensitive)
 * 12.7 Notificaciones (Avisos de prueba, vencimiento y cambio de estado de proyecto)
 */

let currentCompanyConfig = null;
let currentConfigTab = 'cuenta';
let configUsersList = [];
let configRolesList = [];
let configUnitsList = [];
let configBillingList = [];
let activeEditingUnitId = null;

// Inicialización del módulo
async function initConfiguracionModule() {
  await loadCompanyConfiguration();
  setupConfigTabNav();
  setupConfigEvents();
  renderCurrentTab();
}

// Cargar toda la configuración de la empresa desde el backend
async function loadCompanyConfiguration() {
  try {
    const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
    const companyId = user.company ? user.company.id : 1;

    const res = await fetch(`/api/companies/${companyId}/config`);
    const data = await res.json();
    if (data.success) {
      currentCompanyConfig = data.company;
      // Actualizar datos en localStorage para sincronizar topbar
      if (user.company) {
        user.company.razonSocial = currentCompanyConfig.razonSocial;
        user.company.nit = currentCompanyConfig.nit;
        user.company.plan = currentCompanyConfig.plan;
        user.company.estadoSuscripcion = currentCompanyConfig.estadoSuscripcion;
        user.company.diasPruebaRestantes = currentCompanyConfig.diasPruebaRestantes;
        localStorage.setItem('contrusoft_current_user', JSON.stringify(user));
      }
      // Actualizar breadcrumb de la barra superior
      const topbar = document.getElementById('topbar-company-name');
      if (topbar) topbar.textContent = currentCompanyConfig.razonSocial;
    }
  } catch (err) {
    console.error('Error cargando configuración:', err);
  }
}

// Control de navegación entre pestañas
function setupConfigTabNav() {
  const tabButtons = document.querySelectorAll('.cfg-tab-btn');
  tabButtons.forEach(btn => {
    btn.onclick = () => {
      const targetTab = btn.getAttribute('data-cfg-tab');
      switchConfigTab(targetTab);
    };
  });
}

function switchConfigTab(tabKey) {
  currentConfigTab = tabKey;
  document.querySelectorAll('.cfg-tab-btn').forEach(btn => {
    if (btn.getAttribute('data-cfg-tab') === tabKey) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.querySelectorAll('.cfg-tab-panel').forEach(panel => {
    if (panel.id === `cfg-panel-${tabKey}`) {
      panel.style.display = 'block';
    } else {
      panel.style.display = 'none';
    }
  });

  renderCurrentTab();
}

function renderCurrentTab() {
  if (!currentCompanyConfig) return;

  switch (currentConfigTab) {
    case 'cuenta':
      renderTabMiCuenta();
      break;
    case 'empresa':
      renderTabDatosEmpresa();
      break;
    case 'suscripcion':
      renderTabSuscripcion();
      break;
    case 'usuarios':
      renderTabUsuarios();
      break;
    case 'preferencias':
      renderTabPreferencias();
      break;
    case 'parametrizacion':
      renderTabParametrizacion();
      break;
    case 'notificaciones':
      renderTabNotificaciones();
      break;
  }
}

// =========================================================================
// 12.1 MI CUENTA
// =========================================================================
function renderTabMiCuenta() {
  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  
  const nameEl = document.getElementById('cfg-user-name-display');
  const emailEl = document.getElementById('cfg-user-email-display');
  const roleEl = document.getElementById('cfg-user-role-display');

  if (nameEl) nameEl.textContent = user.nombre || 'Usuario';
  if (emailEl) emailEl.textContent = user.email || '-';
  if (roleEl) roleEl.textContent = user.rol || 'Administrador';
}

function openChangePasswordModal() {
  const modal = document.getElementById('modal-change-password');
  const alert = document.getElementById('cfg-pwd-alert');
  const form = document.getElementById('cfg-pwd-form');
  if (alert) alert.style.display = 'none';
  if (form) form.reset();
  if (modal) modal.style.display = 'flex';
}

function closeChangePasswordModal() {
  const modal = document.getElementById('modal-change-password');
  if (modal) modal.style.display = 'none';
}

async function handlePasswordSubmit(e) {
  e.preventDefault();
  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  const currentPassword = document.getElementById('cfg-pwd-current').value;
  const newPassword = document.getElementById('cfg-pwd-new').value;
  const confirmPassword = document.getElementById('cfg-pwd-confirm').value;
  const alertBox = document.getElementById('cfg-pwd-alert');

  if (newPassword !== confirmPassword) {
    showModalAlert(alertBox, 'La nueva contraseña y su confirmación no coinciden.');
    return;
  }
  if (newPassword.length < 6) {
    showModalAlert(alertBox, 'La nueva contraseña debe contener al menos 6 caracteres.');
    return;
  }

  try {
    const res = await fetch(`/api/users/${user.id}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });
    const data = await res.json();
    if (data.success) {
      alert('¡Contraseña actualizada exitosamente!');
      closeChangePasswordModal();
    } else {
      showModalAlert(alertBox, data.message || 'Error al cambiar la contraseña.');
    }
  } catch (err) {
    showModalAlert(alertBox, 'Error de conexión con el servidor.');
  }
}

// =========================================================================
// 12.2 DATOS DE EMPRESA
// =========================================================================
let tempLogoBase64 = null;

function renderTabDatosEmpresa() {
  if (!currentCompanyConfig) return;

  const razonInput = document.getElementById('cfg-empresa-razon');
  const nitInput = document.getElementById('cfg-empresa-nit');
  const dirInput = document.getElementById('cfg-empresa-direccion');
  const telInput = document.getElementById('cfg-empresa-telefono');
  const logoPreview = document.getElementById('cfg-logo-preview-img');
  const logoPlaceholder = document.getElementById('cfg-logo-placeholder');

  if (razonInput) razonInput.value = currentCompanyConfig.razonSocial || '';
  if (nitInput) nitInput.value = currentCompanyConfig.nit || '';
  if (dirInput) dirInput.value = currentCompanyConfig.direccion || '';
  if (telInput) telInput.value = currentCompanyConfig.telefono || '';

  tempLogoBase64 = currentCompanyConfig.logoData || null;
  updateLogoPreviewUI(tempLogoBase64);
}

function updateLogoPreviewUI(base64) {
  const img = document.getElementById('cfg-logo-preview-img');
  const placeholder = document.getElementById('cfg-logo-placeholder');
  const btnRemove = document.getElementById('cfg-btn-remove-logo');

  if (base64) {
    if (img) {
      img.src = base64;
      img.style.display = 'block';
    }
    if (placeholder) placeholder.style.display = 'none';
    if (btnRemove) btnRemove.style.display = 'inline-flex';
  } else {
    if (img) {
      img.src = '';
      img.style.display = 'none';
    }
    if (placeholder) placeholder.style.display = 'flex';
    if (btnRemove) btnRemove.style.display = 'none';
  }
}

function handleLogoFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.match('image/(png|jpeg|jpg)')) {
    alert('Por favor cargue una imagen en formato PNG o JPG.');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    alert('El tamaño máximo del logotipo es de 2 MB.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (loadEvt) => {
    tempLogoBase64 = loadEvt.target.result;
    updateLogoPreviewUI(tempLogoBase64);
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  tempLogoBase64 = '';
  updateLogoPreviewUI(null);
}

// Validación de NIT colombiano con dígito de verificación
function validateNitFormat(nitStr) {
  const clean = nitStr.trim();
  // Formato XXXXXXXXX-D o XXXXXXXXX (al menos 8-10 dígitos con guion opcional)
  const regex = /^\d{8,10}-\d$/;
  return regex.test(clean);
}

async function handleEmpresaSubmit(e) {
  e.preventDefault();
  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  const companyId = user.company ? user.company.id : 1;

  const razonSocial = document.getElementById('cfg-empresa-razon').value.trim();
  const nit = document.getElementById('cfg-empresa-nit').value.trim();
  const direccion = document.getElementById('cfg-empresa-direccion').value.trim();
  const telefono = document.getElementById('cfg-empresa-telefono').value.trim();

  if (!razonSocial) {
    alert('La razón social es obligatoria.');
    return;
  }
  if (!nit) {
    alert('El NIT es obligatorio.');
    return;
  }
  if (!validateNitFormat(nit)) {
    alert('El formato del NIT debe ser: 9 dígitos + guion + dígito de verificación (ej. 901.458.789-3 o 901458789-3).');
    return;
  }

  try {
    const payload = {
      razonSocial,
      nit,
      direccion,
      telefono,
      logoData: tempLogoBase64
    };

    const res = await fetch(`/api/companies/${companyId}/info`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      alert('¡Datos de la empresa y logotipo guardados correctamente!\nEl logo y el NIT se aplicarán automáticamente en todos los encabezados de PDF y exportaciones.');
      await loadCompanyConfiguration();
      renderTabDatosEmpresa();
    } else {
      alert(data.message || 'Error al guardar datos de la empresa.');
    }
  } catch (err) {
    alert('Error al conectar con el servidor.');
  }
}

// =========================================================================
// 12.3 SUSCRIPCIÓN
// =========================================================================
async function renderTabSuscripcion() {
  if (!currentCompanyConfig) return;

  const planEl = document.getElementById('cfg-sub-plan');
  const statusBadgeEl = document.getElementById('cfg-sub-status-badge');
  const expiryEl = document.getElementById('cfg-sub-expiry');
  const daysLeftEl = document.getElementById('cfg-sub-days');
  const trialNotice = document.getElementById('cfg-sub-trial-notice');
  const trialDaysText = document.getElementById('cfg-trial-remaining-text');

  const estado = currentCompanyConfig.estadoSuscripcion || 'En prueba';
  const plan = currentCompanyConfig.plan || 'Personal';

  if (planEl) planEl.textContent = `Plan ${plan}`;
  if (expiryEl) expiryEl.textContent = currentCompanyConfig.fechaVencimiento || 'No definida';

  // Días restantes
  const dias = currentCompanyConfig.diasRestantes !== undefined ? currentCompanyConfig.diasRestantes : currentCompanyConfig.diasPruebaRestantes;
  if (daysLeftEl) {
    if (dias < 0) {
      daysLeftEl.textContent = `Vencida hace ${Math.abs(dias)} día(s)`;
      daysLeftEl.style.color = 'var(--status-danger)';
    } else {
      daysLeftEl.textContent = `${dias} día(s) restantes`;
      daysLeftEl.style.color = dias <= 3 ? 'var(--status-danger)' : 'var(--terracota)';
    }
  }

  // Estado badge con colores
  if (statusBadgeEl) {
    statusBadgeEl.textContent = estado;
    statusBadgeEl.className = 'status-pill';
    if (estado === 'Activa') {
      statusBadgeEl.classList.add('status-open'); // Verde
    } else if (estado === 'En prueba') {
      statusBadgeEl.classList.add('status-active'); // Ámbar/azul
    } else if (estado === 'Vencida') {
      statusBadgeEl.classList.add('status-closed'); // Rojo
    } else if (estado === 'Cancelada') {
      statusBadgeEl.classList.add('status-closed'); // Rojo/Gris
    }
  }

  // Aviso visual si está en prueba
  if (trialNotice) {
    if (estado === 'En prueba' || estado === 'Vencida') {
      trialNotice.style.display = 'block';
      if (trialDaysText) {
        trialDaysText.textContent = dias >= 0 
          ? `Le quedan ${dias} día(s) de prueba gratuita.`
          : `Su período de prueba o suscripción ha vencido. Realice el pago para reactivar el acceso completo.`;
      }
    } else {
      trialNotice.style.display = 'none';
    }
  }

  // Cargar tabla de historial de facturación
  await loadBillingHistory();
}

async function loadBillingHistory() {
  const tbody = document.getElementById('cfg-billing-tbody');
  if (!tbody) return;

  try {
    const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
    const companyId = user.company ? user.company.id : 1;

    const res = await fetch(`/api/companies/${companyId}/billing`);
    const data = await res.json();
    if (data.success) {
      configBillingList = data.billing || [];
      renderBillingTable(configBillingList);
    }
  } catch (err) {
    console.error('Error cargando historial de facturación:', err);
  }
}

function renderBillingTable(bills) {
  const tbody = document.getElementById('cfg-billing-tbody');
  if (!tbody) return;

  if (bills.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:2rem; color:var(--text-muted);">
          No se registran movimientos de facturación.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = bills.map(b => {
    const statusColor = b.estado === 'Pagado' || b.estado === 'Aprobado' ? 'var(--status-open)' : 'var(--text-muted)';
    return `
      <tr>
        <td style="font-weight:600; color:var(--text-primary);">${b.fecha}</td>
        <td>
          <div style="font-weight:600; color:#fff;">${b.concepto}</div>
          <span style="font-size:0.72rem; color:var(--text-muted);">Ref: ${b.comprobanteNumero}</span>
        </td>
        <td style="font-family:var(--font-mono); font-weight:700; color:var(--terracota);">
          ${formatCurrencyPreview(b.monto, currentCompanyConfig)}
        </td>
        <td><span class="metodo-badge">${b.metodoPago}</span></td>
        <td><span style="color:${statusColor}; font-weight:600; font-size:0.8rem;">● ${b.estado}</span></td>
        <td style="text-align:right;">
          <button type="button" class="btn-outline" style="padding:0.35rem 0.75rem; font-size:0.75rem;" onclick="viewReceiptPdf('${b.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            Comprobante PDF
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function viewReceiptPdf(billId) {
  const bill = configBillingList.find(b => String(b.id) === String(billId));
  if (!bill) return;

  const modal = document.getElementById('modal-billing-receipt');
  const printArea = document.getElementById('cfg-receipt-content');
  if (!modal || !printArea) return;

  const comp = currentCompanyConfig || {};
  const logoHtml = comp.logoData 
    ? `<img src="${comp.logoData}" alt="Logo" style="max-height:48px; max-width:160px; object-fit:contain;">`
    : `<div style="font-weight:900; font-size:1.2rem; color:var(--terracota); letter-spacing:1px;">CONSTRUSOFT</div>`;

  printArea.innerHTML = `
    <div class="receipt-paper">
      <div class="receipt-header">
        <div>
          ${logoHtml}
          <div style="font-size:0.95rem; font-weight:700; color:#111; margin-top:0.4rem;">${comp.razonSocial || 'ConstruSoft'}</div>
          <div style="font-size:0.8rem; color:#555;">NIT: ${comp.nit || 'Sin registrar'}</div>
          <div style="font-size:0.75rem; color:#666;">${comp.direccion || 'Colombia'} — Tel: ${comp.telefono || ''}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:1.1rem; font-weight:800; color:#222;">COMPROBANTE DE PAGO</div>
          <div style="font-family:monospace; font-weight:700; color:#c25e36; font-size:0.95rem;">${bill.comprobanteNumero}</div>
          <div style="font-size:0.8rem; color:#666; margin-top:0.25rem;">Fecha: ${bill.fecha}</div>
          <div class="receipt-paid-stamp">PAGADO</div>
        </div>
      </div>

      <hr style="border:none; border-top:1px solid #eee; margin:1.2rem 0;">

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; font-size:0.82rem; margin-bottom:1.5rem;">
        <div>
          <span style="color:#888; display:block; font-size:0.75rem;">CLIENTE / INQUILINO</span>
          <strong style="color:#222;">${comp.razonSocial}</strong>
          <div style="color:#555;">NIT: ${comp.nit}</div>
        </div>
        <div>
          <span style="color:#888; display:block; font-size:0.75rem;">MÉTODO DE PAGO</span>
          <strong style="color:#222;">${bill.metodoPago}</strong>
          <div style="color:#555;">Estado: ${bill.estado}</div>
        </div>
      </div>

      <table class="receipt-table">
        <thead>
          <tr>
            <th>Concepto</th>
            <th style="text-align:right;">Monto</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>${bill.concepto}</strong>
              <div style="font-size:0.75rem; color:#666;">Extensión de vigencia de plataforma ConstruSoft</div>
            </td>
            <td style="text-align:right; font-family:monospace; font-weight:700; font-size:1rem;">
              ${formatCurrencyPreview(bill.monto, comp)}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td style="text-align:right; font-weight:700;">TOTAL PAGADO:</td>
            <td style="text-align:right; font-family:monospace; font-weight:900; font-size:1.15rem; color:#c25e36;">
              ${formatCurrencyPreview(bill.monto, comp)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div style="margin-top:2rem; font-size:0.72rem; color:#888; text-align:center; border-top:1px dashed #ccc; padding-top:1rem;">
        ConstruSoft Colombia • Soporte y Activaciones: pagos@contrusoft.internal • Comprobante oficial no tributario
      </div>
    </div>
  `;

  modal.style.display = 'flex';
}

function closeReceiptModal() {
  const modal = document.getElementById('modal-billing-receipt');
  if (modal) modal.style.display = 'none';
}

function printCurrentReceipt() {
  window.print();
}

// =========================================================================
// 12.4 USUARIOS
// =========================================================================
async function renderTabUsuarios() {
  if (!currentCompanyConfig) return;

  const plan = currentCompanyConfig.plan || 'Personal';
  const panelPersonal = document.getElementById('cfg-users-personal-mode');
  const panelEmpresarial = document.getElementById('cfg-users-empresarial-mode');

  if (plan === 'Personal') {
    if (panelPersonal) panelPersonal.style.display = 'block';
    if (panelEmpresarial) panelEmpresarial.style.display = 'none';
    await loadPersonalAssistantView();
  } else {
    if (panelPersonal) panelPersonal.style.display = 'none';
    if (panelEmpresarial) panelEmpresarial.style.display = 'block';
    await loadEmpresarialUsersView();
  }
}

// Plan Personal: El ingeniero crea a su único asistente con permisos granulares
async function loadPersonalAssistantView() {
  try {
    const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
    const companyId = user.company ? user.company.id : 1;

    const res = await fetch(`/api/companies/${companyId}/users`);
    const data = await res.json();
    if (data.success) {
      configUsersList = data.users || [];
      const assistant = configUsersList.find(u => u.rol !== 'Administrador');

      const cardEmpty = document.getElementById('cfg-personal-no-assistant');
      const cardExists = document.getElementById('cfg-personal-assistant-card');

      if (assistant) {
        if (cardEmpty) cardEmpty.style.display = 'none';
        if (cardExists) cardExists.style.display = 'block';

        document.getElementById('cfg-asst-name').textContent = assistant.nombre;
        document.getElementById('cfg-asst-email').textContent = assistant.email;
        
        const badge = document.getElementById('cfg-asst-status-badge');
        if (badge) {
          badge.textContent = assistant.estado;
          badge.className = `status-pill ${assistant.estado === 'Activo' ? 'status-open' : assistant.estado === 'Pendiente' ? 'status-active' : 'status-closed'}`;
        }

        // Permisos
        renderGranularPermissionsCheckboxes('cfg-asst-perms-container', assistant.permisos, true);

        // Botón revocar/reactivar
        const btnToggle = document.getElementById('cfg-btn-toggle-asst');
        if (btnToggle) {
          if (assistant.estado === 'Revocado') {
            btnToggle.textContent = 'Reactivar Acceso';
            btnToggle.className = 'btn-outline';
            btnToggle.onclick = () => toggleUserStatus(assistant.id, 'Activo');
          } else {
            btnToggle.textContent = 'Revocar Acceso';
            btnToggle.className = 'btn-outline text-danger';
            btnToggle.onclick = () => toggleUserStatus(assistant.id, 'Revocado');
          }
        }
      } else {
        if (cardEmpty) cardEmpty.style.display = 'block';
        if (cardExists) cardExists.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Error cargando asistente:', err);
  }
}

// Plan Empresarial: Panel completo con roles y alta de usuarios
async function loadEmpresarialUsersView() {
  try {
    const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
    const companyId = user.company ? user.company.id : 1;

    // Cargar usuarios
    const resUsers = await fetch(`/api/companies/${companyId}/users`);
    const dataUsers = await resUsers.json();
    if (dataUsers.success) {
      configUsersList = dataUsers.users || [];
      renderEmpresarialUsersTable(configUsersList);
    }

    // Cargar roles
    const resRoles = await fetch(`/api/companies/${companyId}/roles`);
    const dataRoles = await resRoles.json();
    if (dataRoles.success) {
      configRolesList = dataRoles.roles || [];
      renderRolesList(configRolesList);
    }
  } catch (err) {
    console.error('Error cargando usuarios empresariales:', err);
  }
}

function renderEmpresarialUsersTable(users) {
  const tbody = document.getElementById('cfg-users-tbody');
  if (!tbody) return;

  tbody.innerHTML = users.map(u => {
    const isOwner = u.rol === 'Administrador' && u.email === (JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}').email);
    const statusClass = u.estado === 'Activo' ? 'status-open' : u.estado === 'Pendiente' ? 'status-active' : 'status-closed';
    const statusTooltip = u.estado === 'Pendiente' 
      ? 'Creado, aún no ha iniciado sesión por primera vez (contraseña temporal)'
      : u.estado === 'Activo' ? 'Ya ingresó al menos una vez' : 'Acceso revocado por el administrador';

    let actionBtn = '';
    if (!isOwner) {
      if (u.estado === 'Revocado') {
        actionBtn = `<button type="button" class="btn-outline" style="padding:0.3rem 0.65rem; font-size:0.75rem;" onclick="toggleUserStatus('${u.id}', 'Activo')">Reactivar</button>`;
      } else {
        actionBtn = `<button type="button" class="btn-outline text-danger" style="padding:0.3rem 0.65rem; font-size:0.75rem;" onclick="toggleUserStatus('${u.id}', 'Revocado')">Revocar Acceso</button>`;
      }
    } else {
      actionBtn = `<span style="font-size:0.75rem; color:var(--text-muted);">Propietario</span>`;
    }

    return `
      <tr>
        <td>
          <div style="font-weight:600; color:#fff;">${u.nombre}</div>
          <div style="font-size:0.74rem; color:var(--text-muted);">${u.email}</div>
        </td>
        <td><span class="user-role-badge">${u.rol}</span></td>
        <td>
          <span class="status-pill ${statusClass}" title="${statusTooltip}">
            ${u.estado}
          </span>
        </td>
        <td style="text-align:right;">
          ${actionBtn}
        </td>
      </tr>
    `;
  }).join('');
}

function renderRolesList(roles) {
  const container = document.getElementById('cfg-roles-cards-container');
  if (!container) return;

  container.innerHTML = roles.map(r => {
    const deleteBtn = !r.esSistema ? `
      <button type="button" class="link-danger" onclick="deleteCustomRole('${r.id}')" style="background:none; border:none; cursor:pointer; font-size:0.75rem;">
        Eliminar Rol
      </button>
    ` : `<span style="font-size:0.7rem; color:var(--text-muted);">Estándar de Sistema</span>`;

    return `
      <div class="role-summary-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem;">
          <h4 style="font-size:0.95rem; font-weight:700; color:#fff; margin:0;">${r.nombre}</h4>
          ${deleteBtn}
        </div>
        <div style="font-size:0.75rem; color:var(--text-secondary); line-height:1.4;">
          ${formatPermissionsSummary(r.permisos)}
        </div>
      </div>
    `;
  }).join('');
}

function formatPermissionsSummary(perms) {
  if (!perms || Object.keys(perms).length === 0) return 'Sin permisos asignados.';
  const modules = Object.keys(perms).filter(m => perms[m] && perms[m].length > 0);
  if (modules.length === 0) return 'Sin permisos asignados.';
  return modules.map(m => `<strong>${m.toUpperCase()}</strong> (${perms[m].join(', ')})`).join(' • ');
}

// Cambiar estado de usuario (Revocar / Activar)
async function toggleUserStatus(userId, nuevoEstado) {
  const confirmMsg = nuevoEstado === 'Revocado' 
    ? '¿Está seguro de revocar el acceso a este usuario? Se conservará en el sistema para trazabilidad del historial.' 
    : '¿Desea reactivar el acceso para este usuario?';

  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(`/api/users/${userId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: nuevoEstado })
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      renderTabUsuarios();
    } else {
      alert(data.message || 'Error al cambiar estado.');
    }
  } catch (err) {
    alert('Error al conectar con el servidor.');
  }
}

// Modal de Creación de Usuario / Asistente
function openCreateUserModal(forPersonalAssistant = false) {
  const modal = document.getElementById('modal-config-user');
  const alertBox = document.getElementById('cfg-user-modal-alert');
  const form = document.getElementById('cfg-user-form');
  if (alertBox) alertBox.style.display = 'none';
  if (form) form.reset();

  const roleSelect = document.getElementById('cfg-user-modal-role');
  const permsContainer = document.getElementById('cfg-user-modal-perms');

  // Si es para asistente personal, rol fijo 'Asistente' y mostramos checkboxes granulares
  if (forPersonalAssistant || (currentCompanyConfig && currentCompanyConfig.plan === 'Personal')) {
    if (roleSelect) {
      roleSelect.innerHTML = '<option value="Asistente">Asistente Técnico</option>';
      roleSelect.disabled = true;
    }
    if (permsContainer) {
      permsContainer.style.display = 'block';
      renderGranularPermissionsCheckboxes('cfg-user-modal-perms-grid', {}, false);
    }
  } else {
    // Plan Empresarial: llenar con los roles existentes
    if (roleSelect) {
      roleSelect.disabled = false;
      roleSelect.innerHTML = configRolesList.map(r => `<option value="${r.nombre}">${r.nombre}</option>`).join('');
    }
    if (permsContainer) {
      permsContainer.style.display = 'none'; // El rol ya tiene los permisos definidos
    }
  }

  // Generar contraseña temporal aleatoria
  const tempPassInput = document.getElementById('cfg-user-modal-temp-pass');
  if (tempPassInput) {
    tempPassInput.value = 'Temp' + Math.floor(1000 + Math.random() * 9000) + '!';
  }

  if (modal) modal.style.display = 'flex';
}

function closeCreateUserModal() {
  const modal = document.getElementById('modal-config-user');
  if (modal) modal.style.display = 'none';
}

// Renderizar matriz de permisos granulares por módulo y acción
function renderGranularPermissionsCheckboxes(containerId, initialPerms = {}, readonly = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const schema = [
    { mod: 'recursos', label: 'Recursos', actions: ['ver', 'crear', 'editar', 'eliminar'] },
    { mod: 'apu', label: 'APU', actions: ['ver', 'crear', 'editar', 'eliminar'] },
    { mod: 'presupuestos', label: 'Presupuestos', actions: ['ver', 'crear', 'editar', 'exportar', 'duplicar'] },
    { mod: 'avance', label: 'Avance', actions: ['ver', 'registrar', 'exportar'] },
    { mod: 'configuracion', label: 'Configuración', actions: ['ver'] }
  ];

  container.innerHTML = schema.map(item => {
    const actionsHtml = item.actions.map(act => {
      const isChecked = (initialPerms[item.mod] || []).includes(act);
      const dis = readonly ? 'disabled' : '';
      return `
        <label class="perm-checkbox-label">
          <input type="checkbox" data-mod="${item.mod}" data-act="${act}" ${isChecked ? 'checked' : ''} ${dis}>
          <span>${act}</span>
        </label>
      `;
    }).join('');

    return `
      <div class="perm-module-row">
        <div class="perm-module-title">${item.label}</div>
        <div class="perm-actions-group">${actionsHtml}</div>
      </div>
    `;
  }).join('') + `
    <div class="perm-locked-notice">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
      <span>El cambio de estado del proyecto (Abierto / Activo / Cerrado) es exclusivo del Administrador (no delegable).</span>
    </div>
  `;
}

function collectGranularPermissions(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return {};
  const perms = {};
  container.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    const mod = chk.getAttribute('data-mod');
    const act = chk.getAttribute('data-act');
    if (!perms[mod]) perms[mod] = [];
    if (chk.checked) perms[mod].push(act);
  });
  return perms;
}

async function handleCreateUserSubmit(e) {
  e.preventDefault();
  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  const companyId = user.company ? user.company.id : 1;

  const nombre = document.getElementById('cfg-user-modal-name').value.trim();
  const email = document.getElementById('cfg-user-modal-email').value.trim().toLowerCase();
  const password = document.getElementById('cfg-user-modal-temp-pass').value.trim();
  const rol = document.getElementById('cfg-user-modal-role').value;
  const alertBox = document.getElementById('cfg-user-modal-alert');

  let permisos = {};
  if (currentCompanyConfig.plan === 'Personal') {
    permisos = collectGranularPermissions('cfg-user-modal-perms-grid');
  } else {
    // Tomar permisos del rol seleccionado
    const selectedRoleObj = configRolesList.find(r => r.nombre === rol);
    if (selectedRoleObj) permisos = selectedRoleObj.permisos;
  }

  try {
    const res = await fetch(`/api/companies/${companyId}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, email, password, rol, permisos })
    });
    const data = await res.json();
    if (data.success) {
      alert(`¡Usuario creado con éxito!\n\nNombre: ${nombre}\nCorreo: ${email}\nContraseña Temporal: ${password}\n\nEntregue esta contraseña temporal al usuario. En su primer ingreso el sistema le exigirá cambiarla.`);
      closeCreateUserModal();
      renderTabUsuarios();
    } else {
      showModalAlert(alertBox, data.message || 'Error al crear usuario.');
    }
  } catch (err) {
    showModalAlert(alertBox, 'Error de conexión con el servidor.');
  }
}

// Modal de Creación de Rol Personalizado (Plan Empresarial)
function openCreateRoleModal() {
  const modal = document.getElementById('modal-config-role');
  const alertBox = document.getElementById('cfg-role-modal-alert');
  const form = document.getElementById('cfg-role-form');
  if (alertBox) alertBox.style.display = 'none';
  if (form) form.reset();

  renderGranularPermissionsCheckboxes('cfg-role-modal-perms-grid', {}, false);
  if (modal) modal.style.display = 'flex';
}

function closeCreateRoleModal() {
  const modal = document.getElementById('modal-config-role');
  if (modal) modal.style.display = 'none';
}

async function handleCreateRoleSubmit(e) {
  e.preventDefault();
  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  const companyId = user.company ? user.company.id : 1;

  const nombre = document.getElementById('cfg-role-modal-name').value.trim();
  const alertBox = document.getElementById('cfg-role-modal-alert');
  const permisos = collectGranularPermissions('cfg-role-modal-perms-grid');

  try {
    const res = await fetch(`/api/companies/${companyId}/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, permisos })
    });
    const data = await res.json();
    if (data.success) {
      alert('¡Rol personalizado creado con éxito!');
      closeCreateRoleModal();
      renderTabUsuarios();
    } else {
      showModalAlert(alertBox, data.message || 'Error al crear rol.');
    }
  } catch (err) {
    showModalAlert(alertBox, 'Error de conexión con el servidor.');
  }
}

async function deleteCustomRole(roleId) {
  if (!confirm('¿Está seguro de eliminar este rol personalizado?')) return;
  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  const companyId = user.company ? user.company.id : 1;

  try {
    const res = await fetch(`/api/companies/${companyId}/roles/${roleId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      renderTabUsuarios();
    } else {
      alert(data.message || 'Error al eliminar rol.');
    }
  } catch (err) {
    alert('Error al conectar con el servidor.');
  }
}

// =========================================================================
// 12.5 PREFERENCIAS DEL SISTEMA
// =========================================================================
function renderTabPreferencias() {
  if (!currentCompanyConfig) return;

  const selectMoneda = document.getElementById('cfg-pref-moneda');
  const monedaLockNotice = document.getElementById('cfg-moneda-lock-notice');
  const selectSeparadores = document.getElementById('cfg-pref-separadores');
  const selectDecimales = document.getElementById('cfg-pref-decimales');

  if (selectMoneda) {
    selectMoneda.value = currentCompanyConfig.moneda || 'COP';
    if (currentCompanyConfig.monedaBloqueada) {
      selectMoneda.disabled = true;
      if (monedaLockNotice) {
        monedaLockNotice.style.display = 'flex';
        monedaLockNotice.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          <span>Moneda bloqueada: La empresa ya tiene ${currentCompanyConfig.totalRecursos} recurso(s), ${currentCompanyConfig.totalApus} APU(s) o ${currentCompanyConfig.totalPresupuestos} presupuesto(s) registrados.</span>
        `;
      }
    } else {
      selectMoneda.disabled = false;
      if (monedaLockNotice) monedaLockNotice.style.display = 'none';
    }
  }

  // Separadores
  if (selectSeparadores) {
    const curMiles = currentCompanyConfig.separadorMiles || '.';
    if (curMiles === '.') {
      selectSeparadores.value = 'punto_coma'; // 1.234.567,89
    } else {
      selectSeparadores.value = 'coma_punto'; // 1,234,567.89
    }
  }

  // Decimales
  if (selectDecimales) {
    selectDecimales.value = String(currentCompanyConfig.decimales !== undefined ? currentCompanyConfig.decimales : 2);
  }

  updatePreferencesLivePreview();
}

function updatePreferencesLivePreview() {
  const selectMoneda = document.getElementById('cfg-pref-moneda');
  const selectSeparadores = document.getElementById('cfg-pref-separadores');
  const selectDecimales = document.getElementById('cfg-pref-decimales');
  const previewBox = document.getElementById('cfg-pref-live-preview');
  if (!previewBox) return;

  const moneda = selectMoneda ? selectMoneda.value : 'COP';
  const sepChoice = selectSeparadores ? selectSeparadores.value : 'punto_coma';
  const decimals = parseInt(selectDecimales ? selectDecimales.value : '2', 10);

  const sampleAmount = 14258900.75;
  const miles = sepChoice === 'punto_coma' ? '.' : ',';
  const decimal = sepChoice === 'punto_coma' ? ',' : '.';

  const formatted = formatNumberCustom(sampleAmount, decimals, miles, decimal);
  previewBox.textContent = `${moneda} ${formatted}`;
}

function formatNumberCustom(num, decimals, milesSep, decSep) {
  const parts = num.toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, milesSep);
  return decimals > 0 ? parts.join(decSep) : parts[0];
}

function formatCurrencyPreview(amount, comp) {
  const moneda = comp && comp.moneda ? comp.moneda : 'COP';
  const miles = comp && comp.separadorMiles ? comp.separadorMiles : '.';
  const decimal = comp && comp.separadorDecimal ? comp.separadorDecimal : ',';
  const decimals = comp && comp.decimales !== undefined ? comp.decimales : 2;
  return `${moneda} $ ${formatNumberCustom(amount, decimals, miles, decimal)}`;
}

async function handlePreferenciasSubmit(e) {
  e.preventDefault();
  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  const companyId = user.company ? user.company.id : 1;

  const selectMoneda = document.getElementById('cfg-pref-moneda');
  const selectSeparadores = document.getElementById('cfg-pref-separadores');
  const selectDecimales = document.getElementById('cfg-pref-decimales');

  const sepChoice = selectSeparadores.value;
  const miles = sepChoice === 'punto_coma' ? '.' : ',';
  const decimal = sepChoice === 'punto_coma' ? ',' : '.';
  const decimals = parseInt(selectDecimales.value, 10);
  const moneda = selectMoneda.value;

  try {
    const res = await fetch(`/api/companies/${companyId}/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        moneda,
        separadorMiles: miles,
        separadorDecimal: decimal,
        decimales: decimals
      })
    });
    const data = await res.json();
    if (data.success) {
      alert('¡Preferencias del sistema guardadas exitosamente!');
      await loadCompanyConfiguration();
      renderTabPreferencias();
    } else {
      alert(data.message || 'Error al guardar preferencias.');
    }
  } catch (err) {
    alert('Error al conectar con el servidor.');
  }
}

// =========================================================================
// 12.6 PARAMETRIZACIÓN
// =========================================================================
async function renderTabParametrizacion() {
  if (!currentCompanyConfig) return;

  // 1. AIU Estándar
  const adminIn = document.getElementById('cfg-aiu-admin');
  const impIn = document.getElementById('cfg-aiu-imprevistos');
  const utIn = document.getElementById('cfg-aiu-utilidad');

  if (adminIn) adminIn.value = currentCompanyConfig.aiuAdmin || 0;
  if (impIn) impIn.value = currentCompanyConfig.aiuImprevistos || 0;
  if (utIn) utIn.value = currentCompanyConfig.aiuUtilidad || 0;

  // 2. Unidades de Medida
  await loadUnitsMasterList();
}

async function handleAiuDefaultsSubmit(e) {
  e.preventDefault();
  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  const companyId = user.company ? user.company.id : 1;

  const aiuAdmin = parseFloat(document.getElementById('cfg-aiu-admin').value || '0');
  const aiuImprevistos = parseFloat(document.getElementById('cfg-aiu-imprevistos').value || '0');
  const aiuUtilidad = parseFloat(document.getElementById('cfg-aiu-utilidad').value || '0');

  try {
    const res = await fetch(`/api/companies/${companyId}/aiu-defaults`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiuAdmin, aiuImprevistos, aiuUtilidad })
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      await loadCompanyConfiguration();
    } else {
      alert(data.message || 'Error al guardar AIU estándar.');
    }
  } catch (err) {
    alert('Error al conectar con el servidor.');
  }
}

// Unidades de Medida: Lista maestra editable
async function loadUnitsMasterList() {
  const tbody = document.getElementById('cfg-units-tbody');
  if (!tbody) return;

  try {
    const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
    const companyId = user.company ? user.company.id : 1;

    const res = await fetch(`/api/units?company_id=${companyId}`);
    const data = await res.json();
    if (data.success) {
      configUnitsList = data.units || [];
      renderUnitsMasterTable(configUnitsList);
    }
  } catch (err) {
    console.error('Error cargando unidades maestras:', err);
  }
}

function renderUnitsMasterTable(units) {
  const tbody = document.getElementById('cfg-units-tbody');
  if (!tbody) return;

  if (units.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:2rem; color:var(--text-muted);">No hay unidades registradas.</td></tr>`;
    return;
  }

  tbody.innerHTML = units.map(u => {
    const inUseBadge = u.enUso 
      ? `<span class="unit-badge-inuse" title="${u.recursosCount} recurso(s) y ${u.apusCount} APU(s)">● En uso (${u.recursosCount + u.apusCount})</span>`
      : `<span style="color:var(--text-muted); font-size:0.75rem;">Disponible</span>`;

    return `
      <tr>
        <td>
          <span class="unit-code-pill">${u.codigo}</span>
        </td>
        <td>
          <strong style="color:#fff;">${u.nombre}</strong>
          <div style="font-size:0.72rem; color:var(--text-muted);">${u.categoria || 'General'}</div>
        </td>
        <td>${inUseBadge}</td>
        <td style="text-align:right;">
          <div style="display:inline-flex; gap:0.4rem;">
            <button type="button" class="btn-outline" style="padding:0.3rem 0.65rem; font-size:0.75rem;" onclick="openEditUnitModal('${u.id}')">
              Editar
            </button>
            <button type="button" class="btn-outline text-danger" style="padding:0.3rem 0.65rem; font-size:0.75rem;" onclick="handleDeleteUnitClick('${u.id}')">
              Eliminar
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Crear / Editar Unidad de Medida
function openCreateUnitModal() {
  activeEditingUnitId = null;
  const modal = document.getElementById('modal-config-unit');
  const alertBox = document.getElementById('cfg-unit-modal-alert');
  const title = document.getElementById('cfg-unit-modal-title');
  const form = document.getElementById('cfg-unit-form');

  if (title) title.textContent = 'Crear Nueva Unidad de Medida';
  if (alertBox) alertBox.style.display = 'none';
  if (form) form.reset();
  if (modal) modal.style.display = 'flex';
}

function openEditUnitModal(unitId) {
  const unit = configUnitsList.find(u => String(u.id) === String(unitId));
  if (!unit) return;

  activeEditingUnitId = unitId;
  const modal = document.getElementById('modal-config-unit');
  const alertBox = document.getElementById('cfg-unit-modal-alert');
  const title = document.getElementById('cfg-unit-modal-title');

  if (title) title.textContent = `Editar Unidad: ${unit.codigo}`;
  if (alertBox) alertBox.style.display = 'none';

  document.getElementById('cfg-unit-symbol').value = unit.codigo;
  document.getElementById('cfg-unit-name').value = unit.nombre;
  document.getElementById('cfg-unit-cat').value = unit.categoria || 'General';

  if (modal) modal.style.display = 'flex';
}

function closeUnitModal() {
  const modal = document.getElementById('modal-config-unit');
  if (modal) modal.style.display = 'none';
  activeEditingUnitId = null;
}

async function handleUnitFormSubmit(e) {
  e.preventDefault();
  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  const companyId = user.company ? user.company.id : 1;

  const codigo = document.getElementById('cfg-unit-symbol').value.trim();
  const nombre = document.getElementById('cfg-unit-name').value.trim();
  const categoria = document.getElementById('cfg-unit-cat').value.trim() || 'General';
  const alertBox = document.getElementById('cfg-unit-modal-alert');

  if (!codigo || !nombre) {
    showModalAlert(alertBox, 'El símbolo y la descripción son obligatorios.');
    return;
  }

  // Validación rápida en frontend de duplicados insensible a mayúsculas
  const isDuplicate = configUnitsList.some(u => {
    if (activeEditingUnitId && String(u.id) === String(activeEditingUnitId)) return false;
    return u.codigo.trim().toLowerCase() === codigo.toLowerCase();
  });

  if (isDuplicate) {
    showModalAlert(alertBox, `El símbolo '${codigo}' ya existe en la empresa (la comparación no distingue mayúsculas). Elija un símbolo distinto.`);
    return;
  }

  try {
    let url = '/api/units';
    let method = 'POST';
    if (activeEditingUnitId) {
      url = `/api/units/${activeEditingUnitId}`;
      method = 'PUT';
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, codigo, nombre, categoria })
    });
    const data = await res.json();
    if (data.success) {
      closeUnitModal();
      await loadUnitsMasterList();
      // Actualizar selectores de Recursos y APU si existen en memoria
      if (typeof loadUnitsList === 'function') loadUnitsList();
      if (typeof loadApuUnits === 'function') loadApuUnits();
    } else {
      showModalAlert(alertBox, data.message || 'Error al guardar unidad.');
    }
  } catch (err) {
    showModalAlert(alertBox, 'Error al conectar con el servidor.');
  }
}

// Eliminar Unidad con verificación bloqueante de uso en Recursos / APU
async function handleDeleteUnitClick(unitId) {
  const unit = configUnitsList.find(u => String(u.id) === String(unitId));
  if (!unit) return;

  if (unit.enUso) {
    // Mostrar modal bloqueante con detalles
    openUnitBlockedModal(unit);
    return;
  }

  if (!confirm(`¿Está seguro de eliminar la unidad '${unit.codigo}' (${unit.nombre})?`)) return;

  try {
    const res = await fetch(`/api/units/${unitId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      await loadUnitsMasterList();
      if (typeof loadUnitsList === 'function') loadUnitsList();
      if (typeof loadApuUnits === 'function') loadApuUnits();
    } else if (data.bloqueado) {
      openUnitBlockedModal({
        codigo: unit.codigo,
        nombre: unit.nombre,
        detalles: data.detalles || [],
        recursosNombres: data.recursos || [],
        apusNombres: data.apus || []
      });
    } else {
      alert(data.message || 'Error al eliminar unidad.');
    }
  } catch (err) {
    alert('Error al conectar con el servidor.');
  }
}

function openUnitBlockedModal(unit) {
  const modal = document.getElementById('modal-unit-blocked');
  const symbolEl = document.getElementById('cfg-blocked-unit-symbol');
  const detailsList = document.getElementById('cfg-blocked-unit-list');

  if (symbolEl) symbolEl.textContent = `${unit.codigo} — ${unit.nombre}`;

  if (detailsList) {
    let items = [];
    if (unit.recursosNombres && unit.recursosNombres.length > 0) {
      items.push(`<li><strong>Recursos que la usan:</strong> ${unit.recursosNombres.join(', ')}</li>`);
    }
    if (unit.apusNombres && unit.apusNombres.length > 0) {
      items.push(`<li><strong>APUs que la usan:</strong> ${unit.apusNombres.join(', ')}</li>`);
    }
    if (items.length === 0 && unit.detalles) {
      items = unit.detalles.map(d => `<li>${d}</li>`);
    }
    detailsList.innerHTML = items.join('');
  }

  if (modal) modal.style.display = 'flex';
}

function closeUnitBlockedModal() {
  const modal = document.getElementById('modal-unit-blocked');
  if (modal) modal.style.display = 'none';
}

// =========================================================================
// 12.7 NOTIFICACIONES
// =========================================================================
function renderTabNotificaciones() {
  if (!currentCompanyConfig) return;

  const chkPrueba = document.getElementById('cfg-notif-prueba');
  const chkSub = document.getElementById('cfg-notif-sub');
  const chkEstado = document.getElementById('cfg-notif-estado');

  if (chkPrueba) chkPrueba.checked = Boolean(currentCompanyConfig.notifPrueba);
  if (chkSub) chkSub.checked = Boolean(currentCompanyConfig.notifSuscripcion);
  if (chkEstado) chkEstado.checked = Boolean(currentCompanyConfig.notifEstadoProyecto);
}

async function handleNotificacionesSubmit(e) {
  e.preventDefault();
  const user = JSON.parse(localStorage.getItem('contrusoft_current_user') || '{}');
  const companyId = user.company ? user.company.id : 1;

  const notifPrueba = document.getElementById('cfg-notif-prueba').checked;
  const notifSuscripcion = document.getElementById('cfg-notif-sub').checked;
  const notifEstadoProyecto = document.getElementById('cfg-notif-estado').checked;

  try {
    const res = await fetch(`/api/companies/${companyId}/notifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifPrueba, notifSuscripcion, notifEstadoProyecto })
    });
    const data = await res.json();
    if (data.success) {
      alert('¡Preferencias de notificaciones por correo guardadas exitosamente!');
      await loadCompanyConfiguration();
    } else {
      alert(data.message || 'Error al guardar notificaciones.');
    }
  } catch (err) {
    alert('Error al conectar con el servidor.');
  }
}

// =========================================================================
// UTILIDADES Y EVENTOS
// =========================================================================
function showModalAlert(alertBox, msg) {
  if (!alertBox) return;
  alertBox.textContent = msg;
  alertBox.style.display = 'block';
}

function setupConfigEvents() {
  // Volver a presupuestos o inicio desde botón superior
  const backBtn = document.getElementById('btn-config-back-main');
  if (backBtn) {
    backBtn.onclick = () => {
      if (typeof window.switchModule === 'function') {
        window.switchModule('presupuestos');
      }
    };
  }

  // 12.1 Mi Cuenta
  const btnOpenPwd = document.getElementById('cfg-btn-change-pwd');
  if (btnOpenPwd) btnOpenPwd.onclick = openChangePasswordModal;
  const formPwd = document.getElementById('cfg-pwd-form');
  if (formPwd) formPwd.onsubmit = handlePasswordSubmit;

  // 12.2 Datos Empresa
  const formEmpresa = document.getElementById('cfg-empresa-form');
  if (formEmpresa) formEmpresa.onsubmit = handleEmpresaSubmit;
  const logoInput = document.getElementById('cfg-logo-file-input');
  if (logoInput) logoInput.onchange = handleLogoFileChange;
  const btnRemoveLogo = document.getElementById('cfg-btn-remove-logo');
  if (btnRemoveLogo) btnRemoveLogo.onclick = removeLogo;

  // 12.4 Usuarios
  const formCreateUser = document.getElementById('cfg-user-form');
  if (formCreateUser) formCreateUser.onsubmit = handleCreateUserSubmit;
  const formCreateRole = document.getElementById('cfg-role-form');
  if (formCreateRole) formCreateRole.onsubmit = handleCreateRoleSubmit;

  // 12.5 Preferencias: cambio en vivo
  const selMon = document.getElementById('cfg-pref-moneda');
  const selSep = document.getElementById('cfg-pref-separadores');
  const selDec = document.getElementById('cfg-pref-decimales');
  if (selMon) selMon.onchange = updatePreferencesLivePreview;
  if (selSep) selSep.onchange = updatePreferencesLivePreview;
  if (selDec) selDec.onchange = updatePreferencesLivePreview;
  const formPref = document.getElementById('cfg-pref-form');
  if (formPref) formPref.onsubmit = handlePreferenciasSubmit;

  // 12.6 Parametrización
  const formAiu = document.getElementById('cfg-aiu-form');
  if (formAiu) formAiu.onsubmit = handleAiuDefaultsSubmit;
  const formUnit = document.getElementById('cfg-unit-form');
  if (formUnit) formUnit.onsubmit = handleUnitFormSubmit;

  // 12.7 Notificaciones
  const formNotif = document.getElementById('cfg-notif-form');
  if (formNotif) formNotif.onsubmit = handleNotificacionesSubmit;
}
