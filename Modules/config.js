import { saveData, loadData } from '../indexeddb-storage.js';

const API_BASE = 'http://26.127.175.34:5000';
const ROLES_PERMITIDOS = ['admin', 'rector'];
const norm = (v) => (v ?? '').toString().trim();
const normalizeFileName = (fileName) => fileName.replace(/\W+/g, "_");

async function getStoredUserEmail() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("FACAF-DB", 1);
    request.onsuccess = function (event) {
      const db = event.target.result;
      const transaction = db.transaction("data", "readonly");
      const store = transaction.objectStore("data");
      const query = store.get("userData");
      query.onsuccess = function () {
        const result = query.result;
        resolve(result && result.usuario ? result.usuario : null);
      };
      query.onerror = () => reject(query.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getAuthHeaders() {
  const userEmail = await getStoredUserEmail();
  if (!userEmail) throw new Error('No hay email de usuario almacenado');
  return { 
    'Content-Type': 'application/json', 
    'X-User-Email': userEmail 
  };
}

async function getCurrentUserFromAPI() {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/user/profile`, { headers });
    if (!response.ok) throw new Error(`Error ${response.status}: ${response.statusText}`);
    return await response.json();
  } catch (error) {
    throw error;
  }
}

async function getUserPermissionsFromAPI() {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/user/permissions`, { headers });
    if (!response.ok) throw new Error(`Error ${response.status}: ${response.statusText}`);
    return await response.json();
  } catch (error) {
    throw error;
  }
}

async function validateAccess() {
  try {
    const userEmail = await getStoredUserEmail();
    if (!userEmail) {
      redirectToLogin();
      return false;
    }

    const userData = await getCurrentUserFromAPI();
    if (!userData || !userData.usuario) {
      redirectToLogin();
      return false;
    }

    const permissions = await getUserPermissionsFromAPI();
    if (!permissions.permissions) {
      redirectToLogin();
      return false;
    }

    const hasEditPermissions = permissions.permissions.can_edit_templates || permissions.permissions.can_upload;
    const hasAllowedRole = ROLES_PERMITIDOS.includes(permissions.role || '') || ROLES_PERMITIDOS.includes(userData.rol || '');
    const canAccess = hasEditPermissions || hasAllowedRole;
    
    if (!canAccess) {
      redirectToLogin();
      return false;
    }

    const minimalUserData = { 
      usuario: userData.usuario, 
      rol: userData.rol, 
      facultadCod: userData.facultadCod, 
      carreraCod: userData.carreraCod 
    };
    localStorage.setItem('userData', JSON.stringify(minimalUserData));
    return true;
  } catch (error) {
    redirectToLogin();
    return false;
  }
}

function redirectToLogin() {
  localStorage.removeItem('userData');
  window.location.href = '../index.html';
}

function getUserData() {
  try {
    const data = localStorage.getItem('userData');
    return data ? JSON.parse(data) : null;
  } catch (error) {
    return null;
  }
}

function formatFecha(fecha) {
  if (!fecha) return 'Sin fecha';
  try {
    const date = new Date(fecha);
    if (isNaN(date.getTime())) return 'Sin fecha';
    return date.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    return 'Sin fecha';
  }
}

async function getUserDataFromIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("FACAF-DB", 1);
    request.onsuccess = function(event) {
      const db = event.target.result;
      const transaction = db.transaction("data", "readonly");
      const store = transaction.objectStore("data");
      const query = store.get("userData");
      query.onsuccess = function() {
        resolve(query.result || null);
      };
      query.onerror = () => reject(query.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getFacultadNombreFromUser() {
  try {
    const userData = await getUserDataFromIndexedDB();
    if (userData && userData.facultad) {
      return userData.facultad.trim();
    }
    return 'Sin facultad';
  } catch (error) {
    return 'Sin facultad';
  }
}

async function fetchAndRenderProcessedFiles() {
  const processedFilesListDiv = document.getElementById('processed-files-list');
  if (!processedFilesListDiv) return;
  processedFilesListDiv.innerHTML = '';

  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/files`, { headers });
    
    if (!response.ok) throw new Error(`Error ${response.status}: ${response.statusText}`);

    const data = await response.json();
    const files = data.archivos || [];

    if (files.length > 0) {
      const title = document.createElement('h3');
      title.textContent = 'Archivos Procesados:';
      processedFilesListDiv.appendChild(title);

      const facultadNombre = await getFacultadNombreFromUser();

      files.forEach(file => {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'processed-file';
        fileDiv.style.cssText = `display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 8px;`;
        
        const fechaInfo = formatFecha(file.fechaSubida || file.fecha_subida || file.fecha || file.FechaSubida || file.created_at);
        
        fileDiv.innerHTML = `
          <div>
            <span class="file-name" title="${file.nombre || file.NombreArchivo || 'Sin nombre'}">${file.nombre || file.NombreArchivo || 'Sin nombre'}</span>
            <small style="display: block; color: #666; margin-top: 2px; text-align: center;">${facultadNombre} - ${fechaInfo}</small>
          </div>
          <div class="file-actions">
            <button class="file-action-btn" title="Ver columnas" onclick="viewFileDetails('${file.nombre || file.NombreArchivo}')"><i class="fas fa-eye"></i></button>
            <button class="file-action-btn" title="Eliminar" onclick="removeFile(this, '${file.nombre || file.NombreArchivo}')"><i class="fas fa-trash"></i></button>
          </div>`;
        processedFilesListDiv.appendChild(fileDiv);
      });
    } else {
      processedFilesListDiv.innerHTML = `<div style="text-align: center; color: #666; padding: 20px;"><i class="fas fa-folder-open" style="font-size: 2em; margin-bottom: 10px; display: block;"></i>No hay archivos para su facultad</div>`;
    }
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('403')) {
      redirectToLogin();
      return;
    }
    processedFilesListDiv.innerHTML = `<div style="text-align: center; color: #d33; padding: 20px;"><i class="fas fa-exclamation-triangle" style="font-size: 2em; margin-bottom: 10px; display: block;"></i>Error cargando archivos: ${error.message}</div>`;
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
        html: `<p><strong>Registros:</strong> ${recordCount}</p><p><strong>Estado:</strong> Procesado correctamente</p><hr><p><strong>Columnas:</strong></p><ul style="text-align: left; max-height: 220px; overflow-y: auto; margin:0;">${columnList}</ul>`,
        icon: 'info',
        confirmButtonText: 'Cerrar',
        width: '600px'
      });
    } else {
      await Swal.fire({ icon: 'warning', title: 'Sin datos', text: `El archivo "${fileName}" no contiene registros procesados.` });
    }
  } catch (error) {
    await Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo obtener la información del archivo.' });
  }
};

window.removeFile = async function (btn, filename) {
  if (!filename || !confirm(`¿Deseas eliminar el archivo "${filename}"?`)) return;

  try {
    const headers = await getAuthHeaders();
    const url = `${API_BASE}/delete/by-name/${encodeURIComponent(filename)}`;
    const response = await fetch(url, { method: "DELETE", headers });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `Error ${response.status}`);
    }

    btn.closest('.processed-file')?.remove();
    await Swal.fire({ icon: 'success', title: 'Archivo eliminado', text: `El archivo "${filename}" ha sido eliminado correctamente.`, timer: 3000 });
    await fetchAndRenderProcessedFiles();
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('403')) {
      redirectToLogin();
      return;
    }
    await Swal.fire({ icon: 'error', title: 'Error al eliminar', text: err.message || 'No se pudo eliminar el archivo.' });
  }
};

async function processExcelFile() {
  const fileInput = document.getElementById('excel-file-input');
  const files = fileInput?.files;
  const uploadStatus = document.getElementById('upload-status');
  const loadingOverlay = document.getElementById('loading-overlay');

  if (!files || files.length === 0) return;

  try {
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    
    const userEmail = await getStoredUserEmail();
    if (!userEmail) throw new Error('No hay sesión activa');

    const userData = await getCurrentUserFromAPI();
    if (!userData.facultadCod && userData.rol !== 'admin') throw new Error('Usuario sin facultad asignada');

    for (let i = 0; i < files.length; i++) {
      const formData = new FormData();
      formData.append("file", files[i]);
      if (userData.facultadCod) formData.append("facultadCod", userData.facultadCod);

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

    await Swal.fire({ icon: 'success', title: 'Archivos procesados correctamente', text: 'Los archivos Excel se han subido y sincronizado.' });

    if (fileInput) {
      fileInput.value = '';
      const selectedFilesText = document.getElementById('selected-files-text');
      if (selectedFilesText) selectedFilesText.textContent = 'Ningún archivo seleccionado';
    }
  } catch (error) {
    if (loadingOverlay) loadingOverlay.style.display = 'none';

    if (error.message.includes('401') || error.message.includes('403') || error.message.includes('No hay sesión activa')) {
      redirectToLogin();
      return;
    }

    await Swal.fire({ icon: 'error', title: 'Error', text: error.message || 'Error al procesar los archivos.' });
  }

  setTimeout(() => { if (uploadStatus) uploadStatus.textContent = ''; }, 6000);
}

async function syncFilesFromBackendToIndexedDB() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/files`, { headers });
    if (!res.ok) throw new Error(`Error ${res.status}: ${res.statusText}`);

    const data = await res.json();
    const files = data.archivos || [];

    for (let file of files) {
      const fileRes = await fetch(`${API_BASE}/download/${file.id}`, { headers });
      if (!fileRes.ok) continue;
      
      const blob = await fileRes.blob();
      const arrayBuffer = await blob.arrayBuffer();

      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      const fileKey = normalizeFileName(file.nombre);
      const key = `academicTrackingData_${fileKey}`;
      await saveData(key, jsonData);
    }
  } catch (error) {
    throw error;
  }
}

function initTooltips() {
  const badges = document.querySelectorAll('.info-badge[data-tooltip]');
  let currentTooltip = null;

  badges.forEach(badge => {
    badge.addEventListener('mouseenter', (e) => {
      const tooltip = e.target.getAttribute('data-tooltip');
      if (!tooltip) return;

      // Crear tooltip
      currentTooltip = document.createElement('div');
      currentTooltip.className = 'tooltip-pop';
      currentTooltip.textContent = tooltip;
      document.body.appendChild(currentTooltip);

      // Posicionar tooltip
      positionTooltip(e.target, currentTooltip);
      
      // Mostrar con delay
      setTimeout(() => {
        if (currentTooltip) {
          currentTooltip.style.opacity = '1';
        }
      }, 100);
    });

    badge.addEventListener('mouseleave', () => {
      if (currentTooltip) {
        currentTooltip.style.opacity = '0';
        setTimeout(() => {
          if (currentTooltip && currentTooltip.parentNode) {
            document.body.removeChild(currentTooltip);
          }
          currentTooltip = null;
        }, 120);
      }
    });
  });
}

function positionTooltip(trigger, tooltip) {
  const triggerRect = trigger.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  let top, left;
  let position = 'top';

  // Calcular posición vertical
  if (triggerRect.top > tooltipRect.height + 10) {
    // Mostrar arriba
    top = triggerRect.top - tooltipRect.height - 10;
    position = 'top';
  } else {
    // Mostrar abajo
    top = triggerRect.bottom + 10;
    position = 'bottom';
  }

  // Calcular posición horizontal (centrado)
  left = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2);

  // Ajustar si se sale del viewport
  if (left < 10) left = 10;
  if (left + tooltipRect.width > viewportWidth - 10) {
    left = viewportWidth - tooltipRect.width - 10;
  }

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
  tooltip.setAttribute('data-pos', position);
}

// Inicializar tooltips cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  // Tu código existente aquí...
  
  // Inicializar tooltips
  initTooltips();
});

async function getSharedCorreoAutoridad() {
  try {
    const headers = await getAuthHeaders();
    const correoRes = await fetch(`${API_BASE}/correo-autoridad`, { headers });
    if (correoRes.ok) {
      const correoData = await correoRes.json();
      return correoData.correoAutoridad || 'alvaro.espinozabu@ug.edu.ec';
    }
  } catch (error) {
    // Error silencioso
  }
  return 'alvaro.espinozabu@ug.edu.ec';
}

async function loadTemplates() {
  const tipoSelect = document.getElementById('template-type-select');
  const currentType = tipoSelect?.value || 'seguimiento';
  
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/plantillas?tipo=${currentType}`, { headers });
    
    if (res.ok) {
      const data = await res.json();
      const templates = data.plantillas || {};
      document.getElementById('template-autoridad').value = templates.autoridad || '';
      document.getElementById('template-docente').value = templates.docente || '';
      document.getElementById('template-estudiante').value = templates.estudiante || '';
    } else {
      document.getElementById('template-autoridad').value = '';
      document.getElementById('template-docente').value = '';
      document.getElementById('template-estudiante').value = '';
    }
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('403')) {
      redirectToLogin();
      return;
    }
    document.getElementById('template-autoridad').value = '';
    document.getElementById('template-docente').value = '';
    document.getElementById('template-estudiante').value = '';
  }
  
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
      const errorText = await templateResponse.text();
      throw new Error('Error guardando plantillas: ' + errorText);
    }

    const correoResponse = await fetch(`${API_BASE}/correo-autoridad`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ correoAutoridad })
    });

    if (!correoResponse.ok) {
      const errorText = await correoResponse.text();
      throw new Error('Error guardando correo: ' + errorText);
    }

    await Swal.fire({ icon: 'success', title: 'Plantillas guardadas', text: `Plantillas de tipo "${currentType}" guardadas correctamente.` });
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('403')) {
      redirectToLogin();
      return;
    }
    await Swal.fire({ icon: 'error', title: 'Error al guardar', text: error.message || 'No se pudieron guardar las plantillas.' });
  }
}

document.addEventListener('DOMContentLoaded', async function () {
  const hasAccess = await validateAccess();
  if (!hasAccess) return;

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
  document.getElementById('goToMenuButton')?.addEventListener('click', () => { window.location.href = '../index.html'; });

  try {
    await loadTemplates();
    await fetchAndRenderProcessedFiles();
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('403')) {
      redirectToLogin();
    }
  }
});