// nee-control.js
import { enviarCorreosNEE } from './emailModule.js';
import { loadData } from '../indexeddb-storage.js';

document.addEventListener('DOMContentLoaded', async () => {
  const tableBody      = document.getElementById('neeStudentTableBody');
  const filterInput    = document.getElementById('filterAcademicInput');
  const totalSpan      = document.getElementById('studentCount');
  const sendEmailsBtn  = document.getElementById('sendEmailsBtn');
  const goToMenuButton = document.getElementById('goToMenuButton');
  const periodLabel    = document.getElementById("current-period-label");

  // SELECTS
  const periodSelect   = document.getElementById('period-select');
  const careerSelect   = document.getElementById('carrer-select');

  let allStudentsData = [];
  let currentPeriodo = '';
  let currentCarrera = '';
  let allPeriodos = [];
  let allCarreras = [];

  /* ===========================
   * Helpers UI
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
    }
  }
  function hideLoading() {
    if (window.Swal && Swal.isVisible()) Swal.close();
  }
  function showModal({ icon = 'info', title = '', html = '', timer = null }) {
    if (window.Swal) {
      return Swal.fire({ icon, title, html, timer, showConfirmButton: !timer });
    }
    return Promise.resolve();
  }
  function norm(v) { return (v ?? '').toString().trim(); }
  function escapeHtml(s = '') { 
    return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); 
  }

  /* ===========================
   * Construcción de selects CORREGIDA
   * =========================== */
  async function populateFilters() {
    // Cargar ambas fuentes de datos
    const porSemestre = (await loadData('academicTrackingData_REPORTE_POR_SEMESTRE')) || [];
    const calificaciones = (await loadData('academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx')) || [];
    
    // Combinar todas las fuentes para extraer periodos únicos
    const todasLasFuentes = [...porSemestre, ...calificaciones];
    
    // Extraer periodos únicos de TODAS las fuentes
    allPeriodos = [...new Set(todasLasFuentes.map(r => norm(r["PERIODO"])).filter(Boolean))]
      .sort((a,b) => String(b).localeCompare(String(a)));
    
    // Usar el primer periodo como default si no hay selección previa
    currentPeriodo = localStorage.getItem('selectedPeriodNEE') || allPeriodos[0] || '';
    if (!allPeriodos.includes(currentPeriodo)) currentPeriodo = allPeriodos[0] || '';
    
    // Extraer carreras únicas filtradas por el periodo seleccionado
    allCarreras = [...new Set(todasLasFuentes
      .filter(r => norm(r["PERIODO"]) === currentPeriodo)
      .map(r => norm(r["CARRERA"]))
      .filter(Boolean))]
      .sort((a,b) => a.localeCompare(b,'es',{sensitivity:'base'}));
    
    // Usar la carrera seleccionada previamente o default
    currentCarrera = localStorage.getItem('selectedCareerNEE') || '';
    if (currentCarrera && !allCarreras.includes(currentCarrera)) currentCarrera = '';

    // Poblar select de periodos
    if (periodSelect) {
      periodSelect.innerHTML = allPeriodos.map(p => 
        `<option value="${escapeHtml(p)}" ${p === currentPeriodo ? 'selected' : ''}>${escapeHtml(p)}</option>`
      ).join('');
    }

    // Poblar select de carreras
    if (careerSelect) {
      const carrerasConTodas = ['', ...allCarreras]; // '' representa "Todas"
      careerSelect.innerHTML = carrerasConTodas.map(c => 
        `<option value="${escapeHtml(c)}" ${c === currentCarrera ? 'selected' : ''}>${c ? escapeHtml(c) : 'Todas'}</option>`
      ).join('');
    }

    // Actualizar etiqueta de periodo actual
    if (periodLabel) {
      periodLabel.textContent = `📅 Periodo actual: ${currentPeriodo}`;
    }

    // Guardar selecciones en localStorage
    localStorage.setItem('selectedPeriodNEE', currentPeriodo);
    localStorage.setItem('selectedCareerNEE', currentCarrera);
  }

  /* ===========================
   * Render de tabla
   * =========================== */
  function renderTable(students) {
    tableBody.innerHTML = '';
    students.forEach(student => {
      const row = document.createElement('tr');

      row.insertCell().textContent = student.Identificación;
      row.insertCell().textContent = student.Estudiante;
      row.insertCell().textContent = student.Correo;
      row.insertCell().textContent = student.NEE;
      row.insertCell().textContent = student.Nivel || '';

      const vezCell = row.insertCell();
      const ul = document.createElement('ul');
      (student["[Vez] Materia (Docente)"] || []).forEach(m => {
        const li = document.createElement('li');
        li.textContent = m;
        ul.appendChild(li);
      });
      vezCell.appendChild(ul);

      const riesgoCell = row.insertCell();
      const bar = document.createElement('div');
      bar.className = 'riesgo-bar';
      let riesgoTotal = 0;
      (student["[Vez] Materia (Docente)"] || []).forEach(m => {
        const match = String(m).match(/^\[(\d+)\]/);
        const vez = match ? parseInt(match[1], 10) : 1;
        if (vez === 1) riesgoTotal += 1;
        else if (vez === 2) riesgoTotal += 4;
        else if (vez >= 3) riesgoTotal += 6;
      });
      const intensidad = Math.min(riesgoTotal * 10, 100);
      bar.style.width = `${intensidad}%`;
      bar.style.backgroundColor = `hsl(${120 - intensidad}, 100%, 40%)`;
      bar.style.borderRadius = '6px';
      riesgoCell.appendChild(bar);

      const enviarCell = row.insertCell();
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.dataset.studentId = student.Identificación;
      enviarCell.appendChild(checkbox);

      tableBody.appendChild(row);
    });
    if (totalSpan) totalSpan.textContent = students.length;
  }

  /* ===========================
   * Carga y merge de datos
   * =========================== */
  async function loadAndMergeData() {
    const porSemestre    = (await loadData('academicTrackingData_REPORTE_POR_SEMESTRE')) || [];
    const calificaciones = (await loadData('academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx')) || [];
    const legalizados    = (await loadData('academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx')) || [];

    // Construcción de NEE
    const mapNEE = new Map();
    const eligibleIDs = new Set();
    for (const est of legalizados) {
      const id = norm(est["IDENTIFICACION"]);
      if (!id) continue;
      const discapacidad = norm(est["DISCAPACIDAD"]);
      const porcentaje   = norm(est["PORCENTAJE DISCAPACIDAD"]);
      if (!discapacidad || !porcentaje) continue;
      const nivelLeg = norm(est["NIVEL"]);
      const neeText  = `${discapacidad} (${porcentaje}%)`;
      mapNEE.set(id, { NEE: neeText, NivelLegalizados: nivelLeg });
      eligibleIDs.add(id);
    }

    // Base de estudiantes
    const baseStudents = new Map();
    for (const r of porSemestre) {
      if (currentPeriodo && norm(r["PERIODO"]) !== currentPeriodo) continue;
      if (currentCarrera && norm(r["CARRERA"]) !== currentCarrera) continue;

      const id = norm(r["IDENTIFICACION"]);
      if (!id || !eligibleIDs.has(id)) continue;

      const apellidos  = norm(r["APELLIDOS"]);
      const nombres    = norm(r["NOMBRES"]);
      const estudiante = `${apellidos} ${nombres}`.replace(/\s+/g, ' ').trim();

      const correoInst = norm(r["CORREO_INSTITUCIONAL"]);
      const correoPers = norm(r["CORREO_PERSONAL"]);
      const correos    = [correoInst, correoPers].filter(Boolean).join('; ');

      let nivel = norm(r["NIVEL"]) || mapNEE.get(id)?.NivelLegalizados || '';
      const NEE = mapNEE.get(id)?.NEE;

      if (!baseStudents.has(id)) {
        baseStudents.set(id, {
          Identificación: id,
          Estudiante: estudiante,
          Correo: correos,
          NEE,
          Nivel: nivel,
          "[Vez] Materia (Docente)": new Set(),
        });
      }

      const vez      = norm(r["NO. VEZ"]) || '?';
      const materia  = norm(r["MATERIA"]);
      const docente  = norm(r["DOCENTE"]);
      const paralelo = norm(r["GRUPO/PARALELO"]);
      if (materia || docente) {
        baseStudents.get(id)["[Vez] Materia (Docente)"]
          .add(`[${vez}] ${materia} (${docente}: ${paralelo})`);
      }
    }

    // Enriquecer con calificaciones
    for (const n of calificaciones) {
      if (currentPeriodo && norm(n["PERIODO"]) !== currentPeriodo) continue;
      if (currentCarrera && norm(n["CARRERA"]) !== currentCarrera) continue;

      const id = norm(n["IDENTIFICACION"]);
      if (!id || !baseStudents.has(id)) continue;

      const vez      = norm(n["NO. VEZ"]) || '?';
      const materia  = norm(n["MATERIA"]);
      const docente  = norm(n["DOCENTE"]);
      const paralelo = norm(n["GRUPO/PARALELO"]);
      if (materia || docente) {
        baseStudents.get(id)["[Vez] Materia (Docente)"]
          .add(`[${vez}] ${materia} (${docente}: ${paralelo})`);
      }
    }

    allStudentsData = Array.from(baseStudents.values())
      .map(s => ({
        ...s,
        "[Vez] Materia (Docente)": Array.from(s["[Vez] Materia (Docente)"]).filter(Boolean),
      }))
      .filter(s => s["[Vez] Materia (Docente)"].length > 0)
      .sort((a, b) => a.Estudiante.localeCompare(b.Estudiante, 'es', { sensitivity: 'base' }));

    renderTable(allStudentsData);
  }

  /* ===========================
   * Función para recargar filtros y datos
   * =========================== */
  async function reloadFiltersAndData() {
    await populateFilters(); // Esto actualiza currentPeriodo y currentCarrera
    await loadAndMergeData(); // Esto carga los datos con los filtros actuales
  }

  /* ===========================
   * Inicialización
   * =========================== */
  await reloadFiltersAndData();

  /* ===========================
   * Eventos de cambio de filtros
   * =========================== */
  periodSelect?.addEventListener('change', async () => {
    currentPeriodo = periodSelect.value;
    localStorage.setItem('selectedPeriodNEE', currentPeriodo);
    
    // Actualizar etiqueta de periodo
    if (periodLabel) {
      periodLabel.textContent = `📅 Periodo actual: ${currentPeriodo}`;
    }
    
    // Recargar carreras para el nuevo periodo y datos
    await reloadFiltersAndData();
  });

  careerSelect?.addEventListener('change', async () => {
    currentCarrera = careerSelect.value;
    localStorage.setItem('selectedCareerNEE', currentCarrera);
    await loadAndMergeData();
  });

  /* ===========================
   * Filtro por texto
   * =========================== */
  filterInput?.addEventListener('input', () => {
    const q = filterInput.value.toLowerCase();
    const filtered = allStudentsData.filter(s => {
      const simpleMatch = [
        s.Identificación, s.Estudiante, s.Correo, s.NEE, s.Nivel
      ].some(v => String(v ?? '').toLowerCase().includes(q));
      const listMatch = (s["[Vez] Materia (Docente)"] || []).some(item =>
        String(item).toLowerCase().includes(q)
      );
      return simpleMatch || listMatch;
    });
    renderTable(filtered);
  });

  /* ===========================
   * Envío de correos
   * =========================== */
  sendEmailsBtn?.addEventListener('click', async () => {
    const selected = [];
    document.querySelectorAll('#neeStudentTableBody input[type="checkbox"]:checked')
      .forEach(cb => {
        const id = cb.dataset.studentId;
        const student = allStudentsData.find(s => s.Identificación === id);
        if (student) selected.push(student);
      });

    if (!selected.length) {
      await showModal({ icon: 'info', title: 'Sin selección', html: 'Selecciona al menos un estudiante.' });
      return;
    }

    showLoading('Enviando correos...');
    try {
      await enviarCorreosNEE(selected, []);
      hideLoading();
      await showModal({ icon: 'success', title: 'Correos enviados correctamente', timer: 1500 });
    } catch (err) {
      hideLoading();
      await showModal({ icon: 'error', title: 'Error', html: String(err) });
    }
  });

  /* ===========================
   * Volver al menú
   * =========================== */
  goToMenuButton?.addEventListener('click', () => {
    window.location.href = '../index.html';
  });
});