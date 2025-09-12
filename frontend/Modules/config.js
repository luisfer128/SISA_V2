// config.js
import { saveData, loadData } from '../indexeddb-storage.js';

const API_BASE = 'http://26.127.175.34:5000';

const norm = (v) => (v ?? '').toString().trim();
function normalizeFileName(fileName) {
  return fileName.replace(/\W+/g, "_");
}

function getUserData() {
  try {
    const userData = localStorage.getItem('userData');
    return userData ? JSON.parse(userData) : null;
  } catch (error) {
    console.error('Error al parsear userData:', error);
    return null;
  }
}

// Obtener facultadCod del usuario actual
function getCurrentFacultadCod() {
  const user = getUserData();
  return user?.facultadCod || null;
}

// Obtener headers de autenticación
function getAuthHeaders() {
  const user = getUserData();
  if (!user?.usuario) {
    throw new Error('Usuario no autenticado');
  }
  
  return {
    'Content-Type': 'application/json',
    'X-User-Email': user.usuario
  };
}

/* ===============================
   LISTAR ARCHIVOS PROCESADOS (filtrado por facultad) - CORREGIDO
================================= */
async function fetchAndRenderProcessedFiles() {
  const processedFilesListDiv = document.getElementById('processed-files-list');
  if (!processedFilesListDiv) return;
  processedFilesListDiv.innerHTML = '';

  try {
    const user = getUserData();
    if (!user?.usuario) {
      throw new Error('Usuario no autenticado');
    }

    // ✅ VALIDAR FACULTAD
    if (!user?.facultadCod) {
      throw new Error('Usuario sin facultad asignada');
    }

    const headers = getAuthHeaders();
    delete headers['Content-Type']; // Para GET request
    
    // ✅ ENVIAR FACULTAD COMO QUERY PARAM
    const url = `${API_BASE}/files?facultadCod=${encodeURIComponent(user.facultadCod)}`;
    const res = await fetch(url, { headers });
    
    if (!res.ok) {
      throw new Error(`Error ${res.status}: ${res.statusText}`);
    }
    
    const data = await res.json();
    const files = Array.isArray(data) ? data : data.archivos || [];

    if (files.length > 0) {
      const title = document.createElement('h3');
      title.textContent = 'Archivos Procesados:';
      processedFilesListDiv.appendChild(title);

      files.forEach(file => {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'processed-file';
        fileDiv.style.display = 'flex';
        fileDiv.style.alignItems = 'center';
        fileDiv.style.justifyContent = 'space-between';
        fileDiv.style.gap = '12px';
        fileDiv.style.padding = '8px 12px';
        fileDiv.style.border = '1px solid #e5e7eb';
        fileDiv.style.borderRadius = '8px';
        fileDiv.style.marginBottom = '8px';

        fileDiv.innerHTML = `
          <div>
            <span class="file-name" title="${file.nombre}">${file.nombre}</span>
            <small style="display: block; color: #666; margin-top: 2px;">
              ${file.facultad || file.facultadCod || 'Sin facultad'} - ${file.fecha || 'Sin fecha'}
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
          No hay archivos en el servidor para la facultad: ${user.facultadCod}
        </div>
      `;
    }
  } catch (error) {
    console.error('❌ Error obteniendo archivos procesados:', error);
    
    let errorMessage = 'Error de conexión. Intenta nuevamente.';
    
    if (error.message.includes('Usuario no autenticado')) {
      errorMessage = 'Error de autenticación. Inicia sesión nuevamente.';
      setTimeout(() => {
        window.location.href = '../index.html';
      }, 2000);
    } else if (error.message.includes('sin facultad')) {
      errorMessage = 'Tu usuario no tiene una facultad asignada. Contacta al administrador.';
    } else if (error.message.includes('403')) {
      errorMessage = 'No tienes permisos para ver estos archivos.';
    } else if (error.message.includes('500')) {
      errorMessage = 'Error del servidor. Intenta nuevamente más tarde.';
    }
    
    processedFilesListDiv.innerHTML = `
      <div style="text-align: center; color: #d33; padding: 20px;">
        <i class="fas fa-exclamation-triangle" style="font-size: 2em; margin-bottom: 10px; display: block;"></i>
        ${errorMessage}
      </div>
    `;
  }
}

/* ===============================
   VER DETALLE DE UN ARCHIVO
================================= */
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
          <p><strong>📊 Registros:</strong> ${recordCount}</p>
          <p><strong>📅 Estado:</strong> Procesado correctamente</p>
          <p><strong>🗄️ Almacenado en:</strong> IndexedDB</p>
          <hr>
          <p><strong>📋 Columnas:</strong></p>
          <ul style="text-align: left; max-height: 220px; overflow-y: auto; margin:0;">
            ${columnList}
          </ul>
        `,
        icon: 'info',
        confirmButtonText: 'Cerrar',
        confirmButtonColor: '#3085d6',
        width: '600px'
      });

    } else {
      await Swal.fire({
        icon: 'warning',
        title: 'Sin datos',
        text: `El archivo "${fileName}" no contiene registros procesados en IndexedDB.`,
        confirmButtonColor: '#d33'
      });
    }
  } catch (error) {
    console.error('Error obteniendo detalles:', error);
    await Swal.fire({
      icon: 'error',
      title: 'Error',
      text: '❌ No se pudo obtener la información del archivo.',
      confirmButtonColor: '#d33'
    });
  }
};

/* ===============================
   ELIMINAR ARCHIVO por nombre (validado por facultad) - CORREGIDO
================================= */
window.removeFile = async function (btn, filename) {
  if (!filename || typeof filename !== "string") {
    return alert("Nombre inválido.");
  }
  if (!confirm(`¿Deseas eliminar el archivo "${filename}"?`)) return;

  try {
    const user = getUserData();
    if (!user?.usuario) {
      throw new Error('Usuario no autenticado');
    }

    // ✅ VALIDAR FACULTAD
    if (!user?.facultadCod) {
      throw new Error('Usuario sin facultad asignada');
    }

    const headers = getAuthHeaders();
    delete headers['Content-Type']; // Para DELETE request
    
    // ✅ ENVIAR FACULTAD COMO QUERY PARAM
    const url = `${API_BASE}/delete/by-name/${encodeURIComponent(filename)}?facultadCod=${encodeURIComponent(user.facultadCod)}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers
    });
    
    if (!response.ok) {
      let errorMessage = `Error ${response.status}`;
      try {
        const result = await response.json();
        errorMessage = result.error || errorMessage;
      } catch {
        errorMessage = `Error ${response.status}: ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }
    
    const result = await response.json();
    btn.closest('.processed-file')?.remove();
    
    await Swal.fire({
      icon: 'success',
      title: 'Archivo eliminado',
      text: `✅ El archivo "${filename}" ha sido eliminado correctamente.`,
      confirmButtonColor: '#3085d6',
      timer: 3000
    });
    
    await fetchAndRenderProcessedFiles();
    
  } catch (err) {
    console.error("❌ Error eliminando archivo:", err);
    
    let errorMessage = "No se pudo eliminar el archivo.";
    
    if (err.message.includes('Usuario no autenticado')) {
      errorMessage = "Sesión expirada. Inicia sesión nuevamente.";
      setTimeout(() => {
        window.location.href = '../index.html';
      }, 2000);
    } else if (err.message.includes('sin facultad')) {
      errorMessage = "Tu usuario no tiene una facultad asignada.";
    } else if (err.message.includes('permisos')) {
      errorMessage = "No tienes permisos para eliminar este archivo.";
    } else if (err.message.includes('404')) {
      errorMessage = "El archivo no existe o ya fue eliminado.";
    } else if (err.message.includes('NetworkError') || err.message.includes('fetch')) {
      errorMessage = "Error de conexión. Verifica tu red.";
    } else {
      errorMessage += ` Detalle: ${err.message}`;
    }

    await Swal.fire({
      icon: 'error',
      title: 'Error al eliminar',
      text: errorMessage,
      confirmButtonColor: '#d33'
    });
  }
};

/* ===============================
   SOLO ACTUALIZAR LA VISTA POR PERIODO (NO DESCARGA)
================================= */
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

  const KEY_TOTAL   = `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL.xlsx')}`;
  const KEY_PARCIAL = `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL.xlsx')}`;

  let base = await loadData(KEY_TOTAL);
  let source = 'TOTAL';
  if (!Array.isArray(base) || !base.length) {
    base = await loadData(KEY_PARCIAL);
    source = 'PARCIAL';
  }
  if (!Array.isArray(base) || !base.length) {
    await Swal.fire({
      icon: 'warning',
      title: 'Sin datos base',
      text: 'No se encuentra el dataset en IndexedDB para filtrar por período. Realiza una sincronización primero.',
    });
    return;
  }

  const filtered = base.filter(r => norm(r['PERIODO']) === selectedPeriod);
  await saveData("academicTrackingData_REPORTE_POR_SEMESTRE", filtered);
  console.log(`📂 Vista por período actualizada desde ${source} → (${filtered.length} registros)`);

  await Swal.fire({
    icon: 'success',
    title: 'Periodo actualizado',
    text: `La tabla se actualizó para el período: ${selectedPeriod}`,
    confirmButtonColor: '#3085d6'
  });
}

/* ===============================
   SUBIR ARCHIVOS (con autenticación por facultad) - CORREGIDO
================================= */
async function processExcelFile() {
  const fileInput = document.getElementById('excel-file-input');
  const files = fileInput?.files;
  const uploadStatus = document.getElementById('upload-status');
  const loadingOverlay = document.getElementById('loading-overlay');

  // Si NO hay archivos seleccionados: SOLO actualiza la vista por PERIODO
  if (!files || files.length === 0) {
    await updatePeriodViewFromLocal();
    return;
  }

  // Si hay archivos, sube al backend con autenticación
  try {
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    console.log("📤 Iniciando procesamiento de archivos...");

    const user = getUserData();
    if (!user?.usuario) {
      throw new Error('Usuario no autenticado');
    }

    // ✅ VALIDAR FACULTAD
    if (!user?.facultadCod) {
      throw new Error('Usuario sin facultad asignada');
    }

    console.log(`👤 Usuario: ${user.usuario}, Facultad: ${user.facultadCod}`);

    for (let i = 0; i < files.length; i++) {
      console.log(`➡️ Subiendo archivo ${files[i].name}`);

      const formData = new FormData();
      formData.append("file", files[i]);
      // ✅ AGREGAR FACULTAD
      formData.append("facultadCod", user.facultadCod);

      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: {
          'X-User-Email': user.usuario
          // ✅ NO incluir Content-Type para FormData
        },
        body: formData
      });

      console.log(`📬 Respuesta recibida (${response.status})`);
      
      if (!response.ok) {
        let errorMessage = `Error ${response.status}`;
        try {
          const errorResult = await response.json();
          errorMessage = errorResult.error || errorMessage;
        } catch {
          errorMessage = `Error ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      console.log("📦 Resultado:", result);

      if (uploadStatus) {
        uploadStatus.textContent = result.message || 'Archivo subido.';
        uploadStatus.style.color = 'green';
      }
    }

    console.log("🔄 Sincronizando desde backend...");
    await syncFilesFromBackendToIndexedDB();
    await fetchAndRenderProcessedFiles();
    if (loadingOverlay) loadingOverlay.style.display = 'none';

    await Swal.fire({
      icon: 'success',
      title: '¡Archivos procesados!',
      text: '✅ Los archivos Excel se han subido y sincronizado correctamente.',
      confirmButtonColor: '#3085d6'
    });

    if (fileInput) {
      fileInput.value = '';
      const selectedFilesText = document.getElementById('selected-files-text');
      if (selectedFilesText) selectedFilesText.textContent = 'Ningún archivo seleccionado';
    }

  } catch (error) {
    console.error('❌ Error al procesar archivo(s):', error);
    if (loadingOverlay) loadingOverlay.style.display = 'none';

    let errorMessage = '❌ Ocurrió un error al procesar los archivos.';
    
    // ✅ MENSAJES DE ERROR MÁS ESPECÍFICOS
    if (error.message.includes('Usuario no autenticado')) {
      errorMessage = '❌ Sesión expirada. Inicia sesión nuevamente.';
      setTimeout(() => {
        window.location.href = '../index.html';
      }, 2000);
    } else if (error.message.includes('sin facultad')) {
      errorMessage = '❌ Tu usuario no tiene una facultad asignada. Contacta al administrador.';
    } else if (error.message.includes('FacultadCod')) {
      errorMessage = '❌ Error con la facultad asignada. Verifica tu configuración.';
    } else if (error.message.includes('permisos')) {
      errorMessage = '❌ No tienes permisos para subir archivos a esta facultad.';
    } else if (error.message.includes('400')) {
      errorMessage = '❌ Error en el archivo o datos enviados. Verifica el formato.';
    } else if (error.message.includes('500')) {
      errorMessage = '❌ Error del servidor. Intenta nuevamente.';
    } else if (error.message.includes('NetworkError') || error.message.includes('fetch')) {
      errorMessage = '❌ Error de conexión. Verifica tu red e intenta nuevamente.';
    } else {
      errorMessage += ` Detalle: ${error.message}`;
    }

    await Swal.fire({
      icon: 'error',
      title: 'Error',
      text: errorMessage,
      confirmButtonColor: '#d33'
    });
  }

  setTimeout(() => {
    if (uploadStatus) uploadStatus.textContent = '';
  }, 6000);
}

/* ===============================
   SINCRONIZACIÓN COMPLETA (con autenticación)
================================= */
async function syncFilesFromBackendToIndexedDB() {
  const periodSelect = document.getElementById("period-select");
  const selectedPeriod = periodSelect?.value || localStorage.getItem('selectedPeriod') || '';

  try {
    const headers = getAuthHeaders();
    delete headers['Content-Type'];
    
    const res = await fetch(`${API_BASE}/files`, { headers });
    if (!res.ok) {
      throw new Error(`Error ${res.status}: ${res.statusText}`);
    }
    
    const data = await res.json();
    const files = Array.isArray(data) ? data : data.archivos || [];

    for (let file of files) {
      const fileRes = await fetch(`${API_BASE}/download/${file.id}`, { headers });
      if (!fileRes.ok) {
        console.warn('No se pudo descargar:', file.nombre, file.id);
        continue;
      }
      const blob = await fileRes.blob();
      const arrayBuffer = await blob.arrayBuffer();

      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      const fileKey = normalizeFileName(file.nombre);

      // Si es el TOTAL, guardamos además la vista por PERIODO 
      if (file.nombre.toUpperCase().includes("REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL")) {
        let targetPeriod = selectedPeriod;
        if (!targetPeriod) {
          const uniquePeriods = Array.from(new Set(jsonData.map(r => norm(r['PERIODO'])).filter(Boolean)));
          targetPeriod = pickMostRecentPeriod(uniquePeriods);
          if (targetPeriod) {
            localStorage.setItem('selectedPeriod', targetPeriod);
            if (periodSelect && [...periodSelect.options].some(o => o.value === targetPeriod)) {
              periodSelect.value = targetPeriod;
            }
          }
        }
        const filtered = jsonData.filter(row => norm(row['PERIODO']) === targetPeriod);
        await saveData("academicTrackingData_REPORTE_POR_SEMESTRE", filtered);
        console.log(`📂 Guardado academicTrackingData_REPORTE_POR_SEMESTRE (${filtered.length} registros) para ${targetPeriod}`);
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

/* ===============================
   Selección del período más reciente
================================= */
function pickMostRecentPeriod(periods) {
  const parsePeriod = (p) => {
    const m = String(p).match(/(\d{4}).*?(\d{4}).*(CI{1,2})/i);
    if (!m) return { y1: -1, term: -1, raw: p };
    return { y1: Number(m[1]), term: m[3].toUpperCase() === 'CII' ? 2 : 1, raw: p };
  };
  const sorted = periods.slice().sort((A, B) => {
    const a = parsePeriod(A), b = parsePeriod(B);
    if (a.y1 !== b.y1) return b.y1 - a.y1;
    if (a.term !== b.term) return b.term - a.term;
    return String(b.raw).localeCompare(String(a.raw));
  });
  return sorted[0] || '';
}

/* ===============================
   LLENAR COMBO DE PERIODOS
================================= */
async function populatePeriodSelectFromLocal() {
  const select = document.getElementById('period-select');
  if (!select) return;

  const KEY_TOTAL   = `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL.xlsx')}`;
  const KEY_PARCIAL = `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL.xlsx')}`;

  let data = await loadData(KEY_TOTAL);
  if (!Array.isArray(data) || !data.length) {
    data = await loadData(KEY_PARCIAL);
  }
  if (!Array.isArray(data) || !data.length) {
    console.warn('No hay datos en IndexedDB para construir el combo de PERIODO.');
    return;
  }

  const periodsSet = new Set(
    data.map(r => norm(r['PERIODO'])).filter(Boolean)
  );
  let periods = Array.from(periodsSet);

  const parsePeriod = (p) => {
    const m = p.match(/(\d{4}).*?(\d{4}).*(CI{1,2})/i);
    if (!m) return { y1: -1, term: -1, raw: p };
    return { y1: Number(m[1]), term: m[3].toUpperCase()==='CII' ? 2 : 1, raw: p };
  };
  periods.sort((A, B) => {
    const a = parsePeriod(A), b = parsePeriod(B);
    if (a.y1 !== b.y1) return b.y1 - a.y1;
    if (a.term !== b.term) return b.term - a.term;
    return String(b.raw).localeCompare(String(a.raw));
  });

  const saved = localStorage.getItem('selectedPeriod');
  const selected = (saved && periods.includes(saved)) ? saved : pickMostRecentPeriod(periods);

  select.innerHTML = '';
  for (const p of periods) {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    select.appendChild(opt);
  }
  if (selected) {
    select.value = selected;
    localStorage.setItem('selectedPeriod', selected);
  }
}

/* ===============================
   OBTENER CORREO AUTORIDAD COMPARTIDO
================================= */
async function getSharedCorreoAutoridad() {
  try {
    // Intentar cargar desde la API primero
    const headers = getAuthHeaders();
    const correoRes = await fetch(`${API_BASE}/correo-autoridad`, { headers });
    
    if (correoRes.ok) {
      const correoData = await correoRes.json();
      const correo = correoData.correoAutoridad || 'alvaro.espinozabu@ug.edu.ec';
      
      // Guardar en IndexedDB para uso posterior
      await saveData('shared_correo_autoridad', correo);
      return correo;
    }
  } catch (error) {
    console.warn('⚠️ Error cargando correo desde API, intentando IndexedDB:', error);
  }
  
  try {
    // Intentar cargar desde IndexedDB como respaldo
    const savedCorreo = await loadData('shared_correo_autoridad');
    return savedCorreo || 'alvaro.espinozabu@ug.edu.ec';
  } catch (error) {
    console.error('⚠️ Error cargando correo desde IndexedDB:', error);
    return 'alvaro.espinozabu@ug.edu.ec'; // fallback final
  }
}

/* ===============================
   CARGAR PLANTILLAS POR TIPO - CON CORREO COMPARTIDO
================================= */
async function loadTemplates() {
  const tipoSelect = document.getElementById('template-type-select');
  const currentType = tipoSelect?.value || 'seguimiento';
  
  try {
    // Primero intentar cargar desde la API con el tipo específico
    const headers = getAuthHeaders();
    const res = await fetch(`${API_BASE}/plantillas?tipo=${currentType}`, { headers });
    
    if (res.ok) {
      const data = await res.json();
      // Si la API devuelve datos, usarlos
      if (data && (data.autoridad || data.docente || data.estudiante)) {
        document.getElementById('template-autoridad').value = data.autoridad || '';
        document.getElementById('template-docente').value = data.docente || '';
        document.getElementById('template-estudiante').value = data.estudiante || '';
        
        // Cargar el correo compartido
        const correoAutoridad = await getSharedCorreoAutoridad();
        document.getElementById('correo').value = correoAutoridad;
        
        return; // Salir aquí si la API funcionó
      }
    }
    
    console.warn('API no devolvió datos, cargando desde IndexedDB...');
    
  } catch (error) {
    console.error('⚠️ Error cargando plantillas desde API:', error);
  }
  
  // Si la API falló o no devolvió datos, cargar desde IndexedDB
  try {
    const localKey = `emailTemplates_${currentType}`;
    const local = await loadData(localKey);
    
    // Cargar el correo compartido independientemente de las plantillas
    const correoAutoridad = await getSharedCorreoAutoridad();
    document.getElementById('correo').value = correoAutoridad;
    
    if (local) {
      document.getElementById('template-autoridad').value = local.autoridad || '';
      document.getElementById('template-docente').value = local.docente || '';
      document.getElementById('template-estudiante').value = local.estudiante || '';
    } else {
      // Si no hay datos locales, limpiar los campos de plantillas
      document.getElementById('template-autoridad').value = '';
      document.getElementById('template-docente').value = '';
      document.getElementById('template-estudiante').value = '';
    }
    
  } catch (localError) {
    console.error('⚠️ Error cargando plantillas desde IndexedDB:', localError);
    // Limpiar campos en caso de error total
    document.getElementById('template-autoridad').value = '';
    document.getElementById('template-docente').value = '';
    document.getElementById('template-estudiante').value = '';
    
    // Aún así intentar cargar el correo compartido
    try {
      const correoAutoridad = await getSharedCorreoAutoridad();
      document.getElementById('correo').value = correoAutoridad;
    } catch {
      document.getElementById('correo').value = 'alvaro.espinozabu@ug.edu.ec';
    }
  }
}

/* ===============================
   CARGAR CORREO AUTORIDAD (FUNCIÓN INDEPENDIENTE)
================================= */
async function loadCorreoAutoridad() {
  try {
    const correoAutoridad = await getSharedCorreoAutoridad();
    document.getElementById('correo').value = correoAutoridad;
    console.log(`✅ Correo de autoridad cargado: ${correoAutoridad}`);
  } catch (error) {
    console.error('⚠️ Error cargando correo de autoridad:', error);
    document.getElementById('correo').value = 'alvaro.espinozabu@ug.edu.ec'; // fallback
  }
}

/* ===============================
   ACTUALIZAR CORREO EN TODAS LAS PLANTILLAS EXISTENTES
================================= */
async function updateSharedCorreoInAllTemplates(newCorreo) {
  const templateTypes = ['seguimiento', 'inasistencia', 'otro']; // Ajusta según tus tipos
  
  for (const tipo of templateTypes) {
    try {
      const localKey = `emailTemplates_${tipo}`;
      const existingTemplate = await loadData(localKey);
      
      if (existingTemplate) {
        // Actualizar el correo manteniendo las demás plantillas
        existingTemplate.correoAutoridad = newCorreo;
        await saveData(localKey, existingTemplate);
        console.log(`✅ Correo actualizado en plantilla tipo: ${tipo}`);
      }
    } catch (error) {
      console.warn(`⚠️ Error actualizando correo en plantilla ${tipo}:`, error);
    }
  }
}

/* ===============================
   GUARDAR PLANTILLAS POR TIPO - CON CORREO COMPARTIDO
================================= */
async function saveTemplates() {
  const tipoSelect = document.getElementById('template-type-select');
  const currentType = tipoSelect?.value || 'seguimiento';
  
  const templateAutoridad = document.getElementById('template-autoridad').value;
  const templateDocente   = document.getElementById('template-docente').value;
  const templateEstudiante= document.getElementById('template-estudiante').value;
  const correoInput = document.getElementById('correo').value.trim();
  const correoAutoridad = correoInput === "" ? "alvaro.espinozabu@ug.edu.ec" : correoInput;

  try {
    // 1. Guardar el correo compartido globalmente
    await saveData('shared_correo_autoridad', correoAutoridad);
    
    // 2. Actualizar el correo en todas las plantillas existentes
    await updateSharedCorreoInAllTemplates(correoAutoridad);
    
    // 3. Guardar las plantillas del tipo actual (sin correo, ya que ahora es compartido)
    const localTemplates = { 
      autoridad: templateAutoridad, 
      docente: templateDocente, 
      estudiante: templateEstudiante 
    };
    const localKey = `emailTemplates_${currentType}`;
    await saveData(localKey, localTemplates);

    // 4. Enviar plantillas a la API (sin correoAutoridad)
    const apiTemplates = { 
      autoridad: templateAutoridad, 
      docente: templateDocente, 
      estudiante: templateEstudiante,
      tipo: currentType
    };

    const headers = getAuthHeaders();
    await fetch(`${API_BASE}/plantillas`, {
      method: 'POST',
      headers,
      body: JSON.stringify(apiTemplates)
    });
    
    // 5. Guardar correo en la API por separado
    await saveCorreoAutoridad(correoAutoridad);
    
    await Swal.fire({
      icon: 'success',
      title: '¡Plantillas guardadas!',
      text: `✅ Plantillas de tipo "${currentType}" y correo de autoridad guardados correctamente para todas las plantillas.`,
      confirmButtonColor: '#3085d6'
    });
    
  } catch (error) {
    console.error('❌ Error al guardar plantillas:', error);
    await Swal.fire({
      icon: 'warning',
      title: 'Guardado parcial',
      text: '⚠️ Las plantillas se guardaron localmente, pero no se pudo sincronizar completamente con el servidor.',
      confirmButtonColor: '#f39c12'
    });
  }
}

/* ===============================
   GUARDAR CORREO AUTORIDAD
================================= */
async function saveCorreoAutoridad(correoAutoridad) {
  try {
    const headers = getAuthHeaders();
    const correoData = { correoAutoridad: correoAutoridad };
    
    const correoResponse = await fetch(`${API_BASE}/correo-autoridad`, {
      method: 'POST',
      headers,
      body: JSON.stringify(correoData)
    });
    
    if (!correoResponse.ok) {
      const errorResult = await correoResponse.json();
      throw new Error('Error guardando correo: ' + (errorResult.error || correoResponse.status));
    }
    
    console.log('✅ Correo de autoridad guardado correctamente en la API');
    
  } catch (error) {
    console.error('❌ Error guardando correo de autoridad:', error);
    throw error; // Re-throw para que sea manejado por la función principal
  }
}

/* ===============================
   DOMContentLoaded
================================= */
document.addEventListener('DOMContentLoaded', async function () {
  // Verificar autenticación
  const userData = getUserData();
  if (!userData?.usuario) {
    await Swal.fire({
      icon: 'error',
      title: 'Sesión requerida',
      text: 'Debes iniciar sesión para acceder a esta página.',
      confirmButtonColor: '#d33'
    });
    window.location.href = '../index.html';
    return;
  }

  console.log('Usuario autenticado:', userData.usuario, 'Facultad:', userData.facultadCod);

  // Mostrar nombres de archivos elegidos
  const backToMenuButton = document.getElementById('goToMenuButton');
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

  // Botón "Procesar Archivo(s)"
  document.getElementById('process-files-button')?.addEventListener('click', processExcelFile);

  // Selector de tipo de plantilla
  const typeSelect = document.getElementById('template-type-select');
  if (typeSelect) {
    typeSelect.addEventListener('change', loadTemplates);
  }

  // Guardar plantillas
  document.getElementById('save-templates-button')?.addEventListener('click', saveTemplates, saveCorreoAutoridad);  

  // Selector de período
  const periodSelect = document.getElementById('period-select');
  if (periodSelect) {
    periodSelect.addEventListener('change', async () => {
      localStorage.setItem('selectedPeriod', periodSelect.value);
      await updatePeriodViewFromLocal();
    });
  }

  // Botón volver al menú
  if (backToMenuButton) {
    backToMenuButton.addEventListener('click', () => {
      window.location.href = '../index.html';
    });
  }

  // Carga inicial
  try {
    await loadTemplates();
    await loadCorreoAutoridad();
    await fetchAndRenderProcessedFiles();
    await populatePeriodSelectFromLocal();
  } catch (error) {
    console.error('Error en carga inicial:', error);
    if (error.message.includes('Usuario no autenticado')) {
      await Swal.fire({
        icon: 'error',
        title: 'Sesión expirada',
        text: 'Tu sesión ha expirado. Serás redirigido al login.',
        confirmButtonColor: '#d33'
      });
      window.location.href = '../index.html';
    }
  }

  // Tooltip para info badges
  (function setupFloatingTooltip(){
    let tipEl = null;

    const show = (el) => {
      const text = el.getAttribute('data-tooltip') || el.getAttribute('title') || '';
      if (!text) return;

      if (!tipEl) {
        tipEl = document.createElement('div');
        tipEl.className = 'tooltip-pop';
        document.body.appendChild(tipEl);
      }
      tipEl.textContent = text;
      tipEl.style.opacity = '0';
      tipEl.style.display = 'block';

      const r = el.getBoundingClientRect();
      const margin = 10;

      let left = r.left + r.width / 2 - tipEl.offsetWidth / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tipEl.offsetWidth - 8));

      let top = r.top - tipEl.offsetHeight - margin;
      let pos = 'top';

      if (top < 8) {
        top = r.bottom + margin;
        pos = 'bottom';
      }

      tipEl.dataset.pos = pos;
      tipEl.style.left = `${left}px`;
      tipEl.style.top  = `${top}px`;
      tipEl.style.opacity = '1';
    };

    const hide = () => { if (tipEl) tipEl.style.display = 'none'; };

    document.addEventListener('mouseenter', (e) => {
      const t = e.target.closest('.info-badge');
      if (t) show(t);
    }, true);

    document.addEventListener('mouseleave', (e) => {
      const t = e.target.closest('.info-badge');
      if (t) hide();
    }, true);

    document.addEventListener('focusin',  (e) => { const t = e.target.closest('.info-badge'); if (t) show(t); });
    document.addEventListener('focusout', (e) => { const t = e.target.closest('.info-badge'); if (t) hide(); });
  })();
});