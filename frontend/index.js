// index.js
import { loadData, saveData, removeData } from './indexeddb-storage.js';
import { ensureSessionGuard, scheduleAutoLogout } from './auth-session.js';

const API_BASE = 'http://26.127.175.34:5000';

let __roleReloading = false;
let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await ensureSessionGuard();
  if (!ok) return;
  await scheduleAutoLogout();

  const menuContainer = document.getElementById('menu-container');
  const menuGrid = menuContainer?.querySelector('.menu-grid');
  const overlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');

  // Cargar información del usuario
  currentUser = await loadData('userData');
  if (!currentUser) {
    location.href = 'login.html';
    return;
  }

  // ---------- Configurar headers de autenticación ----------
  const authHeaders = {
    'X-User-Email': currentUser.usuario,
    'Content-Type': 'application/json'
  };

  // Función helper para hacer peticiones autenticadas
  const authenticatedFetch = async (url, options = {}) => {
    const config = {
      ...options,
      headers: {
        ...authHeaders,
        ...(options.headers || {})
      }
    };
    return fetch(url, config);
  };

  // ---------- Tema (dark / light) ----------
  let btn = document.getElementById('theme-toggle');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'theme-toggle';
    document.body.appendChild(btn);
  }

  function updateToggleUI() {
    const isDark = document.documentElement.classList.contains('dark-mode');
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    btn.setAttribute('title', isDark ? 'Modo claro' : 'Modo oscuro');
    btn.setAttribute('aria-pressed', String(isDark));
  }

  btn.replaceWith(btn.cloneNode(true));
  btn = document.getElementById('theme-toggle');

  const initialTheme = localStorage.getItem('theme');
  if (initialTheme === 'dark') document.documentElement.classList.add('dark-mode');
  if (initialTheme === 'light') document.documentElement.classList.remove('dark-mode');

  btn.addEventListener('click', () => {
    const root = document.documentElement;
    const willDark = !root.classList.contains('dark-mode');
    root.classList.toggle('dark-mode', willDark);
    localStorage.setItem('theme', willDark ? 'dark' : 'light');
    updateToggleUI();
  }, { passive: true });

  updateToggleUI();

  // ---------- Helpers ----------
  const normalizeFileName = (fileName) => fileName.replace(/\W+/g, "_");

  const buildFilesSignature = (files) => {
    if (!Array.isArray(files)) return '';
    const rows = files.map(f => {
      const nombre = String(f.nombre ?? f.NombreArchivo ?? '').trim();
      const id = String(f.id ?? '').trim();
      const fecha = String(f.fecha ?? f.fechaSubida ?? f.FechaSubida ?? f.updatedAt ?? f.actualizado ?? '').trim();
      const facultad = String(f.facultad ?? '').trim();
      return `${nombre}|${id}|${fecha}|${facultad}`;
    });
    return rows.sort().join('::');
  };

  const showOverlay = (msg = 'Procesando datos...') => {
    if (loadingText) loadingText.textContent = ` ${msg}`;
    if (overlay) overlay.style.display = 'flex';
  };
  const hideOverlay = () => { if (overlay) overlay.style.display = 'none'; };

  function getRoleFromUserData(obj) {
    try {
      return String(obj?.rolNombre ?? obj?.rol ?? '').trim().toLowerCase();
    } catch {
      return '';
    }
  }

  function getUsernameFromUserData(obj) {
    try {
      return String(obj?.usuario ?? obj?.email ?? '').trim();
    } catch {
      return '';
    }
  }

  async function ensureXLSXLoaded() {
    if (window.XLSX) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar SheetJS'));
      document.head.appendChild(s);
    });
  }

  // ---------- Cargar permisos de módulos desde el backend ----------
  async function loadModulePermissions() {
    try {
      const resp = await authenticatedFetch(`${API_BASE}/api/permissions/modules`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      await saveData('modulePermissions', data.permissions);
      await saveData('currentUserInfo', data.userInfo);
      return data.permissions;
    } catch (e) {
      console.error('Error al cargar permisos de módulos:', e);
      // Permisos por defecto muy restrictivos
      return {
        'academic-tracking': false,
        'nee-control': false,
        'tercera-matricula': false,
        'control-parcial': false,
        'control-final': false,
        'top-promedios': true,
        'consulta-estudiante': true,
        'consulta-docente': true,
        'distribucion-docente': false,
        'reportes': false,
        'config': false,
        'admin-panel': false
      };
    }
  }

  // ---------- Cargar plantillas con tipo ----------
  async function ensureEmailTemplates() {
    try {
      const local = await loadData('emailTemplates');
      if (local && local.seguimiento) {
        console.log('✅ Plantillas de email ya existen en IndexedDB');
        return;
      }

      console.log('📧 Cargando plantillas de email por defecto...');
      
      // Cargar plantillas por tipo
      const tipos = ['seguimiento', 'nee', 'tercera_matricula', 'parcial', 'final'];
      const templates = {
        correoAutoridad: 'alvaro.espinozabu@ug.edu.ec'
      };

      for (const tipo of tipos) {
        try {
          const res = await authenticatedFetch(`${API_BASE}/plantillas?tipo=${tipo}`);
          const data = await res.json();
          templates[tipo] = data;
        } catch (error) {
          console.warn(`⚠️ Error al cargar plantilla ${tipo}:`, error);
          templates[tipo] = { autoridad: '', docente: '', estudiante: '' };
        }
      }

      await saveData('emailTemplates', templates);
      console.log('✅ Plantillas de email cargadas y guardadas localmente');

    } catch (error) {
      console.warn('⚠️ Error general al cargar plantillas:', error);
      
      const fallbackTemplates = {
        correoAutoridad: 'alvaro.espinozabu@ug.edu.ec',
        seguimiento: { autoridad: '', docente: '', estudiante: '' },
        nee: { autoridad: '', docente: '', estudiante: '' },
        tercera_matricula: { autoridad: '', docente: '', estudiante: '' },
        parcial: { autoridad: '', docente: '', estudiante: '' },
        final: { autoridad: '', docente: '', estudiante: '' }
      };

      await saveData('emailTemplates', fallbackTemplates);
      console.log('✅ Plantillas de email por defecto guardadas localmente');
    }
  }

  // ---------- Validar rol contra backend y refrescar si cambió ----------
  async function validateRoleAndRefreshIfChanged() {
    const username = getUsernameFromUserData(currentUser);
    if (!username) return;

    try {
      const url = `${API_BASE}/usuarios?q=${encodeURIComponent(username)}&limit=1&page=0`;
      const resp = await authenticatedFetch(url);
      if (!resp.ok) return;

      const body = await resp.json();
      const rows = Array.isArray(body?.data) ? body.data : [];

      if (!rows.length) return;

      const match = rows.find(r => String(r?.usuario ?? '').toLowerCase() === username.toLowerCase()) || rows[0];
      const backendRole = String(match?.rolNombre ?? '').trim().toLowerCase();
      const currentRole = getRoleFromUserData(currentUser);
      
      if (backendRole && backendRole !== currentRole) {
        // Actualizar datos del usuario con información completa del backend
        const updatedUser = {
          ...currentUser,
          ...match
        };
        await saveData('userData', updatedUser);

        __roleReloading = true;
        location.reload();
      }
    } catch (e) {
      console.warn('No se pudo validar rol en backend:', e);
    }
  }

  // ---------- Sincronización de archivos filtrada por facultad ----------
  async function syncFilesFromBackendIfNeeded() {
    try {
      const resp = await authenticatedFetch(`${API_BASE}/files`);
      if (!resp.ok) throw new Error(`/files respondió ${resp.status}`);
      const files = await resp.json();

      const currentSignature = buildFilesSignature(files);
      const storedSignature = await loadData('filesSignature');

      if (storedSignature && storedSignature === currentSignature) {
        return false;
      }

      showOverlay('Preparando sincronización...');
      await ensureXLSXLoaded();

      const processedFiles = [];
      const total = files.length;
      let done = 0;

      for (const f of files) {
        const nombre = f.nombre ?? f.NombreArchivo;
        const id = f.id;
        if (!nombre || !id) { 
          done++; 
          continue; 
        }

        showOverlay(`Descargando "${nombre}" (${done + 1}/${total})...`);
        const fileRes = await authenticatedFetch(`${API_BASE}/download/${id}`);
        if (!fileRes.ok) { 
          console.warn('No se pudo descargar:', nombre, id); 
          done++; 
          continue; 
        }

        const blob = await fileRes.blob();
        showOverlay(`Procesando "${nombre}" (${done + 1}/${total})...`);
        const arrayBuffer = await blob.arrayBuffer();
        const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const key = `academicTrackingData_${normalizeFileName(nombre)}`;
        await saveData(key, jsonData);
        processedFiles.push(nombre);
        done++;
      }

      await saveData('processedFiles', processedFiles);
      await saveData('filesSignature', currentSignature);
      return true;
    } catch (err) {
      console.error('⚠️ Error al sincronizar con backend:', err);
      return false;
    } finally {
      hideOverlay();
    }
  }

  // ---------- Detectar último periodo ----------
  function findLatestPeriod(periods) {
    return periods.sort((a, b) => String(b).localeCompare(String(a)))[0];
  }

  async function applyLatestPeriodFromReport() {
    const TOTAL_KEY = 'academicTrackingData_' + normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL.xlsx');
    let data = await loadData(TOTAL_KEY);

    if (!Array.isArray(data) || data.length === 0) {
      const ALT_KEY = 'academicTrackingData_' + normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL.xlsx');
      data = await loadData(ALT_KEY);
      if (!Array.isArray(data) || data.length === 0) {
        console.warn('ℹ️ No se encontró dataset TOTAL ni PARCIAL para obtener PERIODO.');
        return;
      }
    }

    const periods = [...new Set(
      data.map(r => (r['PERIODO'] ?? '').toString().trim()).filter(Boolean)
    )];

    if (periods.length === 0) {
      console.warn('ℹ️ No se encontraron valores de PERIODO en el dataset.');
      return;
    }

    const latest = findLatestPeriod(periods);
    const filtered = data.filter(r => (r['PERIODO'] ?? '').toString().trim() === latest);

    localStorage.setItem('selectedPeriod', latest);
    await saveData('academicTrackingData_REPORTE_POR_SEMESTRE', filtered);
    await saveData('lastPeriodUpdatedAt', new Date().toISOString());
  }

  // ---------- Mostrar información en el NAVBAR (reemplaze displayUserInfo) ----------
  function getInitials(name = '') {
    try {
      const parts = name.trim().split(/\s+/);
      if (!parts.length) return '';
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    } catch { return ''; }
  }
  function escapeHtml(str = '') {
    return String(str).replace(/[&<>"'`]/g, (s) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[s]));
  }

  function displayNavbarInfo() {
    const userInfoContainer = document.getElementById('navbar-userinfo');
    if (!userInfoContainer || !currentUser) return;

    const name = getUsernameFromUserData(currentUser) || 'Sin nombre';
    const role = currentUser.rolNombre || 'No definido';
    const faculty = currentUser.facultadNombre || currentUser.facultadCod || 'No asignada';
    const initials = getInitials(name);

    userInfoContainer.innerHTML = `
      <div class="user-block" title="${escapeHtml(name)} — ${escapeHtml(role)}">
        <div class="avatar" aria-hidden="true">${initials}</div>
        <div class="user-meta">
          <div class="user-name">${escapeHtml(name)}</div>
          <div class="user-tags">
            <div class="user-sub">${escapeHtml(role)}</div>
            <div class="user-fac">${escapeHtml(faculty)}</div>
          </div>
        </div>
      </div>
    `;

    // Conectar botón cerrar sesión
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        await removeData('isLoggedIn');
        await removeData('sessionExpiresAt');
        await removeData('userData');
        await removeData('modulePermissions');
        await removeData('currentUserInfo');
        location.href = 'login.html';
      };
    }
    // const fullName = `${currentUser.nombres || ''} ${currentUser.apellidos || ''}`.trim();
    // const displayName = fullName || currentUser.usuario; // si no hay nombres, muestra el usuario

  }

  

  // ---------- Menú con validación de permisos ----------
  async function populateMenu() {
    if (!menuContainer || !menuGrid) return;

    // Cargar permisos desde el backend
    const permissions = await loadModulePermissions();
    const isAdmin = getRoleFromUserData(currentUser) === 'admin';
    const username = getUsernameFromUserData(currentUser);

    const allMenuItems = [
      { 
        id: 'academic-tracking', 
        icon: 'fas fa-user-check', 
        title: 'Seguimiento Académico', 
        description: 'Notificaciones a docente y estudiantes por 2da y 3era vez registrados', 
        url: 'Modules/academic-tracking.html' 
      },
      { 
        id: 'nee-control', 
        icon: 'fas fa-child', 
        title: 'Control NEE', 
        description: 'Seguimiento a estudiantes con necesidades especiales', 
        url: 'Modules/nee-control.html' 
      },
      { 
        id: 'tercera-matricula', 
        icon: 'fas fa-users', 
        title: 'Tercera Matrícula', 
        description: 'Notificaciones para estudiantes con tercera matricula NO registrados', 
        url: 'Modules/tercera-matricula.html' 
      },
      { 
        id: 'control-parcial', 
        icon: 'fas fa-clipboard', 
        title: 'Control Parcial', 
        description: 'Estudiantes reprobados por asistencia o calificación hasta 1er. parcial', 
        url: 'Modules/control-parcial.html' 
      },
      { 
        id: 'control-final', 
        icon: 'fas fa-flag-checkered', 
        title: 'Control Final', 
        description: 'Estudiantes reprobados final parcial', 
        url: 'Modules/control-final.html' 
      },
      { 
        id: 'top-promedios', 
        icon: 'fas fa-trophy', 
        title: 'Top Promedios', 
        description: 'Consulta de los tops 5 en promedio por carrera', 
        url: 'Modules/top-promedios.html' 
      },
      { 
        id: 'consulta-estudiante', 
        icon: 'fas fa-graduation-cap', 
        title: 'Consulta Estudiante', 
        description: 'Revisión de historial académico por estudiante', 
        url: 'Modules/consulta-estudiante.html' 
      },
      { 
        id: 'consulta-docente', 
        icon: 'fas fa-user', 
        title: 'Consulta Docente', 
        description: 'Revisión de historial académico por Docente', 
        url: 'Modules/consulta-docente.html' 
      },
      { 
        id: 'distribucion-docente', 
        icon: 'fas fa-chalkboard-teacher', 
        title: 'Distribución Docente', 
        description: 'Carga académica y clases (mapa calor)', 
        url: 'Modules/distribucion-docente.html' 
      },
      { 
        id: 'reportes', 
        icon: 'fas fa-chart-bar', 
        title: 'Reportes', 
        description: 'Estadística general de los datos ingresados', 
        url: 'Modules/reportes.html' 
      },
      { 
        id: 'config', 
        icon: 'fas fa-cogs', 
        title: 'Configuración', 
        description: 'Configuración y parametrizaciones generales del sistema', 
        url: 'Modules/config.html' 
      }
    ];

    // Filtrar módulos según permisos
    const allowedItems = allMenuItems.filter(item => permissions[item.id] === true);

    // Agregar panel de administración si es admin
    if (permissions['admin-panel']) {
      allowedItems.push({
        id: 'admin-panel',
        icon: 'fas fa-user-shield',
        title: 'Administración',
        description: 'Panel de administración de usuarios y sistema',
        onClick: () => openAdmin(username)
      });
    }

    // Mostrar mensaje si no tiene permisos
    if (allowedItems.length === 0) {
      menuGrid.innerHTML = `
        <div class="no-permissions">
          <i class="fas fa-lock"></i>
          <h3>Sin permisos asignados</h3>
          <p>Contacta al administrador para obtener acceso a los módulos del sistema.</p>
        </div>
      `;
      return;
    }

    // Renderizar elementos del menú
    menuGrid.innerHTML = '';
    for (const item of allowedItems) {
      const el = document.createElement('a');
      el.className = 'menu-item';
      el.innerHTML = `
        <i class="${item.icon}"></i>
        <h3>${item.title}</h3>
        <p>${item.description}</p>
      `;
      
      if (item.onClick) {
        el.href = '#';
        el.addEventListener('click', (e) => { 
          e.preventDefault(); 
          item.onClick(); 
        });
      } else {
        el.href = item.url;
      }
      
      menuGrid.appendChild(el);
    }
    
  }

  async function openAdmin(username) {
    try {
      const resp = await authenticatedFetch(`${API_BASE}/admin/link`, {
        method: 'POST',
        body: JSON.stringify({ usuario: username })
      });
      
      if (!resp.ok) {
        alert('No tienes permisos para acceder al panel de administración.');
        return;
      }
      
      const { url } = await resp.json();
      window.location.href = url;
    } catch (e) {
      console.error(e);
      alert('Error al solicitar acceso a la administración.');
    }
  }

  // ---------- Flujo principal ----------
  const isLoggedIn = await loadData('isLoggedIn');
  if (!isLoggedIn) {
    location.href = 'login.html';
    return;
  }

  // Validar rol actualizado desde backend
  await validateRoleAndRefreshIfChanged();
  if (__roleReloading) return;

  // Mostrar información del usuario
  displayNavbarInfo();


  // Cargar plantillas de email
  await ensureEmailTemplates();

  // Sincronizar archivos (ahora filtrados por facultad)
  showOverlay('Verificando archivos de tu facultad...');
  const didSync = await syncFilesFromBackendIfNeeded();

  if (didSync) {
    await applyLatestPeriodFromReport();
    showOverlay('Archivos sincronizados correctamente');
    setTimeout(hideOverlay, 1500);
  } else {
    hideOverlay();
  }

  // Cargar y renderizar menú con permisos
  await populateMenu();

  console.log('Sistema FACAF iniciado correctamente para:', {
    usuario: currentUser.usuario,
    rol: currentUser.rolNombre,
    facultad: currentUser.facultadNombre || currentUser.facultadCod
  });
});