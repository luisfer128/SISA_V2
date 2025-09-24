// panel-admin.js - Versión ultra compacta
import { loadData, saveData } from '../indexeddb-storage.js';

const API_BASE = 'http://26.127.175.34:5000', DEBUG = false;
const $ = id => document.getElementById(id);
const overlay = $('loading-overlay'), usersTbody = $('usersTbody'), usersTable = $('usersTable');
const usuarioInput = $('usuario-input'), rolSelect = $('rol-select'), activoCheck = $('activo-check');
const activoLabel = $('activo-label'), facultadSelect = $('facultad-select'), carreraSelect = $('carrera-select');
const createUserBtn = $('createUserBtn'), updateUserBtn = $('updateUserBtn'), clearFormBtn = $('clearFormBtn');
const refreshBtn = $('refreshUsersBtn'), searchText = $('searchText'), filterRol = $('filterRol');
const filterActivo = $('filterActivo'), applyFiltersBtn = $('applyFiltersBtn'), resetFiltersBtn = $('resetFiltersBtn');
const loadMoreBtn = $('loadMoreBtn'), [statTotal, statAdmins, statActivos] = ['stat-total', 'stat-admins', 'stat-activos'].map($);
const [manageFacultiesBtn, manageCareersBtn] = ['manageFacultiesBtn', 'manageCareersBtn'].map($);

let USERS_CACHE = [], selectedId = null, page = 0;
const PAGE_SIZE = 20, CACHE_KEY = 'admin_users_cache_v2';
window.catalogEditingId = null;

// Utils compactos
const showOverlay = (msg = 'Procesando...') => overlay && (overlay.style.display = 'flex', overlay.querySelector('.loading-spinner').innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${msg}`);
const hideOverlay = () => overlay && (overlay.style.display = 'none');
const norm = v => String(v || '').trim();
const asBool = v => [true, 1, '1', 'true', 'True'].includes(v);
const normalizeRole = r => norm(r).toLowerCase();

// Modal compacto
const openModal = ({ title = 'Aviso', message = '', showCancel = false, acceptText = 'Aceptar', cancelText = 'Cancelar', icon = null }) => 
  new Promise(resolve => {
    const backdrop = $('modal-backdrop'), [t, m, ok, ko, ic] = ['modal-title', 'modal-message', 'modal-accept', 'modal-cancel', 'modal-icon'].map($);
    if (!backdrop || !t || !m || !ok || !ko) return resolve(false);
    
    t.textContent = title; m.textContent = message; ok.textContent = acceptText; ko.textContent = cancelText;
    ko.style.display = showCancel ? '' : 'none';
    ic.style.display = icon ? '' : 'none';
    if (icon) ic.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    
    const close = val => (backdrop.style.display = 'none', [ok, ko, backdrop, document].forEach((el, i) => el.removeEventListener(['click', 'click', 'click', 'keydown'][i], [onOk, onKo, onBackdrop, onEsc][i])), resolve(val));
    const onOk = () => close(true), onKo = () => close(false), onBackdrop = e => e.target === backdrop && close(false), onEsc = e => e.key === 'Escape' && close(false);
    
    [ok, ko, backdrop, document].forEach((el, i) => el.addEventListener(['click', 'click', 'click', 'keydown'][i], [onOk, onKo, onBackdrop, onEsc][i]));
    backdrop.style.display = 'flex';
  });

const modalInfo = (msg, title = 'Aviso') => openModal({ title, message: msg, acceptText: 'Entendido', icon: 'fa-circle-info' });
const modalError = (msg, title = 'Error') => openModal({ title, message: msg, acceptText: 'Cerrar', icon: 'fa-triangle-exclamation' });
const modalConfirm = (msg, title = 'Confirmar', acceptText = 'Sí', cancelText = 'No') => openModal({ title, message: msg, showCancel: true, acceptText, cancelText, icon: 'fa-circle-question' });

// Error banner
const errorBannerId = 'admin-error-banner';
const showErrorBanner = msg => {
  let el = $(errorBannerId);
  if (!el) {
    el = document.createElement('div');
    el.id = errorBannerId;
    el.style.cssText = 'margin:10px 0;padding:10px;border-radius:8px;border:1px solid #fca5a5;background:#fee2e2;color:#991b1b;font-weight:600;';
    usersTable?.parentElement?.insertAdjacentElement('beforebegin', el);
  }
  el.textContent = msg;
};
const hideErrorBanner = () => $(errorBannerId)?.remove();

// Verificaciones compactas
const verificarElementosDOM = () => {
  const elementos = { overlay, usersTbody, usersTable, usuarioInput, rolSelect, activoCheck, activoLabel, facultadSelect, carreraSelect, createUserBtn, updateUserBtn, clearFormBtn, refreshBtn, searchText, filterRol, filterActivo, applyFiltersBtn, resetFiltersBtn, loadMoreBtn, statTotal, statAdmins, statActivos };
  const faltantes = Object.entries(elementos).filter(([, el]) => !el).map(([name]) => name);
  return faltantes.length === 0 || (console.error('❌ Elementos DOM faltantes:', faltantes), false);
};

const verificarSesion = async () => {
  const userData = await loadData('userData');
  if (!userData) throw new Error('No hay datos de usuario');
  const userEmail = userData.usuario || userData.email || userData.user;
  if (!userEmail) throw new Error('No se encontró email de usuario');
  return { ...userData, usuario: userEmail };
};

// API helpers
const makeAuthenticatedRequest = async (url, options = {}) => {
  const userData = await loadData('userData');
  if (!userData?.usuario) throw new Error('No hay sesión válida');
  return fetch(url, { ...options, headers: { 'X-User-Email': userData.usuario, 'Content-Type': 'application/json', ...(options.headers || {}) } });
};

const apiHealth = async () => {
  try { return (await fetch(`${API_BASE}/api/health`)).ok; } catch { return false; }
};

const safeJson = async resp => {
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
};

// Mapeo de usuario compacto
const mapUser = x => {
  if (!x || typeof x !== 'object') return null;
  const row = x.data ?? x;
  return {
    id: Number(row.id || 0), usuario: norm(row.usuario), rol: normalizeRole(row.rolNombre || row.rol || 'operador'),
    activo: Boolean(row.estado ?? row.activo ?? true), facultadCod: norm(row.facultadCod),
    facultadNombre: norm(row.facultadNombre), carreraCod: norm(row.carreraCod), carreraNombre: norm(row.carreraNombre)
  };
};

// API catálogos compactos
const loadAvailableRoles = async () => {
  try {
    const response = await makeAuthenticatedRequest(`${API_BASE}/api/roles`);
    if (!response.ok) throw new Error('Error cargando roles');
    const roles = await response.json();
    return Array.isArray(roles) ? roles : [];
  } catch {
    return [{ id: 1, nombre: 'admin' }, { id: 2, nombre: 'decano' }, { id: 3, nombre: 'coordinador' }, { id: 4, nombre: 'operador' }];
  }
};

const loadAvailableFaculties = async () => {
  try {
    const response = await makeAuthenticatedRequest(`${API_BASE}/api/facultades`);
    return response.ok ? await response.json() : [];
  } catch { return []; }
};

const loadAvailableCareers = async facultadCod => {
  if (!facultadCod) return [];
  try {
    const response = await makeAuthenticatedRequest(`${API_BASE}/api/carreras/${facultadCod}`);
    return response.ok ? await response.json() : [];
  } catch { return []; }
};

// Populate selects compactos
const populateRoleSelect = async () => {
  if (!rolSelect) return;
  try {
    const roles = await loadAvailableRoles();
    rolSelect.innerHTML = roles.map(r => `<option value="${r.nombre.toLowerCase()}" ${r.nombre.toLowerCase() === 'operador' ? 'selected' : ''}>${r.nombre.charAt(0).toUpperCase() + r.nombre.slice(1).toLowerCase()}</option>`).join('');
  } catch {
    rolSelect.innerHTML = '<option value="admin">Administrador</option><option value="decano">Decano</option><option value="coordinador">Coordinador</option><option value="operador" selected>Operador</option>';
  }
};

const populateFacultySelect = async () => {
  if (!facultadSelect) return;
  try {
    const facultades = await loadAvailableFaculties();
    facultadSelect.innerHTML = '<option value="">Seleccione una facultad</option>' + facultades.map(f => `<option value="${f.codigo}">${f.codigo} - ${f.nombre}</option>`).join('');
  } catch { await modalError('Error cargando facultades'); }
};

const populateCareerSelect = async (facultadCod = '') => {
  if (!carreraSelect) return;
  carreraSelect.innerHTML = '<option value="">Todas las carreras</option>';
  if (!facultadCod) return carreraSelect.disabled = true;
  try {
    const carreras = await loadAvailableCareers(facultadCod);
    carreraSelect.disabled = false;
    carreraSelect.innerHTML += carreras.map(c => `<option value="${c.codigo}">${c.codigo} - ${c.nombre}</option>`).join('');
  } catch { carreraSelect.disabled = true; }
};

// Render compacto
const badgeRol = rol => {
  const isAdmin = rol === 'admin', cls = isAdmin ? 'badge admin' : 'badge user', icon = isAdmin ? 'fa-shield-halved' : 'fa-user';
  return `<span class="${cls}"><i class="fa-solid ${icon}"></i> ${rol}</span>`;
};
const statusDot = on => `<span class="status-dot ${on ? 'on' : 'off'}" title="${on ? 'Activo' : 'Inactivo'}"></span>`;
const rowTemplate = u => `<tr data-id="${u.id}"><td>${u.id}</td><td>${u.usuario}</td><td>${badgeRol(u.rol)}</td><td>${statusDot(u.activo)}</td><td>${u.facultadCod || 'N/A'}</td><td>${u.carreraCod || 'N/A'}</td><td class="row-actions"><button class="file-action-btn" data-action="pick" title="Seleccionar"><i class="fa-solid fa-hand-pointer"></i> Seleccionar</button><button class="file-action-btn" data-action="toggle" title="Activar/Desactivar"><i class="fa-solid fa-toggle-on"></i> Activar/Desactivar</button></td></tr>`;
const renderTable = (list, { append = false } = {}) => {
  if (!usersTbody) return;
  const html = list.map(rowTemplate).join('');
  append ? usersTbody.insertAdjacentHTML('beforeend', html) : (usersTbody.innerHTML = html);
  selectedId = null;
  updateUserBtn.disabled = true;
};

// API usuarios compacto
const apiListUsers = async ({ q = '', rol = '', page = 0, limit = PAGE_SIZE } = {}) => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (rol) params.set('rolId', rol);
  params.set('page', String(page));
  params.set('limit', String(limit));

  const resp = await makeAuthenticatedRequest(`${API_BASE}/usuarios?${params}`);
  const body = await safeJson(resp);
  if (!resp.ok) throw new Error(body?.error || `Error ${resp.status}: ${body?.message || 'Error desconocido'}`);

  let rows = [], total = 0;
  if (Array.isArray(body)) [rows, total] = [body, body.length];
  else if (body.data?.length) [rows, total] = [body.data, body.total || body.data.length];
  else if (body.rows?.length) [rows, total] = [body.rows, body.total || body.rows.length];

  return { rows: rows.map(mapUser).filter(Boolean), total };
};

const apiCreateUser = async ({ usuario, rol = 'operador', activo = true, facultadCod, carreraCod }) => {
  const rolesResponse = await makeAuthenticatedRequest(`${API_BASE}/api/roles`);
  if (!rolesResponse.ok) throw new Error('Error obteniendo lista de roles');
  const roles = await rolesResponse.json(), roleObj = roles.find(r => normalizeRole(r.nombre) === normalizeRole(rol));
  if (!roleObj) throw new Error(`Rol "${rol}" no encontrado`);

  const payload = { usuario, rolId: roleObj.id, facultadCod, carreraCod: carreraCod || null, activo: !!activo };
  const resp = await makeAuthenticatedRequest(`${API_BASE}/usuarios`, { method: 'POST', body: JSON.stringify(payload) });
  const out = await safeJson(resp);
  if (!resp.ok) throw new Error(out?.error || 'No se pudo crear usuario');
  return mapUser(out?.data);
};

const apiUpdateUser = async (id, { usuario, rol, activo, facultadCod, carreraCod }) => {
  let rolId;
  if (rol !== undefined) {
    try {
      const rolesResponse = await makeAuthenticatedRequest(`${API_BASE}/api/roles`);
      if (rolesResponse.ok) {
        const roles = await rolesResponse.json(), roleObj = roles.find(r => normalizeRole(r.nombre) === normalizeRole(rol));
        if (roleObj) rolId = roleObj.id;
      }
    } catch (error) { console.warn('Error obteniendo roles para actualización:', error); }
  }

  const body = {};
  if (usuario !== undefined) body.usuario = usuario;
  if (rolId !== undefined) body.rolId = rolId;
  if (activo !== undefined) body.activo = !!activo;
  if (facultadCod !== undefined) body.facultadCod = facultadCod;
  if (carreraCod !== undefined) body.carreraCod = carreraCod || null;

  const resp = await makeAuthenticatedRequest(`${API_BASE}/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  const out = await safeJson(resp);
  if (!resp.ok) throw new Error(out?.error || 'No se pudo actualizar usuario');
  return mapUser(out?.data);
};

// Stats compacto
const refreshStatsFromServer = async () => {
  try {
    const { rows: users } = await apiListUsers({ limit: 1000, page: 0 });
    if (statTotal) statTotal.textContent = users.length;
    if (statAdmins) statAdmins.textContent = users.filter(u => u.rol === 'admin').length;
    if (statActivos) statActivos.textContent = users.filter(u => u.activo).length;
  } catch (e) {
    console.warn('Error getting stats from server, using cache:', e);
    const list = USERS_CACHE;
    if (statTotal) statTotal.textContent = list.length;
    if (statAdmins) statAdmins.textContent = list.filter(u => u.rol === 'admin').length;
    if (statActivos) statActivos.textContent = list.filter(u => u.activo).length;
  }
};

const currentFilters = () => ({ q: norm(searchText?.value ?? ''), rol: norm(filterRol?.value ?? '').toLowerCase(), activo: norm(filterActivo?.value ?? '') });

const refreshUsers = async ({ reset = true } = {}) => {
  hideErrorBanner();
  const { q, rol, activo } = currentFilters();
  if (reset) page = 0;
  showOverlay('Cargando usuarios...');
  
  try {
    await verificarSesion();
    let { rows, total } = await apiListUsers({ q, rol: rol || '', page, limit: PAGE_SIZE });
    if (activo !== '') rows = rows.filter(user => user.activo === (activo === '1')), total = rows.length;

    if (rows.length === 0 && page === 0) {
      try {
        const retry = await apiListUsers({ page: 0, limit: 1000 });
        if (retry.rows.length > 0) {
          [rows, total] = [retry.rows, retry.total];
          [searchText, filterRol, filterActivo].forEach(el => el && (el.value = ''));
        }
      } catch (retryError) { console.warn('Error en reintento sin filtros:', retryError); }
    }

    if (reset) USERS_CACHE = rows, renderTable(USERS_CACHE, { append: false }), await saveData(CACHE_KEY, USERS_CACHE);
    else USERS_CACHE = [...USERS_CACHE, ...rows], renderTable(rows, { append: true }), await saveData(CACHE_KEY, USERS_CACHE);

    await refreshStatsFromServer();

    if (total === 0 && reset) {
      const crearAdmin = await modalConfirm('No hay usuarios en la base de datos.\n¿Deseas crear un usuario administrador de prueba (admin@local)?', 'Crear administrador de prueba', 'Crear', 'Cancelar');
      if (crearAdmin) {
        try { await apiCreateUser({ usuario: 'admin@local', rol: 'admin', activo: true, facultadCod: 'ADM' }); await refreshUsers({ reset: true }); }
        catch (createError) { await modalError(`Error creando administrador de prueba: ${createError.message}`); }
      }
    }
  } catch (error) {
    showErrorBanner(`Error cargando usuarios: ${error.message}`);
    const cached = await loadData(CACHE_KEY);
    if (Array.isArray(cached)) {
      USERS_CACHE = cached.map(mapUser).filter(Boolean);
      renderTable(USERS_CACHE, { append: false });
      const list = USERS_CACHE;
      if (statTotal) statTotal.textContent = list.length;
      if (statAdmins) statAdmins.textContent = list.filter(u => u.rol === 'admin').length;
      if (statActivos) statActivos.textContent = list.filter(u => u.activo).length;
    } else {
      if (usersTbody) usersTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px;"><div style="color: #666;"><i class="fa-solid fa-wifi" style="font-size: 48px; margin-bottom: 10px; opacity: 0.5;"></i><br>No se pudo conectar al servidor<br><small>${error.message}</small><br><button onclick="refreshUsers({ reset: true })" class="action-button" style="margin-top: 10px;"><i class="fa-solid fa-refresh"></i> Reintentar</button></div></td></tr>`;
    }
  } finally { hideOverlay(); }
};

// Inicialización compacta
const inicializarPanel = async () => {
  try {
    if (!verificarElementosDOM()) throw new Error('Elementos DOM faltantes');
    await verificarSesion();
    if (!(await apiHealth())) throw new Error('API no disponible');
    await Promise.all([populateRoleSelect(), populateFacultySelect()]);
    if (facultadSelect && carreraSelect) facultadSelect.addEventListener('change', () => populateCareerSelect(facultadSelect.value));
    await refreshUsers({ reset: true });
  } catch (error) {
    showErrorBanner(`Error al inicializar: ${error.message}`);
    const cached = await loadData(CACHE_KEY);
    if (Array.isArray(cached) && cached.length > 0) {
      USERS_CACHE = cached.map(mapUser).filter(Boolean);
      renderTable(USERS_CACHE, { append: false });
      showErrorBanner('Mostrando datos guardados localmente. La conexión al servidor falló.');
    }
  }
};

// Event listeners compactos
usersTable?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button.file-action-btn'), tr = ev.target.closest('tr[data-id]');
  if (!btn || !tr) return;
  const id = Number(tr.getAttribute('data-id')), user = USERS_CACHE.find(u => u.id === id);
  if (!user) return;
  const action = btn.getAttribute('data-action');

  if (action === 'pick') {
    selectedId = id;
    usuarioInput.value = user.usuario; rolSelect.value = user.rol; activoCheck.checked = !!user.activo;
    activoLabel.textContent = user.activo ? 'Sí' : 'No'; facultadSelect.value = user.facultadCod || '';
    await populateCareerSelect(user.facultadCod); carreraSelect.value = user.carreraCod || '';
    updateUserBtn.disabled = false; usuarioInput.focus();
  }

  if (action === 'toggle') {
    try {
      showOverlay('Actualizando estado...');
      const updated = await apiUpdateUser(user.id, { activo: !user.activo });
      const idx = USERS_CACHE.findIndex(u => u.id === user.id);
      if (idx >= 0) USERS_CACHE[idx] = updated;
      await saveData(CACHE_KEY, USERS_CACHE);
      tr.outerHTML = rowTemplate(updated);
      await refreshStatsFromServer();
    } catch (e) { await modalError(`No se pudo actualizar:\n${e.message}`); }
    finally { hideOverlay(); }
  }
});

const clearForm = () => {
  usuarioInput.value = ''; rolSelect.value = 'operador'; activoCheck.checked = true; activoLabel.textContent = 'Sí';
  facultadSelect.value = ''; carreraSelect.innerHTML = '<option value="">Todas las carreras</option>';
  carreraSelect.disabled = true; selectedId = null; updateUserBtn.disabled = true;
};

createUserBtn?.addEventListener('click', async () => {
  const usuario = norm(usuarioInput.value), rol = norm(rolSelect.value) || 'operador', activo = !!activoCheck.checked;
  const facultadCod = norm(facultadSelect.value), carreraCod = norm(carreraSelect.value) || null;
  if (!usuario || !facultadCod) return await modalInfo(!usuario ? 'Ingresa el usuario.' : 'Selecciona una facultad.');
  try {
    showOverlay('Creando usuario...');
    await apiCreateUser({ usuario, rol, activo, facultadCod, carreraCod });
    await refreshUsers({ reset: true }); await modalInfo('Usuario creado.', 'Éxito'); clearForm();
  } catch (e) { await modalError(`No se pudo crear:\n${e.message}`); }
  finally { hideOverlay(); }
});

updateUserBtn?.addEventListener('click', async () => {
  if (!selectedId) return await modalInfo('Selecciona una fila primero.');
  const usuario = norm(usuarioInput.value), rol = norm(rolSelect.value) || 'operador', activo = !!activoCheck.checked;
  const facultadCod = norm(facultadSelect.value), carreraCod = norm(carreraSelect.value) || null;
  if (!facultadCod) return await modalInfo('Selecciona una facultad.');
  try {
    showOverlay('Actualizando usuario...');
    await apiUpdateUser(selectedId, { usuario, rol, activo, facultadCod, carreraCod });
    await refreshUsers({ reset: true }); await modalInfo('Usuario actualizado.', 'Éxito'); clearForm();
  } catch (e) { await modalError(`No se pudo actualizar:\n${e.message}`); }
  finally { hideOverlay(); }
});

clearFormBtn?.addEventListener('click', clearForm);
refreshBtn?.addEventListener('click', () => refreshUsers({ reset: true }));
applyFiltersBtn?.addEventListener('click', () => refreshUsers({ reset: true }));
resetFiltersBtn?.addEventListener('click', () => {
  searchText.value = ''; filterRol.value = ''; filterActivo.value = ''; refreshUsers({ reset: true });
});
loadMoreBtn?.addEventListener('click', () => { page += 1; refreshUsers({ reset: false }); });

// Gestión catálogos ultra compacta
manageFacultiesBtn?.addEventListener('click', () => showCatalogManager('facultades'));
manageCareersBtn?.addEventListener('click', () => showCatalogManager('carreras'));

const showCatalogManager = async type => {
  window.catalogEditingId = null;
  const modalHtml = `<div id="catalog-modal" class="deny-backdrop" style="display: flex; z-index: 50000;"><div class="deny-card" style="max-width: 1000px; width: 90%;"><div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;"><h3>Gestión de ${type === 'facultades' ? 'Facultades' : 'Carreras'}</h3><button id="catalog-modal-close" class="secondary-button" style="padding: 5px 10px;"><i class="fa-solid fa-times"></i></button></div><div id="catalog-form-section" style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px;"><h4 id="catalog-form-title">Agregar ${type === 'facultades' ? 'Facultad' : 'Carrera'}</h4><div class="form-grid" style="gap: 15px;">${type === 'facultades' ? '<div class="form-field"><label for="catalog-codigo">Código (hasta 4 caracteres)</label><input id="catalog-codigo" type="text" maxlength="4" placeholder="Ej: ADM" style="text-transform: uppercase;"></div><div class="form-field"><label for="catalog-nombre">Nombre</label><input id="catalog-nombre" type="text" placeholder="Nombre de la facultad"></div>' : '<div class="form-field"><label for="catalog-facultad">Facultad</label><select id="catalog-facultad"><option value="">Seleccione una facultad</option></select></div><div class="form-field"><label for="catalog-codigo">Código (4 caracteres)</label><input id="catalog-codigo" type="text" maxlength="4" placeholder="Ej: ADM" style="text-transform: uppercase;"></div><div class="form-field"><label for="catalog-nombre">Nombre</label><input id="catalog-nombre" type="text" placeholder="Nombre de la carrera"></div>'}</div><div style="margin-top: 15px; display: flex; gap: 10px;"><button id="catalog-save-btn" class="action-button"><i class="fa-solid fa-save"></i> Guardar</button><button id="catalog-cancel-btn" class="secondary-button action-button"><i class="fa-solid fa-times"></i> Cancelar</button></div></div><div id="catalog-list-section"><h4>Lista de ${type === 'facultades' ? 'Facultades' : 'Carreras'}</h4><div style="max-height: 400px; overflow-y: auto;"><table class="admin-table" id="catalog-table"><thead><tr><th>Código</th><th>Nombre</th>${type === 'carreras' ? '<th>Facultad</th>' : ''}<th>Acciones</th></tr></thead><tbody id="catalog-tbody"></tbody></table></div></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  const modal = $('catalog-modal'), closeBtn = $('catalog-modal-close'), saveBtn = $('catalog-save-btn'), cancelBtn = $('catalog-cancel-btn'), codigoInput = $('catalog-codigo');
  if (codigoInput) codigoInput.addEventListener('input', e => e.target.value = e.target.value.toUpperCase());
  
  const closeCatalogModal = () => (modal.remove(), window.catalogEditingId = null);
  const clearCatalogForm = () => {
    $('catalog-codigo').value = ''; $('catalog-nombre').value = '';
    if (type === 'carreras') $('catalog-facultad').value = '';
    window.catalogEditingId = null;
    $('catalog-form-title').textContent = `Agregar ${type === 'facultades' ? 'Facultad' : 'Carrera'}`;
    $('catalog-save-btn').innerHTML = '<i class="fa-solid fa-save"></i> Guardar';
  };
  
  const saveCatalogItem = async () => {
    try {
      const codigo = $('catalog-codigo').value.trim().toUpperCase(), nombre = $('catalog-nombre').value.trim();
      const facultadCod = type === 'carreras' ? $('catalog-facultad').value : null;
      if (!codigo || !nombre || (type === 'carreras' && !facultadCod)) return await modalInfo('Por favor completa todos los campos obligatorios');
      
      const isEditing = !!window.catalogEditingId;
      showOverlay(`${isEditing ? 'Actualizando' : 'Creando'} ${type === 'facultades' ? 'facultad' : 'carrera'}...`);
      
      const endpoint = type === 'facultades' ? '/api/facultades' : '/api/carreras';
      const method = isEditing ? 'PUT' : 'POST';
      const url = isEditing ? `${API_BASE}${endpoint}/${window.catalogEditingId}` : `${API_BASE}${endpoint}`;
      const payload = { codigo, nombre, ...(type === 'carreras' && { facultadCod }) };
      
      const response = await makeAuthenticatedRequest(url, { method, body: JSON.stringify(payload) });
      const responseData = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseData?.error || `Error ${response.status}`);
      
      hideOverlay();
      const notification = document.createElement('div');
      notification.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #4CAF50; color: white; padding: 15px 20px; border-radius: 8px; font-weight: 600; z-index: 60000; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
      notification.innerHTML = `<i class="fa-solid fa-check-circle" style="margin-right: 8px;"></i>${type === 'facultades' ? 'Facultad' : 'Carrera'} ${isEditing ? 'actualizada' : 'creada'} correctamente`;
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 3000);
      
      await loadCatalogData(type); clearCatalogForm();
      if (type === 'facultades') await populateFacultySelect();
    } catch (error) { await modalError(`Error al ${window.catalogEditingId ? 'actualizar' : 'crear'}: ${error.message}`); }
    finally { hideOverlay(); }
  };
  
  closeBtn.addEventListener('click', closeCatalogModal);
  cancelBtn.addEventListener('click', clearCatalogForm);
  saveBtn.addEventListener('click', saveCatalogItem);
  modal.addEventListener('click', e => e.target === modal && closeCatalogModal());
  
  const handleEscape = e => { if (e.key === 'Escape') closeCatalogModal(), document.removeEventListener('keydown', handleEscape); };
  document.addEventListener('keydown', handleEscape);
  
  await loadCatalogData(type);
  if (type === 'carreras') {
    const facultadSelect = $('catalog-facultad');
    if (facultadSelect) {
      try {
        const facultades = await loadAvailableFaculties();
        facultadSelect.innerHTML = '<option value="">Seleccione una facultad</option>' + facultades.map(f => `<option value="${f.codigo}">${f.codigo} - ${f.nombre}</option>`).join('');
      } catch (error) { console.error('Error cargando facultades para carreras:', error); }
    }
  }
};

const loadCatalogData = async type => {
  const tbody = $('catalog-tbody');
  if (!tbody) return;
  try {
    showOverlay(`Cargando ${type}...`);
    let data = [];
    if (type === 'facultades') data = await loadAvailableFaculties();
    else {
      const facultades = await loadAvailableFaculties();
      for (const facultad of facultades) {
        try {
          const carreras = await loadAvailableCareers(facultad.codigo);
          carreras.forEach(carrera => data.push({ ...carrera, facultadCod: facultad.codigo, facultadNombre: facultad.nombre }));
        } catch (error) { console.warn(`Error cargando carreras para facultad ${facultad.codigo}:`, error); }
      }
    }
    tbody.innerHTML = data.map(item => `<tr><td>${item.codigo}</td><td>${item.nombre}</td>${type === 'carreras' ? `<td>${item.facultadNombre || item.facultadCod}</td>` : ''}<td><button class="file-action-btn" onclick="editCatalogItem('${type}', '${item.codigo}', '${item.nombre.replace(/'/g, "\\'")}', '${item.facultadCod || ''}')"><i class="fa-solid fa-edit"></i> Editar</button><button class="file-action-btn" onclick="deleteCatalogItem('${type}', '${item.codigo}', '${item.nombre.replace(/'/g, "\\'")}')' style="background: #dc3545;"><i class="fa-solid fa-trash"></i> Eliminar</button></td></tr>`).join('');
  } catch (error) { await modalError(`Error cargando ${type}: ${error.message}`); }
  finally { hideOverlay(); }
};

window.editCatalogItem = (type, codigo, nombre, facultadCod = '') => {
  const [codigoInput, nombreInput, facultadSelect, formTitle, saveBtn] = ['catalog-codigo', 'catalog-nombre', 'catalog-facultad', 'catalog-form-title', 'catalog-save-btn'].map($);
  if (!codigoInput || !nombreInput || !formTitle || !saveBtn) return;
  codigoInput.value = codigo; nombreInput.value = nombre;
  if (type === 'carreras' && facultadCod && facultadSelect) facultadSelect.value = facultadCod;
  formTitle.textContent = `Editar ${type === 'facultades' ? 'Facultad' : 'Carrera'}`;
  saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Actualizar';
  window.catalogEditingId = codigo;
};

window.deleteCatalogItem = async (type, codigo, nombre) => {
  const confirmed = await modalConfirm(`¿Estás seguro de que deseas eliminar ${type === 'facultades' ? 'la facultad' : 'la carrera'} "${nombre}"?\n\nEsta acción no se puede deshacer.`, 'Confirmar eliminación', 'Sí, eliminar', 'Cancelar');
  if (!confirmed) return;
  try {
    showOverlay(`Eliminando ${type === 'facultades' ? 'facultad' : 'carrera'}...`);
    const endpoint = type === 'facultades' ? '/api/facultades' : '/api/carreras';
    const response = await makeAuthenticatedRequest(`${API_BASE}${endpoint}/${codigo}`, { method: 'DELETE' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Error ${response.status}`);
    }
    await modalInfo(`${type === 'facultades' ? 'Facultad' : 'Carrera'} eliminada correctamente`);
    await loadCatalogData(type);
    if (type === 'facultades') await populateFacultySelect(), await populateCareerSelect('');
  } catch (error) { await modalError(`Error al eliminar: ${error.message}`); }
  finally { hideOverlay(); }
};

document.addEventListener('DOMContentLoaded', inicializarPanel);
if (document.readyState !== 'loading') setTimeout(inicializarPanel, 100);