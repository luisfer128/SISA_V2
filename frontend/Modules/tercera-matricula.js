// tercera-matricula.js
import { loadData } from '../indexeddb-storage.js';
import { enviarCorreos } from './emailModule.js';

/* ===========================
 * Utils básicos
 * =========================== */
const norm = (s) => (s ?? '').toString().trim();
const asNum = (v) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const canon = (s) =>
  norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const KEY_POR_SEMESTRE  = 'academicTrackingData_REPORTE_POR_SEMESTRE';
const KEY_PARCIAL_TOTAL = 'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx';

function getPeriodoAnterior(periodo) {
  const match = String(periodo).match(/(\d{4})\s*-\s*(\d{4})\s+(CI{1,2})/);
  if (!match) return null;
  const y1 = parseInt(match[1]);
  const y2 = parseInt(match[2]);
  const ciclo = match[3];
  return (ciclo === 'CII') ? `${y1} - ${y2} CI` : `${y1 - 1} - ${y2 - 1} CII`;
}

function docenteFrom(raw) {
  const d = norm(raw);
  const parts = d.split(' - ');
  return parts.length === 2 ? norm(parts[1]) : d;
}

function buildKey(id, materia, periodo) {
  return `${id}||${materia}||${periodo}`;
}

// Helpers para HTML
function escapeHtml(s = '') {
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

/* ===========================
 * UI helpers (SweetAlert2 + fallback)
 * =========================== */
function showLoading(title = 'Enviando correos...') {
  if (window.Swal) {
    Swal.fire({
      title,
      html: 'Esto puede tardar unos segundos.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => { Swal.showLoading(); }
    });
  } else {
    createLoadingOverlay(title);
  }
}
function hideLoading() {
  if (window.Swal && Swal.isVisible()) Swal.close();
  else removeLoadingOverlay();
}
function showModal({ icon = 'info', title = '', html = '', timer = null }) {
  if (window.Swal) {
    return Swal.fire({ icon, title, html, timer, showConfirmButton: !timer });
  } else {
    alert(stripHtml(`${title}\n\n${html}`));
    return Promise.resolve();
  }
}
function stripHtml(s = '') {
  const tmp = document.createElement('div'); tmp.innerHTML = s;
  return tmp.textContent || tmp.innerText || '';
}

// Fallback overlay si no hay SweetAlert2
function createLoadingOverlay(text) {
  if (document.getElementById('email-loading-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'email-loading-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,.45);
    display: flex; align-items: center; justify-content: center;
    z-index: 99999; color: #fff; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
  `;
  overlay.innerHTML = `
    <div style="padding: 18px 22px; background: rgba(0,0,0,.65); border-radius: 10px; text-align:center; min-width: 260px">
      <div class="spinner" style="width:36px;height:36px;border:4px solid #fff;border-top-color:transparent;border-radius:50%;margin:0 auto 12px;animation:spin 1s linear infinite"></div>
      <div>${escapeHtml(text)}</div>
    </div>
  `;
  const style = document.createElement('style'); style.textContent = `@keyframes spin{to{transform:rotate(360deg)}}`;
  overlay.appendChild(style);
  document.body.appendChild(overlay);
}
function removeLoadingOverlay() {
  const el = document.getElementById('email-loading-overlay'); if (el) el.remove();
}

/* ===========================
 * Carga de docentes (detalle)
 * =========================== */
async function loadDocentesDetalle() {
  const keys = [
    'academicTrackingData_REPORTE_DETALLADO_DOCENTES_xlsx',
    'REPORTE_DETALLADO_DOCENTES',
    'academicTrackingData_REPORTE_DETALLADO_DOCENTES',
  ];
  for (const k of keys) {
    const data = await loadData(k);
    if (Array.isArray(data) && data.length) return data;
  }
  console.warn('⚠️ No se encontró REPORTE_DETALLADO_DOCENTES en IndexedDB');
  return [];
}

/* ===========================
 * Detección de docentes faltantes / sin correo
 * =========================== */
function buildDocentesExcelSet(docentesExcel) {
  const set = new Set();
  for (const r of docentesExcel || []) {
    const nombres   = norm(r["NOMBRES"]);
    const apellidos = norm(r["APELLIDOS"]);
    const docente   = norm(r["DOCENTE"]) || norm(r["Nombre Docente"]) || norm(r["NOMBRE"]);
    const combos = new Set([
      nombres,
      apellidos,
      docente,
      apellidos && nombres ? `${apellidos} ${nombres}` : '',
      nombres && apellidos ? `${nombres} ${apellidos}` : ''
    ]);
    for (const c of combos) if (c) set.add(canon(c));
  }
  return set;
}

function extractDocentesFromSelected(students) {
  const docentes = new Set();
  for (const s of students || []) {
    const arr = Array.isArray(s["[Vez] Materia (Docente)"]) ? s["[Vez] Materia (Docente)"] : [s["[Vez] Materia (Docente)"]];
    for (const m of (arr || [])) {
      const inside = String(m).match(/\(([^)]+)\)/)?.[1] || '';
      const nombre = inside.split(':')[0]?.trim();
      if (nombre) docentes.add(nombre);
    }
  }
  return Array.from(docentes);
}

function computeMissingDocentes(selected, docentesExcel) {
  const excelSet = buildDocentesExcelSet(docentesExcel);
  const docentesEnviados = extractDocentesFromSelected(selected);
  const missing = docentesEnviados.filter(n => !excelSet.has(canon(n)));
  return missing.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function getDocenteIdFromRow(r) {
  const idKeys = ["IDENTIFICACION","IDENTIFICACIÓN","CI","CEDULA","CÉDULA","DOCUMENTO","Documento"];
  for (const k of idKeys) { const v = norm(r[k]); if (v) return v; }
  return '';
}
function getEmailFromRow(r) {
  const emailKeys = ["CORREO_SIUG","CORREO INSTITUCIONAL","CORREO","EMAIL","MAIL","E-MAIL"];
  for (const k of emailKeys) { const v = norm(r[k]); if (v) return v; }
  return '';
}
function rowNameCandidates(r) {
  const nombres   = norm(r["NOMBRES"]);
  const apellidos = norm(r["APELLIDOS"]);
  const docente   = norm(r["DOCENTE"]) || norm(r["Nombre Docente"]) || norm(r["NOMBRE"]);
  return [docente, apellidos && nombres ? `${apellidos} ${nombres}` : '', nombres && apellidos ? `${nombres} ${apellidos}` : '', nombres, apellidos]
    .filter(Boolean);
}
function rowsMatchNombre(rows, docenteName) {
  const target = canon(docenteName);
  return rows.filter(r => rowNameCandidates(r).some(c => canon(c) === target));
}
function computeNoEmailDocentesMessages(selected, docentesExcel) {
  const docentes = extractDocentesFromSelected(selected);
  const messages = new Set();
  for (const nombre of docentes) {
    const matches = rowsMatchNombre(docentesExcel, nombre);
    if (matches.length === 0) continue;
    const hasAnyEmail = matches.some(getEmailFromRow);
    if (!hasAnyEmail) {
      let id = '';
      for (const r of matches) { id = getDocenteIdFromRow(r); if (id) break; }
      messages.add(
        id
          ? `Sin correo para docente con IDENTIFICACION "${id}" en REPORTE_DETALLADO_DOCENTES`
          : `Sin correo para docente "${nombre}" en REPORTE_DETALLADO_DOCENTES`
      );
    }
  }
  return Array.from(messages).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

/* ===========================
 * Construcción de filas CON FILTROS
 * =========================== */
async function buildRows(periodoSeleccionado = null, carreraSeleccionada = null) {
  const semestre = await loadData(KEY_POR_SEMESTRE);
  const calificaciones = await loadData(KEY_PARCIAL_TOTAL);
  if (!Array.isArray(semestre) || !Array.isArray(calificaciones)) return { rows: [], periodos: [], carreras: [] };

  // Obtener todos los periodos únicos disponibles
  const periodosUnicos = [...new Set(calificaciones.map(r => norm(r["PERIODO"])).filter(Boolean))]
    .sort((a,b) => String(b).localeCompare(String(a)));
  
  // Si no se especifica periodo, usar el más reciente
  let periodoActual = periodoSeleccionado || localStorage.getItem('selectedPeriodTM') || periodosUnicos[0];
  if (!periodosUnicos.includes(periodoActual)) periodoActual = periodosUnicos[0];

  // Obtener carreras únicas de los datos filtrados por periodo
  const carrerasUnicas = [...new Set(calificaciones
    .filter(r => norm(r["PERIODO"]) === periodoActual)
    .map(r => norm(r["CARRERA"]))
    .filter(Boolean))]
    .sort((a,b) => a.localeCompare(b,'es',{sensitivity:'base'}));
  carrerasUnicas.unshift('Todas');

  // Si no se especifica carrera, usar 'Todas'
  let carreraActual = carreraSeleccionada || localStorage.getItem('selectedCareerTM') || 'Todas';
  if (!carrerasUnicas.includes(carreraActual)) carreraActual = 'Todas';

  const periodoAnterior = getPeriodoAnterior(periodoActual);
  
  const periodLabel = document.getElementById("current-period-label");
  if (periodLabel) periodLabel.textContent = `📅 Periodo actual: ${periodoActual}`;
  
  if (!periodoAnterior) return { rows: [], periodos: periodosUnicos, carreras: carrerasUnicas };

  // Guardar selecciones en localStorage
  localStorage.setItem('selectedPeriodTM', periodoActual);
  localStorage.setItem('selectedCareerTM', carreraActual);

  const anteriores = new Map();
  const actuales = new Set();

  for (const row of calificaciones) {
    const id = norm(row["IDENTIFICACION"]);
    const materia = norm(row["MATERIA"]);
    const periodo = norm(row["PERIODO"]);
    const carrera = norm(row["CARRERA"]);
    const noVez = asNum(row["NO. VEZ"]);
    const promedio = asNum(row["PROMEDIO"]);
    if (!id || !materia || !periodo || noVez === null) continue;

    // Aplicar filtro de carrera (solo si no es "Todas")
    if (carreraActual !== 'Todas' && carrera !== carreraActual) continue;

    const key = buildKey(id, materia, periodo);

    if (periodo === periodoAnterior && noVez === 2 && promedio < 7) {
      anteriores.set(key, row);
    }
    if (periodo === periodoActual && noVez === 3) {
      actuales.add(key);
    }
  }

  const resultado = [];
  for (const [key, row] of anteriores.entries()) {
    const currentKey = buildKey(norm(row["IDENTIFICACION"]), norm(row["MATERIA"]), periodoActual);
    if (!actuales.has(currentKey)) {
      const id = norm(row["IDENTIFICACION"]);
      const nombre = `${norm(row["APELLIDOS"])} ${norm(row["NOMBRES"]).trim()}`;
      const correo = [norm(row["CORREO_INSTITUCIONAL"]), norm(row["CORREO_PERSONAL"])].filter(Boolean).join('; ');
      const nivel   = norm(row["NIVEL"]);
      const materia = norm(row["MATERIA"]);
      const docente = docenteFrom(row["DOCENTE"]);

      resultado.push({
        _key: key,
        Identificacion: id,
        Estudiante: nombre,
        Correo: correo,
        Nivel: nivel,
        Materia: materia,
        Docente: docente,
        Carrera: norm(row["CARRERA"]),
        '[Vez] Materia (Docente)': `[2] ${materia} (${docente})`
      });
    }
  }

  resultado.sort((a, b) => a.Estudiante.localeCompare(b.Estudiante, 'es', { sensitivity: 'base' }));
  return { rows: resultado, periodos: periodosUnicos, carreras: carrerasUnicas };
}

/* ===========================
 * Render de tabla
 * =========================== */
function renderTable(rows) {
  const tbody = document.getElementById('academicTrackingTableBody');
  const totalSpan = document.getElementById('total-students');
  const totalStu = document.getElementById('total-materia');
  if (!tbody) return;

  tbody.innerHTML = '';

  // Set para estudiantes únicos
  const uniqueStudents = new Set();

  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.insertCell().textContent = r.Identificacion;
    tr.insertCell().textContent = r.Estudiante;
    tr.insertCell().textContent = r.Correo;
    tr.insertCell().textContent = r.Nivel;
    tr.insertCell().textContent = r.Materia;

    const cbCell = tr.insertCell();
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.key = r._key;
    cbCell.appendChild(cb);

    tbody.appendChild(tr);

    // Agregamos al Set
    uniqueStudents.add(r.Identificacion);
  });

  if (totalSpan) totalSpan.textContent = `Total de Registros: ${rows.length}`;
  if (totalStu) totalStu.textContent = `Total de Estudiantes: ${uniqueStudents.size}`;
}

/* ===========================
 * Poblar selects de filtros
 * =========================== */
function populateSelects(periodos, carreras, periodoActual, carreraActual) {
  const periodSelect = document.getElementById('period-select');
  const careerSelect = document.getElementById('carrer-select');

  if (periodSelect) {
    periodSelect.innerHTML = periodos.map(p => 
      `<option value="${escapeHtml(p)}" ${p === periodoActual ? 'selected' : ''}>${escapeHtml(p)}</option>`
    ).join('');
  }

  if (careerSelect) {
    careerSelect.innerHTML = carreras.map(c => 
      `<option value="${escapeHtml(c)}" ${c === carreraActual ? 'selected' : ''}>${escapeHtml(c)}</option>`
    ).join('');
  }
}

/* ===========================
 * Main
 * =========================== */
document.addEventListener('DOMContentLoaded', async () => {
  const filterInput = document.getElementById('filterAcademicInput');
  const backBtn     = document.getElementById('goToMenuButton');
  const sendBtn     = document.getElementById('sendAcademicEmails');
  const periodSelect = document.getElementById('period-select');
  const careerSelect = document.getElementById('carrer-select');

  let allRows = [];
  let allPeriodos = [];
  let allCarreras = [];

  // Carga inicial
  async function loadAndRender(periodoSeleccionado = null, carreraSeleccionada = null) {
    const result = await buildRows(periodoSeleccionado, carreraSeleccionada);
    allRows = result.rows;
    allPeriodos = result.periodos;
    allCarreras = result.carreras;
    
    // Obtener periodo y carrera actuales desde localStorage o usar defaults
    const periodoActual = periodoSeleccionado || localStorage.getItem('selectedPeriodTM') || allPeriodos[0];
    const carreraActual = carreraSeleccionada || localStorage.getItem('selectedCareerTM') || 'Todas';
    
    populateSelects(allPeriodos, allCarreras, periodoActual, carreraActual);
    renderTable(allRows);
  }

  // Carga inicial
  await loadAndRender();

  // Event listener para cambio de periodo
  if (periodSelect) {
    periodSelect.addEventListener('change', async (e) => {
      await loadAndRender(e.target.value, careerSelect?.value);
    });
  }

  // Event listener para cambio de carrera
  if (careerSelect) {
    careerSelect.addEventListener('change', async (e) => {
      await loadAndRender(periodSelect?.value, e.target.value);
    });
  }

  // Filtro de búsqueda
  filterInput?.addEventListener('input', () => {
    const q = filterInput.value.toLowerCase();
    const filtered = allRows.filter(r =>
      [r.Identificacion, r.Estudiante, r.Correo, r.Nivel, r.Materia, r.Docente]
        .some(v => String(v ?? '').toLowerCase().includes(q))
    );
    renderTable(filtered);
  });

  // Envío de correos
  sendBtn?.addEventListener('click', async () => {
    // Seleccionados
    const selected = [];
    document
      .querySelectorAll('#academicTrackingTableBody input[type="checkbox"]:checked')
      .forEach(cb => {
        const key = cb.dataset.key;
        const row = allRows.find(r => r._key === key);
        if (row) selected.push(row);
      });

    if (!selected.length) {
      await showModal({ icon: 'info', title: 'Sin selección', html: 'Selecciona al menos un registro para enviar correos.' });
      return;
    }

    // Normaliza estructura esperada por emailModule
    const payload = selected.map(r => ({
      ...r,
      enviar: true,
      "[Vez] Materia (Docente)": Array.isArray(r["[Vez] Materia (Docente)"])
        ? r["[Vez] Materia (Docente)"].filter(Boolean)
        : [r["[Vez] Materia (Docente)"]].filter(Boolean)
    }));

    // Carga detalle de docentes para cruce
    const docentesExcel = await loadDocentesDetalle();

    // Cálculo local (fallback) para mostrar modales
    const expectedMissing = computeMissingDocentes(payload, docentesExcel);
    const expectedNoEmail = computeNoEmailDocentesMessages(payload, docentesExcel);

    showLoading('Enviando correos...');

    try {
      // Enviar usando tu módulo
      const result = await enviarCorreos(payload, docentesExcel);
      hideLoading();

      // Modal de éxito
      await showModal({
        icon: 'success',
        title: 'Correos enviados correctamente',
        html: '',
        timer: 1400
      });

      // Priorizar arrays del result si existen, sino usar los calculados
      const missingDocentes = Array.isArray(result?.missingDocentes) && result.missingDocentes.length
        ? result.missingDocentes
        : expectedMissing;

      const noEmailMessages = Array.isArray(result?.noEmailMessages) && result.noEmailMessages.length
        ? result.noEmailMessages
        : expectedNoEmail;

      if (missingDocentes.length) {
        const listHtml = `<ul style="text-align:left;margin:0;padding-left:18px">${missingDocentes
          .map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`;
        await showModal({
          icon: 'warning',
          title: 'Los siguientes docentes no figuran en Detalle Docente:',
          html: listHtml
        });
      }

      if (noEmailMessages.length) {
        const listHtml = `<ul style="text-align:left;margin:0;padding-left:18px">${noEmailMessages
          .map(msg => `<li>${escapeHtml(msg)}</li>`).join('')}</ul>`;
        await showModal({
          icon: 'warning',
          title: 'Correos no enviados por falta de email en REPORTE_DETALLADO_DOCENTES:',
          html: listHtml
        });
      }

    } catch (err) {
      hideLoading();
      await showModal({
        icon: 'error',
        title: 'Error al enviar correos',
        html: `<pre style="white-space:pre-wrap;margin:0">${escapeHtml(err?.message || String(err))}</pre>`
      });
    }
  });

  backBtn?.addEventListener('click', () => { window.location.href = '../index.html'; });
});