// index.js - Versión con popup personalizado
import { loadData, saveData, removeData } from './indexeddb-storage.js';
import { ensureSessionGuard, scheduleAutoLogout } from './auth-session.js';

const API_BASE = 'http://26.127.175.34:5000';

let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await ensureSessionGuard();
  if (!ok) return;
  await scheduleAutoLogout();

  const menuContainer = document.getElementById('menu-container');
  const menuGrid = menuContainer?.querySelector('.menu-grid');
  const overlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');

  // Cargar usuario actual
  currentUser = await loadData('userData');
  if (!currentUser) {
    location.href = 'login.html';
    return;
  }

  // Headers simples para autenticación
  const authHeaders = {
    'X-User-Email': currentUser.usuario,
    'Content-Type': 'application/json'
  };

  // Función helper para requests autenticados
  const apiRequest = async (url, options = {}) => {
    return fetch(url, {
      ...options,
      headers: { ...authHeaders, ...(options.headers || {}) }
    });
  };

  // ---------- Tema ----------
  setupThemeToggle();

  // ---------- Helpers ----------
  const showOverlay = (msg = 'Cargando...') => {
    if (loadingText) loadingText.textContent = msg;
    if (overlay) overlay.style.display = 'flex';
  };

  const hideOverlay = () => {
    if (overlay) overlay.style.display = 'none';
  };

  const normalizeFileName = (fileName) => fileName.replace(/\W+/g, "_");

  // ---------- Función para mostrar popup de notificación ----------
  function showNotificationPopup(message, type = 'info', duration = 4000) {
    // Crear el popup si no existe
    let popup = document.getElementById('notification-popup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'notification-popup';
      popup.className = 'notification-popup';
      document.body.appendChild(popup);
      
      // Agregar estilos CSS si no existen
      if (!document.getElementById('notification-popup-styles')) {
        const styles = document.createElement('style');
        styles.id = 'notification-popup-styles';
        styles.textContent = `
          .notification-popup {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 24px;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            z-index: 10000;
            max-width: 400px;
            transform: translateX(100%);
            transition: all 0.3s ease-in-out;
            border-left: 4px solid #007bff;
            font-family: system-ui, -apple-system, sans-serif;
            line-height: 1.4;
            opacity: 0;
            visibility: hidden;
          }
          
          .notification-popup.show {
            transform: translateX(0);
            opacity: 1;
            visibility: visible;
          }
          
          .notification-popup.error {
            border-left-color: #dc3545;
            background: #fff5f5;
          }
          
          .notification-popup.warning {
            border-left-color: #ffc107;
            background: #fffbf0;
          }
          
          .notification-popup.success {
            border-left-color: #28a745;
            background: #f0fff4;
          }
          
          .notification-popup .popup-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            font-weight: 600;
          }
          
          .notification-popup .popup-icon {
            font-size: 18px;
          }
          
          .notification-popup .popup-message {
            color: #333;
            font-size: 14px;
          }
          
          .notification-popup .close-btn {
            position: absolute;
            top: 8px;
            right: 12px;
            background: none;
            border: none;
            font-size: 18px;
            cursor: pointer;
            color: #666;
            padding: 4px;
          }
          
          .notification-popup .close-btn:hover {
            color: #333;
          }
          
          /* Modo oscuro */
          .dark-mode .notification-popup {
            background: #2d3748;
            color: #e2e8f0;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          }
          
          .dark-mode .notification-popup.error {
            background: #2d1b1b;
          }
          
          .dark-mode .notification-popup.warning {
            background: #2d2a1b;
          }
          
          .dark-mode .notification-popup.success {
            background: #1b2d1b;
          }
          
          .dark-mode .notification-popup .popup-message {
            color: #e2e8f0;
          }
        `;
        document.head.appendChild(styles);
      }
    }

    // Configurar icono según el tipo
    const icons = {
      info: 'ℹ️',
      error: '❌',
      warning: '⚠️',
      success: '✅'
    };

    const titles = {
      info: 'Información',
      error: 'Error',
      warning: 'Advertencia',
      success: 'Éxito'
    };

    // Actualizar contenido del popup
    popup.className = `notification-popup ${type}`;
    popup.innerHTML = `
      <button class="close-btn" onclick="this.parentElement.classList.remove('show'); setTimeout(() => this.parentElement.remove(), 300);">&times;</button>
      <div class="popup-header">
        <span class="popup-icon">${icons[type]}</span>
        <span>${titles[type]}</span>
      </div>
      <div class="popup-message">${message}</div>
    `;

    // Mostrar popup
    setTimeout(() => popup.classList.add('show'), 100);

    // Auto-ocultar después de la duración especificada
    setTimeout(() => {
      popup.classList.remove('show');
      // Remover el elemento del DOM después de la animación
      setTimeout(() => {
        if (popup && popup.parentElement) {
          popup.remove();
        }
      }, 300);
    }, duration);
  }

  // ---------- Cargar perfil del usuario ----------
  async function loadUserProfile() {
    try {
      const response = await apiRequest(`${API_BASE}/user/profile`);
      if (response.ok) {
        const profile = await response.json();

        // Actualizar usuario actual con datos completos del backend
        currentUser = {
          ...currentUser,
          id: profile.id,
          usuario: profile.usuario,
          rol: profile.rol,
          rolId: profile.rolId,
          facultad: profile.facultad,
          facultadCod: profile.facultadCod,
          carrera: profile.carrera,
          carreraCod: profile.carreraCod,
          estado: profile.estado
        };

        // Guardar datos actualizados
        await saveData('userData', currentUser);
        console.log('Usuario actualizado:', currentUser);
      }
    } catch (error) {
      console.warn('Error cargando perfil:', error);
    }
  }

  // ---------- Cargar permisos del usuario ----------
  async function loadUserPermissions() {
    try {
      const response = await apiRequest(`${API_BASE}/user/permissions`);
      if (response.ok) {
        const data = await response.json();
        await saveData('userPermissions', data.permissions);
        return data.permissions;
      }
    } catch (error) {
      console.warn('Error cargando permisos:', error);
    }

    // Permisos por defecto restrictivos
    return {
      can_upload: false,
      can_delete: false,
      can_view_all_faculties: false,
      can_manage_users: false,
      can_send_emails: false,
      can_edit_templates: false,
      can_access_admin_panel: false
    };
  }

  // ---------- Cargar plantillas de email ----------
  async function loadEmailTemplates() {
    try {
      const local = await loadData('emailTemplates');
      if (local && isValidTemplates(local)) {
        console.log('Plantillas ya cargadas localmente');
        return;
      }

      console.log('Cargando plantillas desde API...');
      const templates = { correoAutoridad: 'alvaro.espinozabu@ug.edu.ec' };
      const tipos = ['seguimiento', 'nee', 'tercera_matricula', 'parcial', 'final'];

      // Cargar correo de autoridad
      try {
        const correoResp = await apiRequest(`${API_BASE}/correo-autoridad`);
        if (correoResp.ok) {
          const correoData = await correoResp.json();
          templates.correoAutoridad = correoData.correoAutoridad || templates.correoAutoridad;
        }
      } catch (e) {
        console.warn('Error cargando correo autoridad:', e);
      }

      // Cargar cada tipo de plantilla
      for (const tipo of tipos) {
        try {
          const resp = await apiRequest(`${API_BASE}/plantillas?tipo=${tipo}`);
          if (resp.ok) {
            const data = await resp.json();
            templates[tipo] = {
              autoridad: data.plantillas?.autoridad || '',
              docente: data.plantillas?.docente || data.plantillas?.docentes || '',
              estudiante: data.plantillas?.estudiante || data.plantillas?.estudiantes || ''
            };
          } else {
            templates[tipo] = { autoridad: '', docente: '', estudiante: '' };
          }
        } catch (e) {
          console.warn(`Error cargando plantilla ${tipo}:`, e);
          templates[tipo] = { autoridad: '', docente: '', estudiante: '' };
        }
      }

      await saveData('emailTemplates', templates);
      console.log('Plantillas guardadas correctamente');
    } catch (error) {
      console.error('Error general cargando plantillas:', error);
    }
  }

  function isValidTemplates(templates) {
    if (!templates) return false;
    const tipos = ['seguimiento', 'nee', 'tercera_matricula', 'parcial', 'final'];
    return tipos.some(tipo => {
      const t = templates[tipo];
      return t && (t.autoridad?.trim() || t.docente?.trim() || t.estudiante?.trim());
    });
  }

  // Reemplaza la función syncFiles existente en index.js
async function syncFiles() {
  try {
    showOverlay('Verificando archivos...');

    // Obtener archivos filtrados por facultad del usuario
    const response = await apiRequest(`${API_BASE}/files`);
    if (!response.ok) {
      console.warn('Error obteniendo lista de archivos');
      return false;
    }

    const data = await response.json();
    const files = Array.isArray(data) ? data : (data.archivos || []);

    // NUEVA VALIDACIÓN: Verificar si hay mensaje específico de "no archivos"
    if (data.mensaje && data.mensaje.includes('aún no cuenta con archivos')) {
      console.log(`⚠️ ${data.mensaje}`);
      hideOverlay();
      showNotificationPopup(data.mensaje, 'warning', 5000);
      return false;
    }

    if (files.length === 0) {
      console.log('No hay archivos disponibles para tu facultad');
      hideOverlay();
      showNotificationPopup('No hay archivos disponibles para tu facultad', 'warning', 5000);
      return false;
    }

    console.log(`Encontrados ${files.length} archivos para la facultad ${currentUser.facultadCod}`);

    // Verificar archivos que necesitan descarga
    await ensureXLSXLoaded();
    const missingFiles = [];

    for (const file of files) {
      const nombre = file.nombre || file.NombreArchivo;
      if (!nombre) continue;

      const localKey = `academicTrackingData_${normalizeFileName(nombre)}`;
      const localData = await loadData(localKey);

      if (!localData || !Array.isArray(localData) || localData.length === 0) {
        missingFiles.push(file);
      }
    }

    console.log(`${missingFiles.length} archivos por descargar`);

    // Descargar archivos faltantes
    if (missingFiles.length > 0) {
      let downloadCount = 0;

      for (const file of missingFiles) {
        const nombre = file.nombre || file.NombreArchivo;
        const id = file.id;

        try {
          showOverlay(`Descargando "${nombre}" (${downloadCount + 1}/${missingFiles.length})...`);

          const fileResp = await apiRequest(`${API_BASE}/download/${id}`);
          if (!fileResp.ok) {
            console.warn(`Error descargando archivo ${nombre}: ${fileResp.status}`);
            continue;
          }

          const blob = await fileResp.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);

          const localKey = `academicTrackingData_${normalizeFileName(nombre)}`;
          await saveData(localKey, jsonData);

          downloadCount++;
          console.log(`Descargado: ${nombre} (${jsonData.length} registros) - Facultad: ${file.facultadCod || file.FacultadCod}`);
        } catch (error) {
          console.error(`Error descargando ${nombre}:`, error);
        }
      }

      if (downloadCount > 0) {
        await saveData('lastSyncAt', new Date().toISOString());
        await saveData('lastSyncFacultad', currentUser.facultadCod);
        showOverlay(`${downloadCount} archivos descargados correctamente`);
        setTimeout(hideOverlay, 2000);
        return true;
      } else {
        hideOverlay();
        showNotificationPopup('No se pudieron descargar los archivos. Verifique su conexión e intente nuevamente.', 'error', 6000);
        return false;
      }
    } else {
      console.log('Todos los archivos ya están sincronizados localmente');
      return false;
    }

  } catch (error) {
    console.error('Error en sincronización:', error);
    hideOverlay();
    showNotificationPopup('Error al sincronizar archivos. Verifique su conexión e intente nuevamente.', 'error', 6000);
    return false;
  }
}

  async function ensureXLSXLoaded() {
    if (window.XLSX) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('No se pudo cargar SheetJS'));
      document.head.appendChild(script);
    });
  }

  // ---------- Mostrar información del usuario ----------
  function displayUserInfo() {
    const userInfoContainer = document.getElementById('navbar-userinfo');
    if (!userInfoContainer || !currentUser) return;

    const name = currentUser.usuario || 'Sin nombre';
    const role = currentUser.rol || 'Sin rol';
    const faculty = currentUser.facultad || 'Sin facultad';
    const initials = getInitials(name);

    userInfoContainer.innerHTML = `
      <div class="user-block" title="${escapeHtml(name)} — ${escapeHtml(role)}">
        <div class="avatar">${initials}</div>
        <div class="user-meta">
          <div class="user-name">${escapeHtml(name)}</div>
          <div class="user-tags">
            <div class="user-sub">${escapeHtml(role)}</div>
            <div class="user-fac">${escapeHtml(faculty)}</div>
          </div>
        </div>
      </div>
    `;

    // Botón logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        await removeData('isLoggedIn');
        await removeData('sessionExpiresAt');
        await removeData('userData');
        await removeData('userPermissions');
        location.href = 'login.html';
      };
    }
  }

  function getInitials(name = '') {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function escapeHtml(str = '') {
    return String(str).replace(/[&<>"']/g, (s) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[s]));
  }

  // ---------- Crear menú basado en permisos ----------
  async function createMenu() {
    if (!menuContainer || !menuGrid) return;

    const permissions = await loadUserPermissions();
    const userRole = currentUser?.rol?.toLowerCase() || '';

    // Definir módulos disponibles
    const modules = [
      {
        id: 'academic-tracking',
        icon: 'fas fa-user-check',
        title: 'Seguimiento Académico',
        description: 'Notificaciones a docente y estudiantes por 2da y 3era vez registrados',
        url: 'Modules/academic-tracking.html',
        roles: ['admin', 'decano', 'coordinador']
      },
      {
        id: 'nee-control',
        icon: 'fas fa-child',
        title: 'Control NEE',
        description: 'Seguimiento a estudiantes con necesidades especiales',
        url: 'Modules/nee-control.html',
        roles: ['admin', 'decano', 'coordinador']
      },
      {
        id: 'tercera-matricula',
        icon: 'fas fa-users',
        title: 'Tercera Matrícula',
        description: 'Notificaciones para estudiantes con tercera matricula NO registrados',
        url: 'Modules/tercera-matricula.html',
        roles: ['admin', 'decano', 'coordinador']
      },
      {
        id: 'control-parcial',
        icon: 'fas fa-clipboard',
        title: 'Control Parcial',
        description: 'Estudiantes reprobados por asistencia o calificación hasta 1er. parcial',
        url: 'Modules/control-parcial.html',
        roles: ['admin', 'decano', 'coordinador']
      },
      {
        id: 'control-final',
        icon: 'fas fa-flag-checkered',
        title: 'Control Final',
        description: 'Estudiantes reprobados final parcial',
        url: 'Modules/control-final.html',
        roles: ['admin', 'decano', 'coordinador']
      },
      {
        id: 'top-promedios',
        icon: 'fas fa-trophy',
        title: 'Top Promedios',
        description: 'Consulta de los tops 5 en promedio por carrera',
        url: 'Modules/top-promedios.html',
        roles: ['admin', 'decano', 'coordinador', 'operador']
      },
      {
        id: 'consulta-estudiante',
        icon: 'fas fa-graduation-cap',
        title: 'Consulta Estudiante',
        description: 'Revisión de historial académico por estudiante',
        url: 'Modules/consulta-estudiante.html',
        roles: ['admin', 'decano', 'coordinador', 'operador']
      },
      {
        id: 'consulta-docente',
        icon: 'fas fa-user',
        title: 'Consulta Docente',
        description: 'Revisión de historial académico por Docente',
        url: 'Modules/consulta-docente.html',
        roles: ['admin', 'decano', 'coordinador', 'operador']
      },
      {
        id: 'distribucion-docente',
        icon: 'fas fa-chalkboard-teacher',
        title: 'Distribución Docente',
        description: 'Carga académica y clases (mapa calor)',
        url: 'Modules/distribucion-docente.html',
        roles: ['admin', 'decano']
      },
      {
        id: 'reportes',
        icon: 'fas fa-chart-bar',
        title: 'Reportes',
        description: 'Estadística general de los datos ingresados',
        url: 'Modules/reportes.html',
        roles: ['admin', 'decano', 'rector']
      },
      {
        id: 'config',
        icon: 'fas fa-cogs',
        title: 'Configuración',
        description: 'Configuración y parametrizaciones generales del sistema',
        url: 'Modules/config.html',
        roles: ['admin', 'decano', 'rector']
      }
    ];

    // Filtrar módulos según el rol del usuario
    const allowedModules = modules.filter(module =>
      module.roles.includes(userRole)
    );

    // Agregar panel de administración si es admin
    if (userRole === 'admin') {
      allowedModules.push({
        id: 'admin-panel',
        icon: 'fas fa-user-shield',
        title: 'Administración',
        description: 'Panel de administración de usuarios y sistema',
        onClick: openAdminPanel
      });
    }

    // Mostrar mensaje si no hay módulos disponibles
    if (allowedModules.length === 0) {
      menuGrid.innerHTML = `
        <div class="no-permissions">
          <i class="fas fa-lock"></i>
          <h3>Sin permisos asignados</h3>
          <p>Contacta al administrador para obtener acceso a los módulos.</p>
        </div>
      `;
      return;
    }

    // Crear elementos del menú
    menuGrid.innerHTML = '';
    allowedModules.forEach(module => {
      const element = document.createElement('a');
      element.className = 'menu-item';
      element.innerHTML = `
        <i class="${module.icon}"></i>
        <h3>${module.title}</h3>
        <p>${module.description}</p>
      `;

      if (module.onClick) {
        element.href = '#';
        element.addEventListener('click', (e) => {
          e.preventDefault();
          module.onClick();
        });
      } else {
        element.href = module.url;
      }

      menuGrid.appendChild(element);
    });
  }

  async function openAdminPanel() {
    try {
      showOverlay('Accediendo al panel de administración...');

      const response = await apiRequest(`${API_BASE}/admin/panel`, {
        method: 'POST'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error response:', response.status, errorData);

        hideOverlay();
        showNotificationPopup(`No tienes permisos para acceder al panel de administración. Status: ${response.status}`, 'error', 5000);
        return;
      }

      const data = await response.json();
      console.log('Admin panel response:', data);

      hideOverlay();

      // Opción 1: Redirección relativa
      if (data.url) {
        window.location.href = data.url;
      }

    } catch (error) {
      console.error('Error abriendo panel admin:', error);
      hideOverlay();
      showNotificationPopup('Error de conexión al acceder al panel de administración', 'error', 5000);
    }
  }

  // ---------- Configuración del tema ----------
  function setupThemeToggle() {
    let btn = document.getElementById('theme-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'theme-toggle';
      document.body.appendChild(btn);
    }

    function updateTheme() {
      const isDark = document.documentElement.classList.contains('dark-mode');
      btn.textContent = isDark ? '☀️' : '🌙';
      btn.title = isDark ? 'Modo claro' : 'Modo oscuro';
    }

    // Aplicar tema guardado
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark-mode');
    }

    btn.addEventListener('click', () => {
      const isDark = document.documentElement.classList.toggle('dark-mode');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      updateTheme();
    });

    updateTheme();
  }

  // ---------- Detectar último período ----------
  function findLatestPeriod(periods) {
    return periods.sort((a, b) => String(b).localeCompare(String(a)))[0];
  }

  async function updateLatestPeriod() {
    const totalKey = 'academicTrackingData_' + normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL.xlsx');
    let data = await loadData(totalKey);

    if (!Array.isArray(data) || data.length === 0) {
      const altKey = 'academicTrackingData_' + normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL.xlsx');
      data = await loadData(altKey);
      if (!Array.isArray(data) || data.length === 0) {
        console.warn('No se encontró dataset para obtener período');
        return;
      }
    }

    const periods = [...new Set(
      data.map(r => (r['PERIODO'] || '').toString().trim()).filter(Boolean)
    )];

    if (periods.length === 0) {
      console.warn('No se encontraron períodos');
      return;
    }

    const latest = findLatestPeriod(periods);
    const filtered = data.filter(r => (r['PERIODO'] || '').toString().trim() === latest);

    localStorage.setItem('selectedPeriod', latest);
    await saveData('academicTrackingData_REPORTE_POR_SEMESTRE', filtered);
    console.log(`Período actualizado: ${latest}`);
  }

  // ---------- Flujo principal ----------
  const isLoggedIn = await loadData('isLoggedIn');
  if (!isLoggedIn) {
    location.href = 'login.html';
    return;
  }

  // Cargar perfil del usuario
  await loadUserProfile();

  // Mostrar información del usuario
  displayUserInfo();

  // Cargar plantillas de email
  await loadEmailTemplates();

  // Sincronizar archivos
  const didSync = await syncFiles();
  if (didSync) {
    await updateLatestPeriod();
  } else {
    hideOverlay();
  }

  // Crear menú
  await createMenu();

  console.log('Sistema iniciado para:', {
    usuario: currentUser.usuario,
    rol: currentUser.rol,
    facultad: currentUser.facultad
  });
});