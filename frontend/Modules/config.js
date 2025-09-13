// config.js - Versión completamente basada en API
import { saveData, loadData } from '../indexeddb-storage.js';

const API_BASE = 'http://26.127.175.34:5000';

const ROLES_PERMITIDOS = [
  'admin',
  'rector'
];

// ======================= UTILIDADES =======================
const norm = (v) => (v ?? '').toString().trim();
const normalizeFileName = (fileName) => fileName.replace(/\W+/g, "_");

// ======================= AUTENTICACIÓN BASADA EN API =======================
async function getStoredUserEmail() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("FACAF-DB", 1);

    request.onsuccess = function (event) {
      const db = event.target.result;
      const transaction = db.transaction("data", "readonly");
      const store = transaction.objectStore("data");

      // Buscar específicamente la clave "userData"
      const query = store.get("userData");

      query.onsuccess = function () {
        const result = query.result;
        if (result && result.usuario) {
          resolve(result.usuario);
        } else {
          resolve(null);
        }
      };

      query.onerror = function () {
        reject(query.error);
      };
    };

    request.onerror = function () {
      reject(request.error);
    };
  });
}

async function getAuthHeaders() {
  const userEmail = await getStoredUserEmail();
  if (!userEmail) {
    throw new Error('No hay email de usuario almacenado');
  }
  return {
    'Content-Type': 'application/json',
    'X-User-Email': userEmail
  };
}

async function getCurrentUserFromAPI() {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/user/profile`, { headers });
    
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    
    const userData = await response.json();
    console.log('Usuario obtenido de la API:', userData);
    return userData;
  } catch (error) {
    console.error('Error obteniendo usuario desde API:', error);
    throw error;
  }
}

async function getUserPermissionsFromAPI() {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/user/permissions`, { headers });
    
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    
    const permissions = await response.json();
    console.log('Permisos obtenidos de la API:', permissions);
    return permissions;
  } catch (error) {
    console.error('Error obteniendo permisos desde API:', error);
    throw error;
  }
}

// ======================= VALIDACIÓN DE ACCESO BASADA EN API =======================
async function validateAccess() {
  try {
    console.log('Validando acceso con API...');
    // 1. Verificar que tenemos email de usuario
    const userEmail = await getStoredUserEmail();
    if (!userEmail) {
      console.log('No hay email de usuario almacenado');
      redirectToLogin();
      return false;
    }

    // 2. Obtener datos del usuario desde la API
    const userData = await getCurrentUserFromAPI();
    if (!userData || !userData.usuario) {
      console.log('No se pudieron obtener datos del usuario desde la API');
      redirectToLogin();
      return false;
    }

    // 3. Verificar permisos desde la API
    const permissions = await getUserPermissionsFromAPI();
    if (!permissions.permissions) {
      console.log('No se pudieron obtener permisos del usuario');
      redirectToLogin();
      return false;
    }

    // 4. Verificar acceso por permisos específicos O por rol permitido
    const hasEditPermissions = permissions.permissions.can_edit_templates || 
                              permissions.permissions.can_upload;
    
    const hasAllowedRole = ROLES_PERMITIDOS.includes(permissions.role || '') ||
                          ROLES_PERMITIDOS.includes(userData.rol || '');
    
    const canAccess = hasEditPermissions || hasAllowedRole;
    
    if (!canAccess) {
      console.log('Usuario sin permisos suficientes.');
      console.log('Rol en permissions:', permissions.role);
      console.log('Rol en userData:', userData.rol);
      console.log('Permisos:', permissions.permissions);
      console.log('Roles permitidos:', ROLES_PERMITIDOS);
      redirectToLogin();
      return false;
    }

    // 5. Actualizar datos locales para compatibilidad (solo estructura mínima)
    const minimalUserData = {
      usuario: userData.usuario,
      rol: userData.rol,
      facultadCod: userData.facultadCod,
      carreraCod: userData.carreraCod
    };
    localStorage.setItem('userData', JSON.stringify(minimalUserData));

    console.log('✅ Acceso validado correctamente:', userData.usuario, 'con rol:', userData.rol);
    return true;

  } catch (error) {
    console.error('Error en validación de acceso:', error);
    redirectToLogin();
    return false;
  }
}

function redirectToLogin() {
  // Limpiar solo datos locales mínimos
  localStorage.removeItem('userData');
  // Redirección inmediata sin popups
  window.location.href = '../index.html';
}

// Función de compatibilidad (simplificada)
function getUserData() {
  try {
    const data = localStorage.getItem('userData');
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

// ======================= GESTIÓN DE ARCHIVOS =======================
async function fetchAndRenderProcessedFiles() {
  const processedFilesListDiv = document.getElementById('processed-files-list');
  if (!processedFilesListDiv) return;
  
  processedFilesListDiv.innerHTML = '';

  try {
    const headers = await getAuthHeaders(); // FIX: Usar getAuthHeaders()
    const response = await fetch(`${API_BASE}/files`, { headers });

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const files = data.archivos || [];

    if (files.length > 0) {
      const title = document.createElement('h3');
      title.textContent = 'Archivos Procesados:';
      processedFilesListDiv.appendChild(title);

      files.forEach(file => {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'processed-file';
        fileDiv.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 8px 12px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          margin-bottom: 8px;
        `;

        fileDiv.innerHTML = `
          <div>
            <span class="file-name" title="${file.nombre}">${file.nombre}</span>
            <small style="display: block; color: #666; margin-top: 2px;">
              ${file.facultad || 'Sin facultad'} - ${file.fecha || 'Sin fecha'}
            </small>
          </div>
          <div class="file-actions">
            <button class="file-action-btn" title="Ver columnas" onclick="viewFileDetails('${file.nombre}')">
              <i class="fas fa-eye"></i>
            </button>
            <button class="file-action-btn" title="Eliminar" onclick="removeFile(this, '${file.nombre}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        `;
        processedFilesListDiv.appendChild(fileDiv);
      });
    } else {
      processedFilesListDiv.innerHTML = `
        <div style="text-align: center; color: #666; padding: 20px;">
          <i class="fas fa-folder-open" style="font-size: 2em; margin-bottom: 10px; display: block;"></i>
          No hay archivos para su facultad
        </div>
      `;
    }
  } catch (error) {
    console.error('Error obteniendo archivos:', error);
    
    if (error.message.includes('401') || error.message.includes('403')) {
      redirectToLogin();
      return;
    }
    
    processedFilesListDiv.innerHTML = `
      <div style="text-align: center; color: #d33; padding: 20px;">
        <i class="fas fa-exclamation-triangle" style="font-size: 2em; margin-bottom: 10px; display: block;"></i>
        Error cargando archivos: ${error.message}
      </div>
    `;
  }
}

window.viewFileDetails = async function (fileName) {
  try {
    const key = `academicTrackingData_${normalizeFileName(fileName)}`;
    const data = await loadData(key);

    if (data && Array.isArray(data) && data.length) {
      const recordCount = data.length;
      const firstRecord = data[0] || {};
      const columns = Object.keys(firstRecord);
      const columnList = columns.map(col => `<li>${col}</li>`).join('');

      await Swal.fire({
        title: `<i class="fas fa-file-excel"></i> ${fileName}`,
        html: `
          <p><strong>Registros:</strong> ${recordCount}</p>
          <p><strong>Estado:</strong> Procesado correctamente</p>
          <hr>
          <p><strong>Columnas:</strong></p>
          <ul style="text-align: left; max-height: 220px; overflow-y: auto; margin:0;">
            ${columnList}
          </ul>
        `,
        icon: 'info',
        confirmButtonText: 'Cerrar',
        width: '600px'
      });
    } else {
      await Swal.fire({
        icon: 'warning',
        title: 'Sin datos',
        text: `El archivo "${fileName}" no contiene registros procesados.`,
      });
    }
  } catch (error) {
    console.error('Error obteniendo detalles:', error);
    await Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'No se pudo obtener la información del archivo.',
    });
  }
};

window.removeFile = async function (btn, filename) {
  if (!filename || !confirm(`¿Deseas eliminar el archivo "${filename}"?`)) return;

  try {
    const headers = await getAuthHeaders(); // FIX: Usar getAuthHeaders()
    const url = `${API_BASE}/delete/by-name/${encodeURIComponent(filename)}`;
    
    const response = await fetch(url, {
      method: "DELETE",
      headers
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `Error ${response.status}`);
    }

    btn.closest('.processed-file')?.remove();

    await Swal.fire({
      icon: 'success',
      title: 'Archivo eliminado',
      text: `El archivo "${filename}" ha sido eliminado correctamente.`,
      timer: 3000
    });

    await fetchAndRenderProcessedFiles();

  } catch (err) {
    console.error("Error eliminando archivo:", err);
    
    if (err.message.includes('401') || err.message.includes('403')) {
      redirectToLogin();
      return;
    }
    
    await Swal.fire({
      icon: 'error',
      title: 'Error al eliminar',
      text: err.message || 'No se pudo eliminar el archivo.',
    });
  }
};

// ======================= SUBIDA DE ARCHIVOS =======================
async function processExcelFile() {
  const fileInput = document.getElementById('excel-file-input');
  const files = fileInput?.files;
  const uploadStatus = document.getElementById('upload-status');
  const loadingOverlay = document.getElementById('loading-overlay');

  // Si no hay archivos, solo actualizar vista
  if (!files || files.length === 0) {
    await updatePeriodViewFromLocal();
    return;
  }

  try {
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    
    const userEmail = await getStoredUserEmail();
    if (!userEmail) {
      throw new Error('No hay sesión activa');
    }

    // Obtener facultad del usuario desde API
    const userData = await getCurrentUserFromAPI();
    if (!userData.facultadCod && userData.rol !== 'admin') {
      throw new Error('Usuario sin facultad asignada');
    }

    for (let i = 0; i < files.length; i++) {
      console.log(`Subiendo archivo ${files[i].name}`);

      const formData = new FormData();
      formData.append("file", files[i]);
      if (userData.facultadCod) {
        formData.append("facultadCod", userData.facultadCod);
      }

      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: { 'X-User-Email': userEmail },
        body: formData
      });

      if (!response.ok) {
        const errorResult = await response.json().catch(() => ({}));
        throw new Error(errorResult.error || `Error ${response.status}`);
      }

      if (uploadStatus) {
        uploadStatus.textContent = 'Archivo subido correctamente.';
        uploadStatus.style.color = 'green';
      }
    }

    await syncFilesFromBackendToIndexedDB();
    await fetchAndRenderProcessedFiles();
    
    if (loadingOverlay) loadingOverlay.style.display = 'none';

    await Swal.fire({
      icon: 'success',
      title: 'Archivos procesados correctamente',
      text: 'Los archivos Excel se han subido y sincronizado.',
    });

    // Limpiar input
    if (fileInput) {
      fileInput.value = '';
      const selectedFilesText = document.getElementById('selected-files-text');
      if (selectedFilesText) selectedFilesText.textContent = 'Ningún archivo seleccionado';
    }

  } catch (error) {
    console.error('Error al procesar archivos:', error);
    if (loadingOverlay) loadingOverlay.style.display = 'none';

    if (error.message.includes('401') || error.message.includes('403') || error.message.includes('No hay sesión activa')) {
      redirectToLogin();
      return;
    }

    await Swal.fire({
      icon: 'error',
      title: 'Error',
      text: error.message || 'Error al procesar los archivos.',
    });
  }

  setTimeout(() => {
    if (uploadStatus) uploadStatus.textContent = '';
  }, 6000);
}

// ======================= SINCRONIZACIÓN =======================
async function syncFilesFromBackendToIndexedDB() {
  const periodSelect = document.getElementById("period-select");
  const selectedPeriod = periodSelect?.value || localStorage.getItem('selectedPeriod') || '';

  try {
    const headers = await getAuthHeaders(); // FIX: Usar getAuthHeaders()
    const res = await fetch(`${API_BASE}/files`, { headers });
    
    if (!res.ok) {
      throw new Error(`Error ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const files = data.archivos || [];

    for (let file of files) {
      const fileRes = await fetch(`${API_BASE}/download/${file.id}`, { headers });
      if (!fileRes.ok) {
        console.warn('No se pudo descargar:', file.nombre);
        continue;
      }
      
      const blob = await fileRes.blob();
      const arrayBuffer = await blob.arrayBuffer();

      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      const fileKey = normalizeFileName(file.nombre);

      // Manejar archivo TOTAL especial
      if (file.nombre.toUpperCase().includes("REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL")) {
        let targetPeriod = selectedPeriod;
        if (!targetPeriod) {
          const uniquePeriods = Array.from(new Set(jsonData.map(r => norm(r['PERIODO'])).filter(Boolean)));
          targetPeriod = pickMostRecentPeriod(uniquePeriods);
          if (targetPeriod) {
            localStorage.setItem('selectedPeriod', targetPeriod);
            if (periodSelect) periodSelect.value = targetPeriod;
          }
        }
        const filtered = jsonData.filter(row => norm(row['PERIODO']) === targetPeriod);
        await saveData("academicTrackingData_REPORTE_POR_SEMESTRE", filtered);
      }

      const key = `academicTrackingData_${fileKey}`;
      await saveData(key, jsonData);
    }

    await populatePeriodSelectFromLocal();
  } catch (error) {
    console.error('Error en sincronización:', error);
    throw error;
  }
}

function pickMostRecentPeriod(periods) {
  const parsePeriod = (p) => {
    const m = String(p).match(/(\d{4}).*?(\d{4}).*(CI{1,2})/i);
    if (!m) return { y1: -1, term: -1, raw: p };
    return { y1: Number(m[1]), term: m[3].toUpperCase() === 'CII' ? 2 : 1, raw: p };
  };
  
  return periods.sort((A, B) => {
    const a = parsePeriod(A), b = parsePeriod(B);
    if (a.y1 !== b.y1) return b.y1 - a.y1;
    if (a.term !== b.term) return b.term - a.term;
    return String(b.raw).localeCompare(String(a.raw));
  })[0] || '';
}

async function updatePeriodViewFromLocal() {
  const selectedPeriod = document.getElementById("period-select")?.value;
  if (!selectedPeriod) {
    await Swal.fire({
      icon: 'warning',
      title: 'Selecciona un período',
      text: 'Debes elegir un período para actualizar la vista.',
    });
    return;
  }

  const KEY_TOTAL = `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL.xlsx')}`;
  const KEY_PARCIAL = `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL.xlsx')}`;

  let base = await loadData(KEY_TOTAL);
  if (!Array.isArray(base) || !base.length) {
    base = await loadData(KEY_PARCIAL);
  }
  
  if (!Array.isArray(base) || !base.length) {
    await Swal.fire({
      icon: 'warning',
      title: 'Sin datos',
      text: 'No se encuentra información para filtrar por período.',
    });
    return;
  }

  const filtered = base.filter(r => norm(r['PERIODO']) === selectedPeriod);
  await saveData("academicTrackingData_REPORTE_POR_SEMESTRE", filtered);

  await Swal.fire({
    icon: 'success',
    title: 'Periodo actualizado',
    text: `La tabla se actualizó para el período: ${selectedPeriod}`,
  });
}

async function populatePeriodSelectFromLocal() {
  const select = document.getElementById('period-select');
  if (!select) return;

  const KEY_TOTAL = `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL.xlsx')}`;
  const KEY_PARCIAL = `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL.xlsx')}`;

  let data = await loadData(KEY_TOTAL);
  if (!Array.isArray(data) || !data.length) {
    data = await loadData(KEY_PARCIAL);
  }
  
  if (!Array.isArray(data) || !data.length) {
    console.warn('No hay datos para construir combo de períodos.');
    return;
  }

  const periodsSet = new Set(data.map(r => norm(r['PERIODO'])).filter(Boolean));
  const periods = Array.from(periodsSet).sort((A, B) => {
    const a = pickMostRecentPeriod([A]);
    const b = pickMostRecentPeriod([B]);
    return String(b).localeCompare(String(a));
  });

  const saved = localStorage.getItem('selectedPeriod');
  const selected = (saved && periods.includes(saved)) ? saved : periods[0];

  select.innerHTML = periods.map(p => `<option value="${p}">${p}</option>`).join('');
  if (selected) {
    select.value = selected;
    localStorage.setItem('selectedPeriod', selected);
  }
}

// ======================= GESTIÓN DE PLANTILLAS =======================
async function getSharedCorreoAutoridad() {
  try {
    const headers = await getAuthHeaders(); // FIX: Usar getAuthHeaders()
    const correoRes = await fetch(`${API_BASE}/correo-autoridad`, { headers });

    if (correoRes.ok) {
      const correoData = await correoRes.json();
      return correoData.correoAutoridad || 'alvaro.espinozabu@ug.edu.ec';
    }
  } catch (error) {
    console.warn('Error cargando correo desde API:', error);
  }
  
  return 'alvaro.espinozabu@ug.edu.ec';
}

async function loadTemplates() {
  const tipoSelect = document.getElementById('template-type-select');
  const currentType = tipoSelect?.value || 'seguimiento';
  
  console.log(`Cargando plantillas de tipo: ${currentType}`);
  
  try {
    // Cargar desde API
    const headers = await getAuthHeaders(); // FIX: Usar getAuthHeaders()
    const res = await fetch(`${API_BASE}/plantillas?tipo=${currentType}`, { headers });
    
    if (res.ok) {
      const data = await res.json();
      const templates = data.plantillas || {};
      
      document.getElementById('template-autoridad').value = templates.autoridad || '';
      document.getElementById('template-docente').value = templates.docente || '';
      document.getElementById('template-estudiante').value = templates.estudiante || '';
      
      console.log('Plantillas cargadas desde API');
    } else {
      console.warn('No se pudieron cargar plantillas desde API');
      // Limpiar campos si no se pueden cargar
      document.getElementById('template-autoridad').value = '';
      document.getElementById('template-docente').value = '';
      document.getElementById('template-estudiante').value = '';
    }
  } catch (error) {
    console.error('Error cargando plantillas desde API:', error);
    
    if (error.message.includes('401') || error.message.includes('403')) {
      redirectToLogin();
      return;
    }
    
    // Limpiar campos en caso de error
    document.getElementById('template-autoridad').value = '';
    document.getElementById('template-docente').value = '';
    document.getElementById('template-estudiante').value = '';
  }
  
  // Cargar correo
  const correoAutoridad = await getSharedCorreoAutoridad();
  document.getElementById('correo').value = correoAutoridad;
}

async function saveTemplates() {
  const tipoSelect = document.getElementById('template-type-select');
  const currentType = tipoSelect?.value || 'seguimiento';

  const templateAutoridad = document.getElementById('template-autoridad').value;
  const templateDocente = document.getElementById('template-docente').value;
  const templateEstudiante = document.getElementById('template-estudiante').value;
  const correoInput = document.getElementById('correo').value.trim();
  const correoAutoridad = correoInput || "alvaro.espinozabu@ug.edu.ec";

  try {
    const headers = await getAuthHeaders();

    // Enviar plantillas a API
    const apiTemplates = {
      autoridad: templateAutoridad,
      docente: templateDocente,
      estudiante: templateEstudiante,
      tipo: currentType
    };
    
    const templateResponse = await fetch(`${API_BASE}/plantillas`, {
      method: 'POST',
      headers,
      body: JSON.stringify(apiTemplates)
    });

    if (!templateResponse.ok) {
      throw new Error('Error guardando plantillas');
    }

    // Guardar correo en API
    const correoResponse = await fetch(`${API_BASE}/correo-autoridad`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ correoAutoridad })
    });

    if (!correoResponse.ok) {
      throw new Error('Error guardando correo');
    }

    await Swal.fire({
      icon: 'success',
      title: 'Plantillas guardadas',
      text: `Plantillas de tipo "${currentType}" guardadas correctamente.`,
    });

  } catch (error) {
    console.error('Error al guardar plantillas:', error);
    
    if (error.message.includes('401') || error.message.includes('403')) {
      redirectToLogin();
      return;
    }
    
    await Swal.fire({
      icon: 'error',
      title: 'Error al guardar',
      text: error.message || 'No se pudieron guardar las plantillas.',
    });
  }
}

// ======================= INICIALIZACIÓN =======================
document.addEventListener('DOMContentLoaded', async function () {
  console.log('Validando acceso...');
  
  // Validar acceso inmediatamente al cargar
  const hasAccess = await validateAccess();
  if (!hasAccess) {
    console.error('Acceso denegado - redirigiendo');
    // La función redirectToLogin ya maneja la redirección inmediata
    return;
  }
  
  console.log('Acceso validado - iniciando aplicación');

  // Event listeners
  document.getElementById('excel-file-input')?.addEventListener('change', function (event) {
    const selectedFilesText = document.getElementById('selected-files-text');
    const files = event.target.files;
    if (selectedFilesText) {
      if (files && files.length > 0) {
        const fileNames = Array.from(files).map(f => f.name).join(', ');
        selectedFilesText.textContent = 'Archivo(s) seleccionado(s): ' + fileNames;
      } else {
        selectedFilesText.textContent = 'Ningún archivo seleccionado';
      }
    }
  });

  document.getElementById('process-files-button')?.addEventListener('click', processExcelFile);
  document.getElementById('template-type-select')?.addEventListener('change', loadTemplates);
  document.getElementById('save-templates-button')?.addEventListener('click', saveTemplates);
  document.getElementById('period-select')?.addEventListener('change', async (e) => {
    localStorage.setItem('selectedPeriod', e.target.value);
    await updatePeriodViewFromLocal();
  });
  document.getElementById('goToMenuButton')?.addEventListener('click', () => {
    window.location.href = '../index.html';
  });

  // Carga inicial
  try {
    await loadTemplates();
    await fetchAndRenderProcessedFiles();
    await populatePeriodSelectFromLocal();
    console.log('Inicialización completada');
  } catch (error) {
    console.error('Error en carga inicial:', error);
    if (error.message.includes('401') || error.message.includes('403')) {
      redirectToLogin();
    }
  }
});