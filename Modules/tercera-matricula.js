// tercera-matricula.js
import { loadData } from '../indexeddb-storage.js';
import { enviarCorreos } from './emailModule.js';

/* Utils básicos */
const norm = (s) => (s ?? '').toString().trim();
const asNum = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const canon = (s) => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const escapeHtml = (s = '') => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

const KEY_POR_SEMESTRE = 'academicTrackingData_REPORTE_POR_SEMESTRE';
const KEY_PARCIAL_TOTAL = 'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx';

function getPeriodoAnterior(periodo) {
  const match = String(periodo).match(/(\d{4})\s*-\s*(\d{4})\s+(CI{1,2})/);
  if (!match) return null;
  const [, y1, y2, ciclo] = match;
  return (ciclo === 'CII') ? `${y1} - ${y2} CI` : `${+y1 - 1} - ${+y2 - 1} CII`;
}

const docenteFrom = (raw) => { const parts = norm(raw).split(' - '); return parts.length === 2 ? norm(parts[1]) : norm(raw); };
const buildKey = (id, materia, periodo) => `${id}||${materia}||${periodo}`;

/* UI helpers */
const showLoading = (title = 'Enviando correos...') => {
  if (window.Swal) Swal.fire({ title, html: 'Esto puede tardar unos segundos.', allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() });
  else createLoadingOverlay(title);
};
const hideLoading = () => { if (window.Swal && Swal.isVisible()) Swal.close(); else removeLoadingOverlay(); };
const showModal = ({ icon = 'info', title = '', html = '', timer = null }) => {
  return window.Swal ? Swal.fire({ icon, title, html, timer, showConfirmButton: !timer }) : (alert(stripHtml(`${title}\n\n${html}`)), Promise.resolve());
};
const stripHtml = (s = '') => { const tmp = document.createElement('div'); tmp.innerHTML = s; return tmp.textContent || tmp.innerText || ''; };

function createLoadingOverlay(text) {
  if (document.getElementById('email-loading-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'email-loading-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial';
  overlay.innerHTML = `<div style="padding:18px 22px;background:rgba(0,0,0,.65);border-radius:10px;text-align:center;min-width:260px"><div class="spinner" style="width:36px;height:36px;border:4px solid #fff;border-top-color:transparent;border-radius:50%;margin:0 auto 12px;animation:spin 1s linear infinite"></div><div>${escapeHtml(text)}</div></div>`;
  const style = document.createElement('style'); style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
  overlay.appendChild(style); document.body.appendChild(overlay);
}
const removeLoadingOverlay = () => { const el = document.getElementById('email-loading-overlay'); if (el) el.remove(); };

/* Carga de docentes */
async function loadDocentesDetalle() {
  for (const k of ['academicTrackingData_REPORTE_DETALLADO_DOCENTES_xlsx', 'REPORTE_DETALLADO_DOCENTES', 'academicTrackingData_REPORTE_DETALLADO_DOCENTES']) {
    const data = await loadData(k);
    if (Array.isArray(data) && data.length) return data;
  }
  console.warn('⚠️ No se encontró REPORTE_DETALLADO_DOCENTES en IndexedDB');
  return [];
}

/* Detección de docentes */
function buildDocentesExcelSet(docentesExcel) {
  const set = new Set();
  for (const r of docentesExcel || []) {
    const nombres = norm(r.NOMBRES), apellidos = norm(r.APELLIDOS), docente = norm(r.DOCENTE || r["Nombre Docente"] || r.NOMBRE);
    [nombres, apellidos, docente, apellidos && nombres ? `${apellidos} ${nombres}` : '', nombres && apellidos ? `${nombres} ${apellidos}` : '']
      .forEach(c => c && set.add(canon(c)));
  }
  return set;
}

function extractDocentesFromSelected(students) {
  const docentes = new Set();
  for (const s of students || []) {
    const arr = Array.isArray(s["[Vez] Materia (Docente)"]) ? s["[Vez] Materia (Docente)"] : [s["[Vez] Materia (Docente)"]];
    arr.forEach(m => { const nombre = String(m).match(/\(([^)]+)\)/)?.[1]?.split(':')[0]?.trim(); if (nombre) docentes.add(nombre); });
  }
  return Array.from(docentes);
}

const computeMissingDocentes = (selected, docentesExcel) => {
  const excelSet = buildDocentesExcelSet(docentesExcel);
  return extractDocentesFromSelected(selected).filter(n => !excelSet.has(canon(n))).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
};

const getDocenteIdFromRow = (r) => ["IDENTIFICACION","IDENTIFICACIÓN","CI","CEDULA","CÉDULA","DOCUMENTO","Documento"].map(k => norm(r[k])).find(Boolean) || '';
const getEmailFromRow = (r) => ["CORREO_SIUG","CORREO INSTITUCIONAL","CORREO","EMAIL","MAIL","E-MAIL"].map(k => norm(r[k])).find(Boolean) || '';
const rowNameCandidates = (r) => {
  const nombres = norm(r.NOMBRES), apellidos = norm(r.APELLIDOS), docente = norm(r.DOCENTE || r["Nombre Docente"] || r.NOMBRE);
  return [docente, apellidos && nombres ? `${apellidos} ${nombres}` : '', nombres && apellidos ? `${nombres} ${apellidos}` : '', nombres, apellidos].filter(Boolean);
};
const rowsMatchNombre = (rows, docenteName) => { const target = canon(docenteName); return rows.filter(r => rowNameCandidates(r).some(c => canon(c) === target)); };

function computeNoEmailDocentesMessages(selected, docentesExcel) {
  const messages = new Set();
  extractDocentesFromSelected(selected).forEach(nombre => {
    const matches = rowsMatchNombre(docentesExcel, nombre);
    if (matches.length && !matches.some(getEmailFromRow)) {
      const id = matches.map(getDocenteIdFromRow).find(Boolean);
      messages.add(id ? `Sin correo para docente con IDENTIFICACION "${id}" en REPORTE_DETALLADO_DOCENTES` : `Sin correo para docente "${nombre}" en REPORTE_DETALLADO_DOCENTES`);
    }
  });
  return Array.from(messages).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

/* Construcción de filas */
async function buildRows(periodoSeleccionado = null, carreraSeleccionada = null) {
  const [semestre, calificaciones] = await Promise.all([loadData(KEY_POR_SEMESTRE), loadData(KEY_PARCIAL_TOTAL)]);
  if (!Array.isArray(calificaciones)) return { rows: [], periodos: [], carreras: [] };

  const periodosUnicos = [...new Set(calificaciones.map(r => norm(r.PERIODO)).filter(Boolean))].sort((a,b) => String(b).localeCompare(String(a)));
  let periodoActual = periodoSeleccionado || localStorage.getItem('selectedPeriodTM') || periodosUnicos[0];
  if (!periodosUnicos.includes(periodoActual)) periodoActual = periodosUnicos[0];

  const carrerasUnicas = ['Todas', ...new Set(calificaciones.filter(r => norm(r.PERIODO) === periodoActual).map(r => norm(r.CARRERA)).filter(Boolean))].sort((a,b) => a === 'Todas' ? -1 : b === 'Todas' ? 1 : a.localeCompare(b,'es',{sensitivity:'base'}));
  let carreraActual = carreraSeleccionada || localStorage.getItem('selectedCareerTM') || 'Todas';
  if (!carrerasUnicas.includes(carreraActual)) carreraActual = 'Todas';

  const periodoAnterior = getPeriodoAnterior(periodoActual);
  if (!periodoAnterior) return { rows: [], periodos: periodosUnicos, carreras: carrerasUnicas };

  localStorage.setItem('selectedPeriodTM', periodoActual);
  localStorage.setItem('selectedCareerTM', carreraActual);

  const anteriores = new Map(), actuales = new Set();

  calificaciones.forEach(row => {
    const id = norm(row.IDENTIFICACION), materia = norm(row.MATERIA), periodo = norm(row.PERIODO), carrera = norm(row.CARRERA);
    const noVez = asNum(row["NO. VEZ"]), promedio = asNum(row.PROMEDIO);
    if (!id || !materia || !periodo || noVez === null || (carreraActual !== 'Todas' && carrera !== carreraActual)) return;

    const key = buildKey(id, materia, periodo);
    if (periodo === periodoAnterior && noVez === 2 && promedio < 7) anteriores.set(key, row);
    if (periodo === periodoActual && noVez === 3) actuales.add(key);
  });

  const resultado = [];
  anteriores.forEach((row, key) => {
    const currentKey = buildKey(norm(row.IDENTIFICACION), norm(row.MATERIA), periodoActual);
    if (!actuales.has(currentKey)) {
      const id = norm(row.IDENTIFICACION), nombre = `${norm(row.APELLIDOS)} ${norm(row.NOMBRES)}`.trim();
      const correo = [norm(row.CORREO_INSTITUCIONAL), norm(row.CORREO_PERSONAL)].filter(Boolean).join('; ');
      const nivel = norm(row.NIVEL), materia = norm(row.MATERIA), docente = docenteFrom(row.DOCENTE);
      resultado.push({ _key: key, Identificacion: id, Estudiante: nombre, Correo: correo, Nivel: nivel, Materia: materia, Docente: docente, Carrera: norm(row.CARRERA), '[Vez] Materia (Docente)': `[2] ${materia} (${docente})` });
    }
  });

  return { rows: resultado.sort((a, b) => a.Estudiante.localeCompare(b.Estudiante, 'es', { sensitivity: 'base' })), periodos: periodosUnicos, carreras: carrerasUnicas };
}

/* Render */
function renderTable(rows) {
  const tbody = document.getElementById('academicTrackingTableBody');
  const totalSpan = document.getElementById('total-students');
  const totalStu = document.getElementById('total-materia');
  if (!tbody) return;

  tbody.innerHTML = '';
  const uniqueStudents = new Set();

  rows.forEach(r => {
    const tr = document.createElement('tr');
    [r.Identificacion, r.Estudiante, r.Correo, r.Nivel, r.Materia].forEach(val => tr.insertCell().textContent = val);
    const cbCell = tr.insertCell();
    const cb = document.createElement('input');
    Object.assign(cb, { type: 'checkbox', checked: true }); cb.dataset.key = r._key;
    cbCell.appendChild(cb); tbody.appendChild(tr);
    uniqueStudents.add(r.Identificacion);
  });

  if (totalSpan) totalSpan.textContent = `Total de Registros: ${rows.length}`;
  if (totalStu) totalStu.textContent = `Total de Estudiantes: ${uniqueStudents.size}`;
}

const populateSelects = (periodos, carreras, periodoActual, carreraActual) => {
  const periodSelect = document.getElementById('period-select');
  const careerSelect = document.getElementById('carrer-select');
  if (periodSelect) periodSelect.innerHTML = periodos.map(p => `<option value="${escapeHtml(p)}" ${p === periodoActual ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('');
  if (careerSelect) careerSelect.innerHTML = carreras.map(c => `<option value="${escapeHtml(c)}" ${c === carreraActual ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
};

/* Main */
document.addEventListener('DOMContentLoaded', async () => {
  const [filterInput, backBtn, sendBtn, periodSelect, careerSelect] = ['filterAcademicInput', 'goToMenuButton', 'sendAcademicEmails', 'period-select', 'carrer-select'].map(id => document.getElementById(id));
  let allRows = [], allPeriodos = [], allCarreras = [];

  const loadAndRender = async (periodoSeleccionado = null, carreraSeleccionada = null) => {
    const result = await buildRows(periodoSeleccionado, carreraSeleccionada);
    [allRows, allPeriodos, allCarreras] = [result.rows, result.periodos, result.carreras];
    const periodoActual = periodoSeleccionado || localStorage.getItem('selectedPeriodTM') || allPeriodos[0];
    const carreraActual = carreraSeleccionada || localStorage.getItem('selectedCareerTM') || 'Todas';
    populateSelects(allPeriodos, allCarreras, periodoActual, carreraActual);
    renderTable(allRows);
  };

  await loadAndRender();

  periodSelect?.addEventListener('change', (e) => loadAndRender(e.target.value, careerSelect?.value));
  careerSelect?.addEventListener('change', (e) => loadAndRender(periodSelect?.value, e.target.value));

  filterInput?.addEventListener('input', () => {
    const q = filterInput.value.toLowerCase();
    renderTable(allRows.filter(r => [r.Identificacion, r.Estudiante, r.Correo, r.Nivel, r.Materia, r.Docente].some(v => String(v ?? '').toLowerCase().includes(q))));
  });

  sendBtn?.addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('#academicTrackingTableBody input[type="checkbox"]:checked'))
      .map(cb => allRows.find(r => r._key === cb.dataset.key)).filter(Boolean);

    if (!selected.length) return showModal({ icon: 'info', title: 'Sin selección', html: 'Selecciona al menos un registro para enviar correos.' });

    const payload = selected.map(r => ({ ...r, enviar: true, "[Vez] Materia (Docente)": Array.isArray(r["[Vez] Materia (Docente)"]) ? r["[Vez] Materia (Docente)"].filter(Boolean) : [r["[Vez] Materia (Docente)"]].filter(Boolean) }));
    const docentesExcel = await loadDocentesDetalle();
    const [expectedMissing, expectedNoEmail] = [computeMissingDocentes(payload, docentesExcel), computeNoEmailDocentesMessages(payload, docentesExcel)];

    showLoading('Enviando correos...');

    try {
      const result = await enviarCorreos(payload, docentesExcel);
      hideLoading();
      await showModal({ icon: 'success', title: 'Correos enviados correctamente', html: '', timer: 1400 });

      const missingDocentes = Array.isArray(result?.missingDocentes) && result.missingDocentes.length ? result.missingDocentes : expectedMissing;
      const noEmailMessages = Array.isArray(result?.noEmailMessages) && result.noEmailMessages.length ? result.noEmailMessages : expectedNoEmail;

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

  backBtn?.addEventListener('click', () => window.location.href = '../index.html');
});