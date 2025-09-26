// seguimiento-academico.js
import { loadData } from '../indexeddb-storage.js';
import { enviarCorreos } from './emailModule.js';

document.addEventListener('DOMContentLoaded', () => {
  const [tableBody, totalStudentsSpan, filterInput, sendEmailsButton, backToMenuButton, periodSelect, careerSelect] = 
    ['academicTrackingTableBody', 'total-students', 'filterAcademicInput', 'sendAcademicEmails', 'goToMenuButton', 'period-select', 'carrer-select']
    .map(id => document.getElementById(id));

  if (!tableBody || !totalStudentsSpan || !filterInput || !sendEmailsButton || !backToMenuButton) {
    console.error("Uno o más elementos del DOM no se encontraron.");
    return;
  }

  let [allStudentsData, dataNotasGlobal, neeFilterActive] = [[], [], false];

  /* Helpers */
  const toId = (v) => String(v ?? '').replace(/\D/g, '').trim();
  const norm = (v) => (v ?? '').toString().trim();
  const getRiesgoColor = (count) => count >= 5 ? '#d93025' : count === 4 ? '#f57c00' : count === 3 ? '#fbc02d' : count === 2 ? '#7cb342' : '#4caf50';
  const sortPeriodos = (periodos) => periodos.sort((a, b) => {
    const [yearA, semA] = [a.match(/(\d{4})/)?.[1], a.match(/(\d{4})-(\d+)/)?.[2]].map(x => parseInt(x) || 0);
    const [yearB, semB] = [b.match(/(\d{4})/)?.[1], b.match(/(\d{4})-(\d+)/)?.[2]].map(x => parseInt(x) || 0);
    return yearA !== yearB ? yearB - yearA : semB - semA;
  });

  /* UI helpers */
  const showLoading = (title = 'Enviando correos...') => window.Swal ? Swal.fire({ title, html: 'Esto puede tardar unos segundos.', allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() }) : createLoadingOverlay(title);
  const hideLoading = () => window.Swal && Swal.isVisible() ? Swal.close() : removeLoadingOverlay();
  const showModal = ({ icon = 'info', title = '', html = '', timer = null }) => window.Swal ? Swal.fire({ icon, title, html, timer, showConfirmButton: !timer }) : (alert(stripHtml(`${title}\n\n${html}`)), Promise.resolve());
  const stripHtml = (s = '') => { const tmp = document.createElement('div'); tmp.innerHTML = s; return tmp.textContent || tmp.innerText || ''; };
  const escapeHtml = (s = '') => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  
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

  /* Carga Detalle Docentes */
  const loadDocentesDetalle = async () => {
    for (const k of ['academicTrackingData_REPORTE_DETALLADO_DOCENTES_xlsx', 'REPORTE_DETALLADO_DOCENTES', 'academicTrackingData_REPORTE_DETALLADO_DOCENTES']) {
      const data = await loadData(k);
      if (Array.isArray(data) && data.length) return data;
    }
    console.warn('⚠️ No se encontró REPORTE_DETALLADO_DOCENTES en IndexedDB');
    return [];
  };

  /* Render tabla */
  function renderTable(students) {
    tableBody.innerHTML = '';
    const counts = { 1:0, 2:0, 3:0, 4:0, 5:0 };

    students.forEach(student => {
      const row = document.createElement('tr');
      [student.Identificación || '', student.Estudiante || '', student.Correo || '', student.NEE || '', student.Nivel || ''].forEach(val => row.insertCell().textContent = val);

      const vezCell = row.insertCell();
      const vezList = document.createElement('ul');
      (student["[Vez] Materia (Docente)"] || []).forEach(item => {
        const li = document.createElement('li'); li.textContent = item; vezList.appendChild(li);
      });
      vezCell.appendChild(vezList);

      const cantidad = (student["[Vez] Materia (Docente)"] || []).length;
      counts[cantidad >= 5 ? 5 : cantidad === 4 ? 4 : cantidad === 3 ? 3 : cantidad === 2 ? 2 : 1]++;

      const riesgoCell = row.insertCell();
      const riesgoDiv = document.createElement('div'); riesgoDiv.className = 'riesgo-bar-container';
      const progreso = document.createElement('div'); progreso.className = 'riesgo-bar';
      const porcentaje = Math.min(cantidad * 20, 100);
      Object.assign(progreso.style, { width: `${porcentaje}%`, backgroundColor: getRiesgoColor(cantidad) });
      riesgoDiv.appendChild(progreso); riesgoCell.appendChild(riesgoDiv);

      const enviarCell = row.insertCell();
      const checkbox = document.createElement('input');
      Object.assign(checkbox, { type: 'checkbox', checked: true });
      checkbox.dataset.studentId = student.Identificación;
      enviarCell.appendChild(checkbox);
      tableBody.appendChild(row);
    });

    totalStudentsSpan.textContent = `Total Estudiantes: ${students.length}`;
    ['stat-riesgo-5', 'stat-riesgo-4', 'stat-riesgo-3', 'stat-riesgo-2', 'stat-riesgo-1'].forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.textContent = [`Riesgo Muy Alto (5+): ${counts[5]}`, `Riesgo Alto (4): ${counts[4]}`, `Riesgo Medio (3): ${counts[3]}`, `Riesgo Bajo (2): ${counts[2]}`, `Sin Riesgo (1): ${counts[1]}`][i];
    });
  }

  /* Filtro por NEE */
  const neeHeader = document.querySelector('#academic-tracking-table thead th:nth-child(4)');
  if (neeHeader) {
    Object.assign(neeHeader.style, { cursor: 'pointer' });
    neeHeader.title = "Click para filtrar solo estudiantes con NEE";
    neeHeader.addEventListener('click', () => {
      neeFilterActive = !neeFilterActive;
      const filtered = neeFilterActive ? allStudentsData.filter(s => s.NEE && s.NEE !== "No") : [...allStudentsData];
      neeHeader.style.color = neeFilterActive ? "#ffffffff" : "";
      filtered.sort((a,b)=>a.Estudiante.localeCompare(b.Estudiante,'es',{sensitivity:'base'}));
      renderTable(filtered);
    });
  }

  /* Carga NEE */
  const loadNEEMap = async () => {
    const keys = ['academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS', 'REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS', 'academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx', 'REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx'];
    let dataNEE = [];
    for (const k of keys) { const tmp = await loadData(k); if (Array.isArray(tmp) && tmp.length) { dataNEE = tmp; break; } }
    const neeMap = new Map();
    dataNEE.forEach(r => {
      const id = toId(r.IDENTIFICACION); if (!id) return;
      const disc = norm(r.DISCAPACIDAD), pct = norm(r['PORCENTAJE DISCAPACIDAD']);
      if (disc) neeMap.set(id, pct ? `${disc} ${pct}%` : disc);
    });
    return neeMap;
  };

  /* Carga principal */
  async function loadEstudiantes(periodoSeleccionado = null, carreraSeleccionada = null) {
    const dataPrincipal = await loadData('academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx') || [];
    
    if (!Array.isArray(dataPrincipal) || !dataPrincipal.length) {
      console.warn('⚠️ No se encontró academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx');
      if (periodSelect) periodSelect.innerHTML = '';
      if (careerSelect) careerSelect.innerHTML = '';
      return [];
    }

    dataNotasGlobal = dataPrincipal;
    const neeMap = await loadNEEMap();

    const periodosUnicos = [...new Set(dataPrincipal.map(r => norm(r.PERIODO)).filter(Boolean))];
    const periodosOrdenados = sortPeriodos(periodosUnicos);
    
    let periodoActual = periodoSeleccionado || periodosOrdenados[0];
    if (!periodosOrdenados.includes(periodoActual)) periodoActual = periodosOrdenados[0];

    if (periodSelect) periodSelect.innerHTML = periodosOrdenados.map(p => `<option value="${escapeHtml(p)}" ${p===periodoActual?'selected':''}>${escapeHtml(p)}</option>`).join('');

    const carrerasUnicas = ['Todas', ...new Set(dataPrincipal.filter(r => norm(r.PERIODO) === periodoActual).map(r => norm(r.CARRERA)).filter(Boolean))].sort((a,b) => a === 'Todas' ? -1 : b === 'Todas' ? 1 : a.localeCompare(b,'es',{sensitivity:'base'}));
    let carreraActual = carreraSeleccionada || localStorage.getItem('selectedCareer') || carrerasUnicas[0];
    if (!carrerasUnicas.includes(carreraActual)) carreraActual = carrerasUnicas[0];

    if (careerSelect) careerSelect.innerHTML = carrerasUnicas.map(c => `<option value="${escapeHtml(c)}" ${c===carreraActual?'selected':''}>${escapeHtml(c)}</option>`).join('');

    const agrupados = {};
    dataPrincipal.forEach(entry => {
      const id = toId(entry.IDENTIFICACION), periodo = norm(entry.PERIODO), carrera = norm(entry.CARRERA), noVez = Number(norm(entry["NO. VEZ"]));
      
      if (!id || !Number.isFinite(noVez) || noVez < 2 || periodo !== periodoActual || (carreraActual !== 'Todas' && carrera !== carreraActual)) return;

      const materia = norm(entry.MATERIA);
      let docente = norm(entry.DOCENTE); 
      if (docente.includes(" - ")) docente = docente.split(" - ")[1].trim();
      const item = `[${noVez}] ${materia} (${docente})`;

      if (!agrupados[id]) {
        agrupados[id] = {
          Identificación: id,
          Estudiante: `${norm(entry.APELLIDOS)} ${norm(entry.NOMBRES)}`.trim(),
          Correo: [entry.CORREO_INSTITUCIONAL, entry.CORREO_PERSONAL].filter(Boolean).map(norm).join('; '),
          NEE: neeMap.get(id) || "No",
          Nivel: norm(entry.NIVEL),
          "[Vez] Materia (Docente)": []
        };
      }
      agrupados[id]["[Vez] Materia (Docente)"].push(item);
    });

    localStorage.setItem('selectedPeriod', periodoActual);
    localStorage.setItem('selectedCareer', carreraActual);

    return Object.values(agrupados).map(s => ({ ...s, "[Vez] Materia (Docente)": [...new Set(s["[Vez] Materia (Docente)"])] }));
  }

  /* Inicialización y eventos */
  (async function () {
    allStudentsData = await loadEstudiantes();
    allStudentsData.sort((a,b)=>a.Estudiante.localeCompare(b.Estudiante,'es',{sensitivity:'base'}));
    renderTable(allStudentsData);
  })();

  periodSelect?.addEventListener('change', async (e) => {
    allStudentsData = await loadEstudiantes(e.target.value, careerSelect?.value);
    allStudentsData.sort((a,b)=>a.Estudiante.localeCompare(b.Estudiante,'es',{sensitivity:'base'}));
    renderTable(allStudentsData);
  });

  careerSelect?.addEventListener('change', async (e) => {
    allStudentsData = await loadEstudiantes(periodSelect?.value, e.target.value);
    allStudentsData.sort((a,b)=>a.Estudiante.localeCompare(b.Estudiante,'es',{sensitivity:'base'}));
    renderTable(allStudentsData);
  });

  filterInput.addEventListener('input', () => {
    const query = filterInput.value.toLowerCase();
    const filtered = allStudentsData.filter(s => Object.entries(s).some(([k,val]) => 
      k === "[Vez] Materia (Docente)" ? (Array.isArray(val) && val.some(item => item.toLowerCase().includes(query))) : String(val).toLowerCase().includes(query)
    ));
    filtered.sort((a,b)=>a.Estudiante.localeCompare(b.Estudiante,'es',{sensitivity:'base'}));
    renderTable(filtered);
  });

  sendEmailsButton.addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('#academicTrackingTableBody input[type="checkbox"]:checked'))
      .map(cb => allStudentsData.find(s => s.Identificación === cb.dataset.studentId))
      .filter(s => s && (s["[Vez] Materia (Docente)"]?.length || 0) > 0);

    if (!selected.length) return showModal({icon:'info',title:'Sin selección',html:'Selecciona al menos un estudiante con materias para enviar correos.'});

    const payload = selected.map(s => ({ ...s, enviar:true, "[Vez] Materia (Docente)": Array.isArray(s["[Vez] Materia (Docente)"]) ? s["[Vez] Materia (Docente)"].filter(Boolean) : [s["[Vez] Materia (Docente)"]].filter(Boolean) }));
    const docentesExcel = await loadDocentesDetalle();

    showLoading('Enviando correos...');
    try {
      await enviarCorreos(payload, docentesExcel);
      hideLoading();
      await showModal({icon:'success',title:'Correos enviados correctamente',html:'',timer:1400});
    } catch (err) {
      hideLoading();
      await showModal({icon:'error',title:'Error al enviar correos',html:`<pre style="white-space:pre-wrap;margin:0">${escapeHtml(err?.message||String(err))}</pre>`});
    }
  });

  backToMenuButton.addEventListener('click', () => window.location.href = '../index.html');
});