// nee-control.js
import { enviarCorreosNEE } from './emailModule.js';
import { loadData } from '../indexeddb-storage.js';

document.addEventListener('DOMContentLoaded', async () => {
  const [tableBody, filterInput, totalSpan, sendEmailsBtn, goToMenuButton, periodSelect, careerSelect] = 
    ['neeStudentTableBody', 'filterAcademicInput', 'studentCount', 'sendEmailsBtn', 'goToMenuButton', 'period-select', 'carrer-select']
    .map(id => document.getElementById(id));

  let [allStudentsData, currentPeriodo, currentCarrera, allPeriodos, allCarreras] = [[], '', '', [], []];

  /* Helpers UI */
  const showLoading = (title = 'Enviando correos...') => window.Swal && Swal.fire({ title, html: 'Esto puede tardar unos segundos.', allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() });
  const hideLoading = () => window.Swal && Swal.isVisible() && Swal.close();
  const showModal = ({ icon = 'info', title = '', html = '', timer = null }) => window.Swal ? Swal.fire({ icon, title, html, timer, showConfirmButton: !timer }) : Promise.resolve();
  const norm = (v) => (v ?? '').toString().trim();
  const escapeHtml = (s = '') => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  /* Filtros */
  async function populateFilters() {
    const [porSemestre, calificaciones] = await Promise.all([
      loadData('academicTrackingData_REPORTE_POR_SEMESTRE'),
      loadData('academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx')
    ]);
    
    const todasLasFuentes = [...(porSemestre || []), ...(calificaciones || [])];
    allPeriodos = [...new Set(todasLasFuentes.map(r => norm(r.PERIODO)).filter(Boolean))].sort((a,b) => String(b).localeCompare(String(a)));
    
    currentPeriodo = localStorage.getItem('selectedPeriodNEE') || allPeriodos[0] || '';
    if (!allPeriodos.includes(currentPeriodo)) currentPeriodo = allPeriodos[0] || '';
    
    allCarreras = [...new Set(todasLasFuentes.filter(r => norm(r.PERIODO) === currentPeriodo).map(r => norm(r.CARRERA)).filter(Boolean))]
      .sort((a,b) => a.localeCompare(b,'es',{sensitivity:'base'}));
    
    currentCarrera = localStorage.getItem('selectedCareerNEE') || '';
    if (currentCarrera && !allCarreras.includes(currentCarrera)) currentCarrera = '';

    if (periodSelect) periodSelect.innerHTML = allPeriodos.map(p => `<option value="${escapeHtml(p)}" ${p === currentPeriodo ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('');
    if (careerSelect) {
      const carrerasConTodas = ['', ...allCarreras];
      careerSelect.innerHTML = carrerasConTodas.map(c => `<option value="${escapeHtml(c)}" ${c === currentCarrera ? 'selected' : ''}>${c ? escapeHtml(c) : 'Todas'}</option>`).join('');
    }

    localStorage.setItem('selectedPeriodNEE', currentPeriodo);
    localStorage.setItem('selectedCareerNEE', currentCarrera);
  }

  /* Render */
  function renderTable(students) {
    tableBody.innerHTML = '';
    const counts = { 1:0, 2:0, 3:0, 4:0, 5:0 };

    students.forEach(student => {
      const row = document.createElement('tr');
      [student.Identificación, student.Estudiante, student.Correo, student.NEE, student.Nivel || ''].forEach(val => row.insertCell().textContent = val);

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
        riesgoTotal += (vez === 1) ? 1 : (vez === 2) ? 4 : 6;
      });  

      const intensidad = Math.min(riesgoTotal * 10, 100);
      Object.assign(bar.style, { width: `${intensidad}%`, backgroundColor: `hsl(${120 - intensidad}, 100%, 40%)`, borderRadius: '6px' });
      riesgoCell.appendChild(bar);

      if (riesgoTotal >= 12) counts[5]++;  
      else if (riesgoTotal >= 9) counts[4]++;  
      else if (riesgoTotal >= 6) counts[3]++;  
      else if (riesgoTotal >= 3) counts[2]++;  
      else counts[1]++;

      const enviarCell = row.insertCell();
      const checkbox = document.createElement('input');
      Object.assign(checkbox, { type: 'checkbox', checked: true });
      checkbox.dataset.studentId = student.Identificación;
      enviarCell.appendChild(checkbox);
      tableBody.appendChild(row);
    });

    if (totalSpan) totalSpan.textContent = `Total Estudiantes: ${students.length}`;
    ['stat-riesgo-5', 'stat-riesgo-4', 'stat-riesgo-3', 'stat-riesgo-2', 'stat-riesgo-1'].forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.textContent = [`Riesgo Muy Alto (5+): ${counts[5]}`, `Riesgo Alto (4): ${counts[4]}`, `Riesgo Medio (3): ${counts[3]}`, `Riesgo Bajo (2): ${counts[2]}`, `Sin Riesgo (1): ${counts[1]}`][i];
    });
  }

  /* Carga y merge */
  async function loadAndMergeData() {
    const [porSemestre, calificaciones, legalizados] = await Promise.all([
      loadData('academicTrackingData_REPORTE_POR_SEMESTRE'),
      loadData('academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx'),
      loadData('academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx')
    ]);

    // NEE mapping
    const mapNEE = new Map(), eligibleIDs = new Set();
    (legalizados || []).forEach(est => {
      const id = norm(est.IDENTIFICACION), discapacidad = norm(est.DISCAPACIDAD), porcentaje = norm(est["PORCENTAJE DISCAPACIDAD"]);
      if (id && discapacidad && porcentaje) {
        mapNEE.set(id, { NEE: `${discapacidad} (${porcentaje}%)`, NivelLegalizados: norm(est.NIVEL) });
        eligibleIDs.add(id);
      }
    });

    // Base students
    const baseStudents = new Map();
    (calificaciones || []).forEach(r => {
      if ((currentPeriodo && norm(r.PERIODO) !== currentPeriodo) || (currentCarrera && norm(r.CARRERA) !== currentCarrera)) return;
      
      const id = norm(r.IDENTIFICACION);
      if (!id || !eligibleIDs.has(id)) return;

      const apellidos = norm(r.APELLIDOS), nombres = norm(r.NOMBRES);
      const estudiante = `${apellidos} ${nombres}`.replace(/\s+/g, ' ').trim();
      const correos = [norm(r.CORREO_INSTITUCIONAL), norm(r.CORREO_PERSONAL)].filter(Boolean).join('; ');
      const nivel = norm(r.NIVEL) || mapNEE.get(id)?.NivelLegalizados || '';

      if (!baseStudents.has(id)) {
        baseStudents.set(id, {
          Identificación: id,
          Estudiante: estudiante,
          Correo: correos,
          NEE: mapNEE.get(id)?.NEE,
          Nivel: nivel,
          "[Vez] Materia (Docente)": new Set(),
        });
      }

      const vez = norm(r["NO. VEZ"]) || '?', materia = norm(r.MATERIA), docente = norm(r.DOCENTE), paralelo = norm(r["GRUPO/PARALELO"]);
      if (materia || docente) baseStudents.get(id)["[Vez] Materia (Docente)"].add(`[${vez}] ${materia} (${docente}: ${paralelo})`);
    });

    allStudentsData = Array.from(baseStudents.values())
      .map(s => ({ ...s, "[Vez] Materia (Docente)": Array.from(s["[Vez] Materia (Docente)"]).filter(Boolean) }))
      .filter(s => s["[Vez] Materia (Docente)"].length > 0)
      .sort((a, b) => a.Estudiante.localeCompare(b.Estudiante, 'es', { sensitivity: 'base' }));

    renderTable(allStudentsData);
  }

  const reloadFiltersAndData = async () => { await populateFilters(); await loadAndMergeData(); };

  /* Inicialización */
  await reloadFiltersAndData();

  /* Eventos */
  periodSelect?.addEventListener('change', async () => {
    currentPeriodo = periodSelect.value;
    localStorage.setItem('selectedPeriodNEE', currentPeriodo);
    await reloadFiltersAndData();
  });

  careerSelect?.addEventListener('change', async () => {
    currentCarrera = careerSelect.value;
    localStorage.setItem('selectedCareerNEE', currentCarrera);
    await loadAndMergeData();
  });

  filterInput?.addEventListener('input', () => {
    const q = filterInput.value.toLowerCase();
    const filtered = allStudentsData.filter(s => {
      const simpleMatch = [s.Identificación, s.Estudiante, s.Correo, s.NEE, s.Nivel].some(v => String(v ?? '').toLowerCase().includes(q));
      const listMatch = (s["[Vez] Materia (Docente)"] || []).some(item => String(item).toLowerCase().includes(q));
      return simpleMatch || listMatch;
    });
    renderTable(filtered);
  });

  sendEmailsBtn?.addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('#neeStudentTableBody input[type="checkbox"]:checked'))
      .map(cb => allStudentsData.find(s => s.Identificación === cb.dataset.studentId))
      .filter(Boolean);

    if (!selected.length) return showModal({ icon: 'info', title: 'Sin selección', html: 'Selecciona al menos un estudiante.' });

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

  goToMenuButton?.addEventListener('click', () => window.location.href = '../index.html');
});