/**
 * ConstruSoft - Controlador de Autenticación y Registro con API Backend & SQLite
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elementos de navegación de vistas
  const tabLoginBtn = document.getElementById('tab-login-btn');
  const tabRegisterBtn = document.getElementById('tab-register-btn');
  const loginView = document.getElementById('login-view');
  const registerView = document.getElementById('register-view');
  const forgotView = document.getElementById('forgot-view');
  const resetPassView = document.getElementById('reset-pass-view');

  const linkToForgot = document.getElementById('link-forgot-password');
  const linkBackToLoginFromForgot = document.getElementById('link-back-login');
  const linkBackToLoginFromReset = document.getElementById('link-back-login-reset');

  // Formulario de Login
  const loginForm = document.getElementById('login-form');
  const loginEmail = document.getElementById('login-email');
  const loginPassword = document.getElementById('login-password');
  const loginAlert = document.getElementById('login-alert');
  const btnLoginSubmit = document.getElementById('btn-login-submit');

  // Estado del Wizard de Registro
  let currentStep = 1;
  const registrationData = {
    cuenta: { nombre: '', email: '', password: '' },
    empresa: { razonSocial: '', nit: '', logoData: null },
    plan: null
  };

  // --------------------------------------------------------------------------
  // 1. CAMBIO DE PESTAÑAS Y VISTAS
  // --------------------------------------------------------------------------
  function showView(viewName) {
    loginView.style.display = 'none';
    registerView.style.display = 'none';
    forgotView.style.display = 'none';
    resetPassView.style.display = 'none';

    tabLoginBtn.classList.remove('active');
    tabRegisterBtn.classList.remove('active');

    if (viewName === 'login') {
      loginView.style.display = 'block';
      tabLoginBtn.classList.add('active');
    } else if (viewName === 'register') {
      registerView.style.display = 'block';
      tabRegisterBtn.classList.add('active');
    } else if (viewName === 'forgot') {
      forgotView.style.display = 'block';
    } else if (viewName === 'reset') {
      resetPassView.style.display = 'block';
    }
  }

  tabLoginBtn.addEventListener('click', () => showView('login'));
  tabRegisterBtn.addEventListener('click', () => showView('register'));
  linkToForgot.addEventListener('click', (e) => {
    e.preventDefault();
    showView('forgot');
  });
  linkBackToLoginFromForgot.addEventListener('click', (e) => {
    e.preventDefault();
    showView('login');
  });
  linkBackToLoginFromReset.addEventListener('click', (e) => {
    e.preventDefault();
    showView('login');
  });

  // --------------------------------------------------------------------------
  // 2. INGRESO (LOGIN) CONEXIÓN A BASE DE DATOS SQLITE
  // --------------------------------------------------------------------------
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(loginAlert);

    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    if (!email || !password) {
      showAlert(loginAlert, 'Por favor ingrese su correo y contraseña.', 'danger');
      return;
    }

    btnLoginSubmit.disabled = true;
    btnLoginSubmit.textContent = 'Verificando credenciales...';

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        showAlert(loginAlert, data.message || 'Credenciales inválidas.', 'danger');
        btnLoginSubmit.disabled = false;
        btnLoginSubmit.textContent = 'Ingresar al Sistema';
        return;
      }

      // Guardar sesión en cliente y redirigir
      localStorage.setItem('contrusoft_current_user', JSON.stringify(data.user));
      window.location.href = 'dashboard.html';

    } catch (err) {
      showAlert(loginAlert, 'Error de conexión con el servidor local.', 'danger');
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.textContent = 'Ingresar al Sistema';
    }
  });

  // --------------------------------------------------------------------------
  // 3. REGISTRO EN 3 PASOS ENCADENADOS (GUARDA EN SQLITE)
  // --------------------------------------------------------------------------
  const stepNodes = document.querySelectorAll('.step-node');
  const stepPanes = document.querySelectorAll('.step-pane');
  const regAlert = document.getElementById('register-alert');

  // Paso 1
  const regNombre = document.getElementById('reg-nombre');
  const regEmail = document.getElementById('reg-email');
  const regPass = document.getElementById('reg-pass');
  const btnNextStep1 = document.getElementById('btn-step1-next');

  // Paso 2
  const regRazonSocial = document.getElementById('reg-razon-social');
  const regNit = document.getElementById('reg-nit');
  const regLogoInput = document.getElementById('reg-logo-input');
  const logoUploadTrigger = document.getElementById('logo-upload-trigger');
  const logoPreviewBox = document.getElementById('logo-preview-box');
  const logoThumb = document.getElementById('logo-thumb');
  const logoFilename = document.getElementById('logo-filename');
  const btnRemoveLogo = document.getElementById('btn-remove-logo');
  const btnBackStep2 = document.getElementById('btn-step2-back');
  const btnNextStep2 = document.getElementById('btn-step2-next');

  // Paso 3
  const planCards = document.querySelectorAll('.plan-option');
  const btnBackStep3 = document.getElementById('btn-step3-back');
  const btnFinishReg = document.getElementById('btn-finish-registration');

  function updateStepUI(stepNumber) {
    currentStep = stepNumber;
    hideAlert(regAlert);

    stepNodes.forEach(node => {
      const step = parseInt(node.getAttribute('data-step'));
      node.classList.remove('active', 'completed');
      if (step === currentStep) {
        node.classList.add('active');
      } else if (step < currentStep) {
        node.classList.add('completed');
      }
    });

    stepPanes.forEach(pane => {
      pane.classList.remove('active');
      if (parseInt(pane.getAttribute('data-step-content')) === currentStep) {
        pane.classList.add('active');
      }
    });
  }

  // Paso 1: Validación
  btnNextStep1.addEventListener('click', () => {
    hideAlert(regAlert);
    const nombre = regNombre.value.trim();
    const email = regEmail.value.trim();
    const password = regPass.value;

    if (!nombre) {
      showAlert(regAlert, 'Ingrese el nombre del titular de la cuenta.', 'danger');
      regNombre.focus();
      return;
    }
    if (!email || !email.includes('@')) {
      showAlert(regAlert, 'Ingrese un correo electrónico válido.', 'danger');
      regEmail.focus();
      return;
    }
    if (password.length < 8) {
      showAlert(regAlert, 'La contraseña exige mínimo 8 caracteres.', 'danger');
      regPass.focus();
      return;
    }

    registrationData.cuenta = { nombre, email, password };
    updateStepUI(2);
  });

  // Paso 2: Datos de Empresa y Logo
  logoUploadTrigger.addEventListener('click', () => regLogoInput.click());
  regLogoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        registrationData.empresa.logoData = event.target.result;
        logoThumb.src = event.target.result;
        logoFilename.textContent = file.name;
        logoPreviewBox.style.display = 'flex';
        logoUploadTrigger.style.display = 'none';
      };
      reader.readAsDataURL(file);
    }
  });

  btnRemoveLogo.addEventListener('click', () => {
    registrationData.empresa.logoData = null;
    regLogoInput.value = '';
    logoPreviewBox.style.display = 'none';
    logoUploadTrigger.style.display = 'block';
  });

  btnBackStep2.addEventListener('click', () => updateStepUI(1));

  btnNextStep2.addEventListener('click', () => {
    hideAlert(regAlert);
    const razonSocial = regRazonSocial.value.trim();
    const nit = regNit.value.trim();

    if (!razonSocial) {
      showAlert(regAlert, 'Ingrese la razón social de la empresa.', 'danger');
      regRazonSocial.focus();
      return;
    }
    if (!nit) {
      showAlert(regAlert, 'Ingrese el NIT o identificación tributaria.', 'danger');
      regNit.focus();
      return;
    }

    // Validación de estructura de NIT (8 a 10 dígitos base, guion y dígito de verificación)
    const nitRegex = /^(\d{1,3}(\.\d{3}){2,3}-\d|\d{8,10}-\d)$/;
    if (!nitRegex.test(nit)) {
      showAlert(regAlert, 'El NIT no cumple con una estructura válida. Debe incluir de 8 a 10 dígitos, guion y dígito de verificación (ej. 901.458.789-3 o 901458789-3).', 'danger');
      regNit.focus();
      return;
    }

    registrationData.empresa.razonSocial = razonSocial;
    registrationData.empresa.nit = nit;
    updateStepUI(3);
  });

  // Auto-formateo inteligente al perder foco si el usuario escribe solo dígitos
  regNit.addEventListener('blur', () => {
    const val = regNit.value.trim();
    if (/^\d{9,11}$/.test(val)) {
      const base = val.slice(0, -1);
      const dv = val.slice(-1);
      regNit.value = `${base}-${dv}`;
    }
  });

  // Paso 3: Selección de Plan Obligatorio y Registro en SQLite
  planCards.forEach(card => {
    card.addEventListener('click', () => {
      planCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      registrationData.plan = card.getAttribute('data-plan');
      hideAlert(regAlert);
    });
  });

  btnBackStep3.addEventListener('click', () => updateStepUI(2));

  btnFinishReg.addEventListener('click', async () => {
    hideAlert(regAlert);

    if (!registrationData.plan) {
      showAlert(regAlert, 'Debe seleccionar obligatoriamente un plan (Personal o Empresarial).', 'danger');
      return;
    }

    btnFinishReg.disabled = true;
    btnFinishReg.textContent = 'Registrando empresa en base de datos...';

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registrationData)
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        showAlert(regAlert, data.message || 'Error al registrar la empresa.', 'danger');
        btnFinishReg.disabled = false;
        btnFinishReg.textContent = 'Completar Registro';
        return;
      }

      // Guardar sesión y redirigir a dashboard
      localStorage.setItem('contrusoft_current_user', JSON.stringify(data.user));
      showAlert(regAlert, '¡Empresa registrada con éxito en SQLite! Redirigiendo...', 'success');

      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 1000);

    } catch (err) {
      showAlert(regAlert, 'Error de conexión al registrar en la base de datos.', 'danger');
      btnFinishReg.disabled = false;
      btnFinishReg.textContent = 'Completar Registro';
    }
  });

  // --------------------------------------------------------------------------
  // 4. RECUPERACIÓN DE CONTRASEÑA (REGLA DE SEGURIDAD V1.5)
  // --------------------------------------------------------------------------
  const forgotForm = document.getElementById('forgot-form');
  const forgotEmailInput = document.getElementById('forgot-email');
  const forgotAlert = document.getElementById('forgot-alert');
  const simulatedTokenBox = document.getElementById('simulated-token-box');
  const simulatedResetLink = document.getElementById('simulated-reset-link');

  forgotForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = forgotEmailInput.value.trim();

    if (!email) {
      showAlert(forgotAlert, 'Por favor ingrese su correo electrónico.', 'danger');
      return;
    }

    // Regla de seguridad neutra sin oráculo
    showAlert(
      forgotAlert,
      'Si ese correo está registrado, le enviamos un enlace para restablecer la contraseña.',
      'info'
    );
    simulatedTokenBox.style.display = 'block';
  });

  simulatedResetLink.addEventListener('click', (e) => {
    e.preventDefault();
    showView('reset');
  });

  // Helpers de alertas
  function showAlert(element, message, type) {
    element.className = `alert-box alert-${type}`;
    element.textContent = message;
    element.style.display = 'block';
  }

  function hideAlert(element) {
    element.style.display = 'none';
  }
});
