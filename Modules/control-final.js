import { loadData } from '../indexeddb-storage.js';
import { enviarCorreos } from './emailModule.js';

const norm = (s) => (s ?? '').toString().trim();
const asNum = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

// UI helpers
const showLoading = (title = 'Enviando correos...') => window.Swal ? Swal.fire({ title, html: 'Esto puede tardar unos segundos.', allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() }) : createLoadingOverlay(title);
const hideLoading = () => window.Swal && Swal.isVisible() ? Swal.close() : removeLoadingOverlay();
const showModal = ({ icon = 'info', title = '', html = '', timer = null }) => window.Swal ? Swal.fire({ icon, title, html, timer, showConfirmButton: !timer }) : (alert(`${title}\n\n${html.replace(/<[^>]*>/g, '')}`), Promise.resolve());
const escapeHtml = (s = '') => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

function createLoadingOverlay(text) {
  if (document.getElementById('email-loading-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'email-loading-overlay';
  overlay.style.cssText = `position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 99999; color: #fff; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;`;
  overlay.innerHTML = `<div style="padding: 18px 22px; background: rgba(0,0,0,.65); border-radius: 10px; text-align:center; min-width: 260px"><div class="spinner" style="width:36px;height:36px;border:4px solid #fff;border-top-color:transparent;border-radius:50%;margin:0 auto 12px;animation:spin 1s linear infinite"></div><div>${escapeHtml(text)}</div></div>`;
  const style = document.createElement('style'); style.textContent = `@keyframes spin{to{transform:rotate(360deg)}}`;
  overlay.appendChild(style); document.body.appendChild(overlay);
}
const removeLoadingOverlay = () => document.getElementById('email-loading-overlay')?.remove();

// Docentes helpers
const canon = (s) => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function loadDocentesDetalle() {
  for (const k of ['academicTrackingData_REPORTE_DETALLADO_DOCENTES_xlsx', 'REPORTE_DETALLADO_DOCENTES', 'academicTrackingData_REPORTE_DETALLADO_DOCENTES']) {
    const data = await loadData(k);
    if (Array.isArray(data) && data.length) return data;
  }
  console.warn('⚠️ No se encontró REPORTE_DETALLADO_DOCENTES');
  return [];
}

function buildDocentesExcelSet(docentesExcel) {
  const set = new Set();
  (docentesExcel || []).forEach(r => {
    const nombres = norm(r["NOMBRES"]), apellidos = norm(r["APELLIDOS"]), docente = norm(r["DOCENTE"]) || norm(r["Nombre Docente"]) || norm(r["NOMBRE"]);
    [nombres, apellidos, docente, apellidos && nombres ? `${apellidos} ${nombres}` : '', nombres && apellidos ? `${nombres} ${apellidos}` : ''].filter(Boolean).forEach(c => set.add(canon(c)));
  });
  return set;
}

function extractDocentesFromSelected(students) {
  const docentes = new Set();
  (students || []).forEach(s => {
    const arr = Array.isArray(s["[Vez] Materia (Docente)"]) ? s["[Vez] Materia (Docente)"] : [s["[Vez] Materia (Docente)"]];
    (arr || []).forEach(m => {
      const nombre = String(m).match(/\(([^)]+)\)/)?.[1]?.split(':')[0]?.trim();
      if (nombre) docentes.add(nombre);
    });
  });
  return Array.from(docentes);
}

function computeMissingDocentes(selected, docentesExcel) {
  const excelSet = buildDocentesExcelSet(docentesExcel);
  return extractDocentesFromSelected(selected).filter(n => !excelSet.has(canon(n))).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function getDocenteIdFromRow(r) {
  for (const k of ["IDENTIFICACION","IDENTIFICACIÓN","CI","CEDULA","CÉDULA","DOCUMENTO","Documento"]) {
    const v = norm(r[k]); if (v) return v;
  }
  return '';
}

function getEmailFromRow(r) {
  for (const k of ["CORREO_SIUG","CORREO INSTITUCIONAL","CORREO","EMAIL","MAIL","E-MAIL"]) {
    const v = norm(r[k]); if (v) return v;
  }
  return '';
}

function rowNameCandidates(r) {
  const nombres = norm(r["NOMBRES"]), apellidos = norm(r["APELLIDOS"]), docente = norm(r["DOCENTE"]) || norm(r["Nombre Docente"]) || norm(r["NOMBRE"]);
  return [docente, apellidos && nombres ? `${apellidos} ${nombres}` : '', nombres && apellidos ? `${nombres} ${apellidos}` : '', nombres, apellidos].filter(Boolean);
}

function computeNoEmailDocentesMessages(selected, docentesExcel) {
  const docentes = extractDocentesFromSelected(selected), messages = new Set();
  docentes.forEach(nombre => {
    const matches = docentesExcel.filter(r => rowNameCandidates(r).some(c => canon(c) === canon(nombre)));
    if (matches.length && !matches.some(getEmailFromRow)) {
      const id = matches.map(getDocenteIdFromRow).find(Boolean);
      messages.add(id ? `Sin correo para docente con IDENTIFICACION "${id}" en REPORTE_DETALLADO_DOCENTES` : `Sin correo para docente "${nombre}" en REPORTE_DETALLADO_DOCENTES`);
    }
  });
  return Array.from(messages).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

// Build rows con filtros
async function buildRows(periodoSeleccionado = null, carreraSeleccionada = null) {
  const datosNotas = await loadData('academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx');
  const datosNomina = await loadData('academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx');
  const datosCalificaciones = await loadData('academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx') || [];

  if (!Array.isArray(datosNotas) || !Array.isArray(datosNomina)) return { rows: [], periodos: [], carreras: [] };

  const todasLasFuentes = [...datosNotas, ...datosCalificaciones];
  const periodosUnicos = [...new Set(todasLasFuentes.map(r => norm(r["PERIODO"])).filter(Boolean))].sort((a,b) => String(b).localeCompare(String(a)));
  
  let periodoActual = periodoSeleccionado || localStorage.getItem('selectedPeriodSRP') || periodosUnicos[0];
  if (!periodosUnicos.includes(periodoActual)) periodoActual = periodosUnicos[0];

  const carrerasUnicas = ['Todas', ...[...new Set(todasLasFuentes.filter(r => norm(r["PERIODO"]) === periodoActual).map(r => norm(r["CARRERA"])).filter(Boolean))].sort((a,b) => a.localeCompare(b,'es',{sensitivity:'base'}))];
  
  let carreraActual = carreraSeleccionada || localStorage.getItem('selectedCareerSRP') || 'Todas';
  if (!carrerasUnicas.includes(carreraActual)) carreraActual = 'Todas';

  localStorage.setItem('selectedPeriodSRP', periodoActual);
  localStorage.setItem('selectedCareerSRP', carreraActual);

  const mapaNEE = new Map();
  datosNomina.forEach(r => {
    const id = norm(r["IDENTIFICACION"]), disc = norm(r["DISCAPACIDAD"]), pct = norm(r["PORCENTAJE DISCAPACIDAD"]);
    if (id) mapaNEE.set(id, disc ? `${disc}${pct ? ` ${pct}%` : ''}` : '');
  });

  const rows = [];
  datosNotas.forEach(row => {
    const id = norm(row["IDENTIFICACION"]), periodo = norm(row["PERIODO"]), carrera = norm(row["CARRERA"]);
    if (!id || periodo !== periodoActual || (carreraActual !== 'Todas' && carrera !== carreraActual)) return;

    const estado = norm(row["ESTADO"]);
    if (estado !== "REPROBADO") {
      const p1 = asNum(row["PRIMER_PARCIAL"]), p2 = asNum(row["SEGUNDO_PARCIAL"]), a1 = asNum(row["ASISTENCIA_PRIMER_PARCIAL"]), a2 = asNum(row["ASISTENCIA_SEGUNDO_PARCIAL"]);
      if (!((p1 !== null && p1 < 4) || (p2 !== null && p2 < 4) || (a1 !== null && a1 < 40) || (a2 !== null && a2 < 40))) return;
    }

    const noVez = asNum(row["NO. VEZ"]), tieneNEE = mapaNEE.has(id) && mapaNEE.get(id);
    if (!tieneNEE && (noVez === null || noVez < 2)) return;
    if (tieneNEE && (noVez === null || noVez < 1)) return;

    const promParc = asNum(row["PROMEDIO_PARCIALES"]), recup = asNum(row["RECUPERACION"]), mejor = asNum(row["MEJORAMIENTO"]), extra = recup ?? mejor;
    const materia = norm(row["MATERIA"]), docente = norm(row["DOCENTE"]);

    rows.push({
      _key: `${id}||${materia}||${periodo}`,
      Identificación: id,
      Estudiante: `${norm(row["APELLIDOS"])} ${norm(row["NOMBRES"])}`,
      Correo: [norm(row["CORREO_INSTITUCIONAL"]), norm(row["CORREO_PERSONAL"])].filter(Boolean).join('; '),
      NEE: tieneNEE ? mapaNEE.get(id) : '',
      Nivel: norm(row["NIVEL"]),
      Carrera: carrera,
      "[Vez] Materia (Docente)": `[${noVez}] ${materia}${docente ? ` (${docente})` : ''}`,
      "Parcial Final/[Mejor/Recup]": `${promParc ?? '-'} / ${extra ?? '-'}`,
      Promedio: asNum(row["PROMEDIO"])?.toFixed(2) ?? '-',
      Estado: '💀',
    });
  });

  return { rows, periodos: periodosUnicos, carreras: carrerasUnicas };
}

function renderTable(rows) {
  const tbody = document.getElementById('academicTrackingTableBody');
  const totalSpan = document.getElementById('total-materia');
  const totalStu = document.getElementById('total-students');
  const resumen = document.getElementById('estado-resumen');
  if (!tbody) return;

  tbody.innerHTML = '';
  const uniqueStudents = new Set();

  rows.forEach(r => {
    const tr = document.createElement('tr');
    [r.Identificación, r.Estudiante, r.Correo, r.NEE, r.Nivel, r["[Vez] Materia (Docente)"], r["Parcial Final/[Mejor/Recup]"], r.Promedio, r.Estado].forEach(text => tr.insertCell().textContent = text);
    
    const cbCell = tr.insertCell();
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true; cb.dataset.key = r._key;
    cbCell.appendChild(cb);
    
    tbody.appendChild(tr);
    uniqueStudents.add(r.Identificación);
  });

  if (totalSpan) totalSpan.textContent = `Total de Materias: ${rows.length}`;
  if (totalStu) totalStu.textContent = `Total de Estudiantes: ${uniqueStudents.size}`;
  if (resumen) resumen.innerHTML = `<span id="skull-count" class="count-badge count-badge--skull" style= "margin-right: 40px">💀: <strong>${rows.length}</strong></span>`;
}

function populateSelects(periodos, carreras, periodoActual, carreraActual) {
  const periodSelect = document.getElementById('period-select');
  const careerSelect = document.getElementById('carrer-select');

  if (periodSelect) periodSelect.innerHTML = periodos.map(p => `<option value="${escapeHtml(p)}" ${p === periodoActual ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('');
  if (careerSelect) careerSelect.innerHTML = carreras.map(c => `<option value="${escapeHtml(c)}" ${c === carreraActual ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

// Nueva función para filtrar por NEE
function filterByNEE(rows) {
  return rows.filter(row => row.NEE && row.NEE.trim() !== '');
}

document.addEventListener('DOMContentLoaded', async () => {
  const elements = {
    filterInput: document.getElementById('filterAcademicInput'),
    sendBtn: document.getElementById('sendAcademicEmails'),
    backBtn: document.getElementById('goToMenuButton'),
    periodSelect: document.getElementById('period-select'),
    careerSelect: document.getElementById('carrer-select')
  };

  let allRows = [], allPeriodos = [], allCarreras = [];
  let isNEEFiltered = false; // Estado del filtro NEE

  async function loadAndRender(periodoSeleccionado = null, carreraSeleccionada = null) {
    const result = await buildRows(periodoSeleccionado, carreraSeleccionada);
    allPeriodos = result.periodos; allCarreras = result.carreras;
    
    const periodoActual = periodoSeleccionado || localStorage.getItem('selectedPeriodSRP') || allPeriodos[0];
    const carreraActual = carreraSeleccionada || localStorage.getItem('selectedCareerSRP') || 'Todas';
    
    populateSelects(allPeriodos, allCarreras, periodoActual, carreraActual);
    
    allRows = result.rows.filter(r => { const p = asNum(r.Promedio); return p !== null && p < 7; }).sort((a, b) => a.Estudiante.localeCompare(b.Estudiante, 'es', { sensitivity: 'base' }));
    
    // Si había un filtro NEE activo, mantenerlo
    if (isNEEFiltered) {
      const filteredRows = filterByNEE(allRows);
      renderTable(filteredRows);
    } else {
      renderTable(allRows);
    }
  }

  await loadAndRender();

  elements.periodSelect?.addEventListener('change', (e) => loadAndRender(e.target.value, elements.careerSelect?.value));
  elements.careerSelect?.addEventListener('change', (e) => loadAndRender(elements.periodSelect?.value, e.target.value));

  elements.filterInput?.addEventListener('input', () => {
    const q = elements.filterInput.value.toLowerCase();
    let rowsToFilter = isNEEFiltered ? filterByNEE(allRows) : allRows;
    renderTable(rowsToFilter.filter(r => [r.Identificación, r.Estudiante, r.Correo, r.NEE, r.Nivel, r["[Vez] Materia (Docente)"], r["Parcial Final/[Mejor/Recup]"], r.Promedio].some(v => String(v ?? '').toLowerCase().includes(q))));
  });

  // Event listener para el encabezado NEE
  const neeHeader = document.querySelector('th:nth-child(4)'); // Asumiendo que NEE es la 4ta columna
  if (neeHeader && neeHeader.textContent.includes('NEE')) {
    neeHeader.style.cursor = 'pointer';
    neeHeader.style.userSelect = 'none';
    neeHeader.addEventListener('click', () => {
      isNEEFiltered = !isNEEFiltered;
      
      if (isNEEFiltered) {
        neeHeader.title = 'Click para mostrar todos los registros';
        
        // Filtrar y mostrar solo los registros con NEE
        const filteredRows = filterByNEE(allRows);
        renderTable(filteredRows);
      } else {
        neeHeader.title = 'Click para filtrar solo estudiantes con NEE';
        
        // Mostrar todos los registros
        renderTable(allRows);
      }
      
      // Limpiar el filtro de búsqueda si está activo
      if (elements.filterInput) {
        elements.filterInput.value = '';
      }
    });
    
    // Agregar título inicial
    neeHeader.title = 'Click para filtrar solo estudiantes con NEE';
  }

  elements.sendBtn?.addEventListener('click', async () => {
    const selectedRows = [];
    document.querySelectorAll('#academicTrackingTableBody input[type="checkbox"]:checked').forEach(cb => {
      const row = allRows.find(r => r._key === cb.dataset.key);
      if (row) selectedRows.push(row);
    });

    if (!selectedRows.length) {
      await showModal({ icon: 'info', title: 'Sin selección', html: 'Selecciona al menos un estudiante para enviar correos.' });
      return;
    }

    const byId = new Map();
    selectedRows.forEach(r => {
      if (!byId.has(r.Identificación)) {
        byId.set(r.Identificación, { ...r, "[Vez] Materia (Docente)": new Set() });
      }
      byId.get(r.Identificación)["[Vez] Materia (Docente)"].add(r["[Vez] Materia (Docente)"]);
    });

    const payload = Array.from(byId.values()).map(s => ({ ...s, enviar: true, "[Vez] Materia (Docente)": Array.from(s["[Vez] Materia (Docente)"]).filter(Boolean) }));
    const docentesExcel = await loadDocentesDetalle();
    const expectedMissing = computeMissingDocentes(payload, docentesExcel);
    const expectedNoEmail = computeNoEmailDocentesMessages(payload, docentesExcel);

    showLoading('Enviando correos...');
    try {
      const result = await enviarCorreos(payload, docentesExcel);
      hideLoading();
      await showModal({ icon: 'success', title: 'Correos enviados correctamente', html: '', timer: 1400 });

      const missingDocentes = result?.missingDocentes?.length ? result.missingDocentes : expectedMissing;
      const noEmailMessages = result?.noEmailMessages?.length ? result.noEmailMessages : expectedNoEmail;

      if (missingDocentes.length) {
        await showModal({ icon: 'warning', title: 'Los siguientes docentes no figuran en Detalle Docente:', html: `<ul style="text-align:left;margin:0;padding-left:18px">${missingDocentes.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` });
      }

      if (noEmailMessages.length) {
        await showModal({ icon: 'warning', title: 'Correos no enviados por falta de email en REPORTE_DETALLADO_DOCENTES:', html: `<ul style="text-align:left;margin:0;padding-left:18px">${noEmailMessages.map(msg => `<li>${escapeHtml(msg)}</li>`).join('')}</ul>` });
      }
    } catch (err) {
      hideLoading();
      await showModal({ icon: 'error', title: 'Error al enviar correos', html: `<pre style="white-space:pre-wrap;margin:0">${escapeHtml(err?.message || String(err))}</pre>` });
    }
  });

  elements.backBtn?.addEventListener('click', () => window.location.href = '../index.html');
});