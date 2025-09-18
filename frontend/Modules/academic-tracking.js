// seguimiento-academico.js
import { loadData } from '../indexeddb-storage.js';
import { enviarCorreos } from './emailModule.js';

document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.getElementById('academicTrackingTableBody');
  const totalStudentsSpan = document.getElementById('total-students');
  const filterInput = document.getElementById('filterAcademicInput');
  const sendEmailsButton = document.getElementById('sendAcademicEmails');
  const backToMenuButton = document.getElementById('goToMenuButton');
  const periodLabel = document.getElementById("current-period-label");
  const periodSelect = document.getElementById('period-select');
  const careerSelect = document.getElementById('carrer-select');

  if (!tableBody || !totalStudentsSpan || !filterInput || !sendEmailsButton || !backToMenuButton) {
    console.error("Uno o más elementos del DOM no se encontraron. Revisa los IDs en el HTML.");
    return;
  }

  let allStudentsData = [];
  let dataNotasGlobal = [];

  /* ========= Helpers ========= */
  const toId = (v) => String(v ?? '').replace(/\D/g, '').trim();
  const norm = (v) => (v ?? '').toString().trim();
  const canon = (s) =>
    norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  function getRiesgoColor(count) {
    if (count >= 5) return '#d93025';
    if (count === 4) return '#f57c00';
    if (count === 3) return '#fbc02d';
    if (count === 2) return '#7cb342';
    return '#4caf50';
  }

  /* ========= UI helpers ========= */
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
  function hideLoading() { if (window.Swal && Swal.isVisible()) Swal.close(); else removeLoadingOverlay(); }
  function showModal({ icon = 'info', title = '', html = '', timer = null }) {
    if (window.Swal) {
      return Swal.fire({ icon, title, html, timer, showConfirmButton: !timer });
    } else {
      alert(stripHtml(`${title}\n\n${html}`));
      return Promise.resolve();
    }
  }
  function stripHtml(s = '') { const tmp = document.createElement('div'); tmp.innerHTML = s; return tmp.textContent || tmp.innerText || ''; }
  function escapeHtml(s = '') { return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function createLoadingOverlay(text) {
    if (document.getElementById('email-loading-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'email-loading-overlay';
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;`;
    overlay.innerHTML = `<div style="padding:18px 22px;background:rgba(0,0,0,.65);border-radius:10px;text-align:center;min-width:260px">
        <div class="spinner" style="width:36px;height:36px;border:4px solid #fff;border-top-color:transparent;border-radius:50%;margin:0 auto 12px;animation:spin 1s linear infinite"></div>
        <div>${escapeHtml(text)}</div></div>`;
    const style = document.createElement('style'); style.textContent = `@keyframes spin{to{transform:rotate(360deg)}}`;
    overlay.appendChild(style);
    document.body.appendChild(overlay);
  }
  function removeLoadingOverlay() { const el = document.getElementById('email-loading-overlay'); if (el) el.remove(); }

  /* ========= Carga Detalle Docentes ========= */
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

  /* ========= Render tabla ========= */
  function renderTable(students) {
    tableBody.innerHTML = '';
    const counts = { 1:0, 2:0, 3:0, 4:0, 5:0 };

    students.forEach(student => {
      const row = document.createElement('tr');
      row.insertCell().textContent = student.Identificación || '';
      row.insertCell().textContent = student.Estudiante || '';
      row.insertCell().textContent = student.Correo || '';
      row.insertCell().textContent = student.NEE || '';
      row.insertCell().textContent = student.Nivel || '';

      const vezCell = row.insertCell();
      const vezList = document.createElement('ul');
      (student["[Vez] Materia (Docente)"] || []).forEach(item => {
        const li = document.createElement('li'); li.textContent = item; vezList.appendChild(li);
      });
      vezCell.appendChild(vezList);

      const cantidad = (student["[Vez] Materia (Docente)"] || []).length;
      if (cantidad >= 5) counts[5]++; else if (cantidad === 4) counts[4]++; else if (cantidad === 3) counts[3]++; else if (cantidad === 2) counts[2]++; else counts[1]++;

      const riesgoCell = row.insertCell();
      const riesgoDiv = document.createElement('div'); riesgoDiv.className = 'riesgo-bar-container';
      const progreso = document.createElement('div'); progreso.className = 'riesgo-bar';
      const porcentaje = Math.min(cantidad * 20, 100);
      progreso.style.width = `${porcentaje}%`; progreso.style.backgroundColor = getRiesgoColor(cantidad);
      riesgoDiv.appendChild(progreso); riesgoCell.appendChild(riesgoDiv);

      const enviarCell = row.insertCell();
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.dataset.studentId = student.Identificación;
      enviarCell.appendChild(checkbox);

      tableBody.appendChild(row);
    });

    totalStudentsSpan.textContent = `Total Estudiantes: ${students.length}`;
    document.getElementById('stat-riesgo-5').textContent = `Riesgo Muy Alto (5+): ${counts[5]}`;
    document.getElementById('stat-riesgo-4').textContent = `Riesgo Alto (4): ${counts[4]}`;
    document.getElementById('stat-riesgo-3').textContent = `Riesgo Medio (3): ${counts[3]}`;
    document.getElementById('stat-riesgo-2').textContent = `Riesgo Bajo (2): ${counts[2]}`;
    document.getElementById('stat-riesgo-1').textContent = `Sin Riesgo (1): ${counts[1]}`;
  }

  /* ========= Carga NEE ========= */
  async function loadNEEMap() {
    const possibleKeys = [
      'academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS',
      'REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS',
      'academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx',
      'REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx'
    ];
    let dataNEE = [];
    for (const k of possibleKeys) {
      const tmp = await loadData(k);
      if (Array.isArray(tmp) && tmp.length) { dataNEE = tmp; break; }
    }
    const neeMap = new Map();
    dataNEE.forEach(r => {
      const id = toId(r['IDENTIFICACION']); if (!id) return;
      const disc = norm(r['DISCAPACIDAD']); const pct = norm(r['PORCENTAJE DISCAPACIDAD']);
      if (disc) neeMap.set(id, pct ? `${disc} ${pct}%` : disc);
    });
    return neeMap;
  }

  /* ========= Carga principal CON CORRECCIÓN ========= */
  async function loadCalificacionesParcialTotal(periodoSeleccionado = null, carreraSeleccionada = null) {
    const keyNotas = 'academicTrackingData_REPORTE_POR_SEMESTRE';
    
    // 🔹 CORRECCIÓN: Cargar TAMBIÉN desde el KEY_PARCIAL_TOTAL para obtener TODOS los periodos
    const keyParcialTotal = 'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx';
    
    const dataNotas = await loadData(keyNotas) || [];
    const dataParcialTotal = await loadData(keyParcialTotal) || [];
    
    // 🔹 Combinar ambas fuentes para extraer periodos únicos
    const todasLasFuentes = [...dataNotas, ...dataParcialTotal];
    
    if (!Array.isArray(todasLasFuentes) || !todasLasFuentes.length) {
      if (periodSelect) { periodSelect.innerHTML = ''; }
      if (careerSelect) { careerSelect.innerHTML = ''; }
      if (periodLabel) { periodLabel.textContent = '📅 Periodo actual: -'; }
      return [];
    }

    dataNotasGlobal = dataNotas; // Mantener para compatibilidad
    const neeMap = await loadNEEMap();

    // 🔹 Extraer periodos únicos de TODAS las fuentes disponibles
    const periodosUnicos = [...new Set(todasLasFuentes.map(r => norm(r["PERIODO"])).filter(Boolean))]
      .sort((a,b)=>String(b).localeCompare(String(a)));
    
    let periodoActual = periodoSeleccionado || localStorage.getItem('selectedPeriod') || periodosUnicos[0];
    if (!periodosUnicos.includes(periodoActual)) periodoActual = periodosUnicos[0];

    if (periodSelect) {
      periodSelect.innerHTML = periodosUnicos.map(p => `<option value="${escapeHtml(p)}" ${p===periodoActual?'selected':''}>${escapeHtml(p)}</option>`).join('');
    }

    // 🔹 Extraer carreras únicas de TODAS las fuentes, filtradas por periodo
    const carrerasUnicas = [...new Set(todasLasFuentes
      .filter(r => norm(r["PERIODO"]) === periodoActual)
      .map(r => norm(r["CARRERA"]))
      .filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
    carrerasUnicas.unshift('Todas');

    let carreraActual = carreraSeleccionada || localStorage.getItem('selectedCareer') || carrerasUnicas[0];
    if (!carrerasUnicas.includes(carreraActual)) carreraActual = carrerasUnicas[0];

    if (careerSelect) {
      careerSelect.innerHTML = carrerasUnicas.map(c => `<option value="${escapeHtml(c)}" ${c===carreraActual?'selected':''}>${escapeHtml(c)}</option>`).join('');
    }

    if (periodLabel) periodLabel.textContent = `📅 Periodo actual: ${periodoActual} `;

    // 🔹 Procesar datos usando dataNotas (REPORTE_POR_SEMESTRE) para la lógica principal
    const agrupados = {};
    dataNotas.forEach(entry => {
      const id = toId(entry["IDENTIFICACION"]);
      const periodo = norm(entry["PERIODO"]);
      const carrera = norm(entry["CARRERA"]);
      const noVez = Number(norm(entry["NO. VEZ"]));
      if (!id || !Number.isFinite(noVez) || noVez < 2 || periodo !== periodoActual) return;

      // Solo filtrar por carrera si NO es "Todas"
      if (carreraActual !== 'Todas' && carrera !== carreraActual) return;

      const materia = norm(entry["MATERIA"]);
      let docente = norm(entry["DOCENTE"]); 
      if (docente.includes(" - ")) docente = docente.split(" - ")[1].trim();
      const item = `[${noVez}] ${materia} (${docente})`;

      if (!agrupados[id]) {
        const neeTexto = neeMap.get(id) || "No";
        agrupados[id] = {
          Identificación: id,
          Estudiante: `${norm(entry["APELLIDOS"])} ${norm(entry["NOMBRES"])}`.trim(),
          Correo: [entry["CORREO_INSTITUCIONAL"], entry["CORREO_PERSONAL"]].filter(Boolean).map(norm).join('; '),
          NEE: neeTexto,
          Nivel: norm(entry["NIVEL"]),
          "[Vez] Materia (Docente)": []
        };
      }
      agrupados[id]["[Vez] Materia (Docente)"].push(item);
    });

    localStorage.setItem('selectedPeriod', periodoActual);
    localStorage.setItem('selectedCareer', carreraActual);

    return Object.values(agrupados).map(s => ({
      ...s,
      "[Vez] Materia (Docente)": [...new Set(s["[Vez] Materia (Docente)"])]
    }));
  }

  /* ========= Ejecutar al cargar ========= */
  (async function () {
    allStudentsData = await loadCalificacionesParcialTotal();
    allStudentsData.sort((a,b)=>a.Estudiante.localeCompare(b.Estudiante,'es',{sensitivity:'base'}));
    renderTable(allStudentsData);
  })();

  /* ========= Cambio de periodo ========= */
  if (periodSelect) {
    periodSelect.addEventListener('change', async (e) => {
      allStudentsData = await loadCalificacionesParcialTotal(e.target.value, careerSelect?.value);
      allStudentsData.sort((a,b)=>a.Estudiante.localeCompare(b.Estudiante,'es',{sensitivity:'base'}));
      renderTable(allStudentsData);
    });
  }

  /* ========= Cambio de carrera ========= */
  if (careerSelect) {
    careerSelect.addEventListener('change', async (e) => {
      allStudentsData = await loadCalificacionesParcialTotal(periodSelect?.value, e.target.value);
      allStudentsData.sort((a,b)=>a.Estudiante.localeCompare(b.Estudiante,'es',{sensitivity:'base'}));
      renderTable(allStudentsData);
    });
  }

  /* ========= Filtro ========= */
  filterInput.addEventListener('input', () => {
    const query = filterInput.value.toLowerCase();
    const filtered = allStudentsData.filter(s =>
      Object.entries(s).some(([k,val]) => {
        if (k === "[Vez] Materia (Docente)") return (Array.isArray(val) && val.some(item => item.toLowerCase().includes(query)));
        return String(val).toLowerCase().includes(query);
      })
    );
    filtered.sort((a,b)=>a.Estudiante.localeCompare(b.Estudiante,'es',{sensitivity:'base'}));
    renderTable(filtered);
  });

  /* ========= Enviar correos ========= */
  sendEmailsButton.addEventListener('click', async () => {
    const selected = [];
    document.querySelectorAll('#academicTrackingTableBody input[type="checkbox"]:checked').forEach(cb => {
      const id = cb.dataset.studentId;
      const student = allStudentsData.find(s => s.Identificación === id);
      if (student && (student["[Vez] Materia (Docente)"]?.length || 0) > 0) selected.push(student);
    });

    if (!selected.length) {
      await showModal({icon:'info',title:'Sin selección',html:'Selecciona al menos un estudiante con materias para enviar correos.'});
      return;
    }

    const payload = selected.map(s => ({ ...s, enviar:true, "[Vez] Materia (Docente)": Array.isArray(s["[Vez] Materia (Docente)"]) ? s["[Vez] Materia (Docente)"].filter(Boolean) : [s["[Vez] Materia (Docente)"]].filter(Boolean) }));
    const docentesExcel = await loadDocentesDetalle();

    showLoading('Enviando correos...');
    try {
      const result = await enviarCorreos(payload, docentesExcel);
      hideLoading();
      await showModal({icon:'success',title:'Correos enviados correctamente',html:'',timer:1400});
    } catch (err) {
      hideLoading();
      await showModal({icon:'error',title:'Error al enviar correos',html:`<pre style="white-space:pre-wrap;margin:0">${escapeHtml(err?.message||String(err))}</pre>`});
    }
  });

  /* ========= Volver al menú ========= */
  backToMenuButton.addEventListener('click', () => { window.location.href = '../index.html'; });
});