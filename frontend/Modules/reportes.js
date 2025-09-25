import { loadData } from '../indexeddb-storage.js';

/* ===== Helpers ===== */
const norm = (v) => (v ?? '').toString().trim();
const asNum = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const normalizeFileName = (fileName) => fileName.replace(/\W+/g, "_");

/* ===== Carga con "fallbacks" de claves comunes ===== */
async function loadWithFallback(possibleKeys) {
  for (const k of possibleKeys) {
    const data = await loadData(k);
    if (Array.isArray(data) && data.length) {
      return { key: k, data };
    }
  }
  return { key: null, data: [] };
}


/* ===== Claves posibles para TOTAL y PARCIAL ===== */
const KEYS_TOTAL = [
  'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx',
  `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL.xlsx')}`,
  'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL'
];

const KEYS_PARCIAL = [
  'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_xlsx',
  `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL.xlsx')}`,
  'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL'
];

const KEYS_NOMINA = [
  'academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS',
  'REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS',
  'academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx',
  'REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx'
];

/* ===== Orden de períodos ===== */
function pickMostRecentPeriod(periods) {
  const parse = (p) => {
    const m = String(p).match(/(\d{4}).*?(\d{4}).*(CI{1,2})/i);
    if (!m) return { y1: -1, term: -1, raw: p };
    return { y1: Number(m[1]), term: m[3].toUpperCase() === 'CII' ? 2 : 1, raw: p };
  };
  return periods
    .slice()
    .sort((A, B) => {
      const a = parse(A), b = parse(B);
      if (a.y1 !== b.y1) return b.y1 - a.y1;
      if (a.term !== b.term) return b.term - a.term;
      return String(b.raw).localeCompare(String(a.raw));
    })[0] || '';
}


/* ===== Estado Charts ===== */
let chartNoVez, chartAprobReprob, chartHist, chartEstPorPeriodo, chartGenero, chartEtnia;

function destroyCharts(){
  [chartNoVez, chartAprobReprob, chartHist, chartEstPorPeriodo, chartGenero, chartEtnia].forEach(ch => {
    if (ch && typeof ch.destroy === 'function') {
      try { ch.destroy(); } catch {}
    }
  });
  chartNoVez = chartAprobReprob = chartHist = chartEstPorPeriodo = chartGenero = chartEtnia = null;
}

/* ===== Variables globales para filtros ===== */
let allData = [];
let nominaData = [];
let filteredData = [];
let currentCareer = '';
let currentMateria = '';


/* ===== Cargar datos de nómina ===== */
async function loadNominaData() {
  console.log('Intentando cargar datos de nómina con claves:', KEYS_NOMINA);
  const { key, data } = await loadWithFallback(KEYS_NOMINA);
  nominaData = data || [];
  console.log('Datos de nómina cargados:', {
    key: key,
    dataLength: nominaData.length,
    firstRecord: nominaData[0] || null
  });
  return nominaData;
}

/* ===== Select de períodos ===== */
async function populatePeriodSelect() {
  const select = document.getElementById('period-select');
  if (!select) return;

  let { data } = await loadWithFallback(KEYS_TOTAL);
  if (!data.length) {
    ({ data } = await loadWithFallback(KEYS_PARCIAL));
  }
  if (!data.length) {
    select.innerHTML = '';
    return null;
  }

  // Guardar todos los datos para filtrar después
  allData = data;

  // Cargar datos de nómina
  await loadNominaData();

  const periods = Array.from(new Set(
    data.map(r => norm(r.PERIODO)).filter(Boolean)
  ));

  periods.sort((A, B) => {
    const parse = (p) => {
      const m = String(p).match(/(\d{4}).*?(\d{4}).*(CI{1,2})/i);
      if (!m) return { y1: -1, term: -1, raw: p };
      return { y1: Number(m[1]), term: m[3].toUpperCase()==='CII' ? 2 : 1, raw: p };
    };
    const pa = parse(A), pb = parse(B);
    if (pa.y1 !== pb.y1) return pb.y1 - pa.y1;
    if (pa.term !== pb.term) return pb.term - pa.term;
    return String(B).localeCompare(String(A));
  });

  const saved = localStorage.getItem('selectedPeriod');
  const selected = (saved && periods.includes(saved)) ? saved : pickMostRecentPeriod(periods);

  select.innerHTML = periods.map(p => `<option value="${p}">${p}</option>`).join('');
  if (selected) {
    select.value = selected;
    localStorage.setItem('selectedPeriod', selected);
  }

  // Poblar selector de carreras
  populateCareerSelect(selected);
  
  return selected;
}

/* ===== Poblar selector de carreras ===== */
function populateCareerSelect(period) {
  const select = document.getElementById('career-select');
  if (!select) return;

  const periodData = allData.filter(r => norm(r.PERIODO) === norm(period));
  const careers = Array.from(new Set(periodData.map(r => norm(r.CARRERA)).filter(Boolean))).sort();

  select.innerHTML = '<option value="">Todas las carreras</option>' +
    careers.map(c => `<option value="${c}">${c}</option>`).join('');

  const savedCareer = localStorage.getItem('selectedCareer');
  if (savedCareer && careers.includes(savedCareer)) {
    select.value = savedCareer;
    currentCareer = savedCareer;
  } else {
    currentCareer = '';
  }

  // 👉 cuando cambie carrera, refrescamos materias
  populateMateriaSelect(period, currentCareer);
}

/* ===== Poblar filtro de materias ===== */
function populateMateriaSelect(period, career) {
  const select = document.getElementById('materia-select');
  if (!select) return;

  // Filtrar por período y carrera
  let rows = allData.filter(r => norm(r.PERIODO) === norm(period));
  if (career) {
    rows = rows.filter(r => norm(r.CARRERA) === career);
  }

  const materias = Array.from(new Set(
    rows.map(r => norm(r.MATERIA || r.Materia || r.materia)).filter(Boolean)
  )).sort();

  select.innerHTML = '<option value="">Todas las materias</option>' +
    materias.map(m => `<option value="${m}">${m}</option>`).join('');

  // Restaurar selección previa
  const savedMateria = localStorage.getItem('selectedMateria');
  if (savedMateria && materias.includes(savedMateria)) {
    select.value = savedMateria;
    currentMateria = savedMateria;
  } else {
    currentMateria = '';
  }
}

/* ===== Estudiantes únicos por período (histórico) ===== */
async function getStudentsByPeriod() {
  if (!Array.isArray(allData) || !allData.length) return { labels: [], counts: [] };

  const map = new Map(); // PERIODO -> Set(IDENTIFICACION)
  allData.forEach(r => {
    const per = norm(r.PERIODO);
    const id  = norm(r.IDENTIFICACION);
    if (!per || !id) return;
    if (!map.has(per)) map.set(per, new Set());
    map.get(per).add(id);
  });

  const parse = (p) => {
    const m = String(p).match(/(\d{4}).*?(\d{4}).*(CI{1,2})/i);
    if (!m) return { y1: -1, term: -1, raw: p };
    return { y1: Number(m[1]), term: m[3].toUpperCase()==='CII' ? 2 : 1, raw: p };
  };

  const labels = [...map.keys()].sort((A,B)=>{
    const a=parse(A), b=parse(B);
    if (a.y1!==b.y1) return a.y1-b.y1;
    if (a.term!==b.term) return a.term-b.term;
    return String(a.raw).localeCompare(String(b.raw));
  });

  const counts = labels.map(p => map.get(p).size);
  return { labels, counts };
}

/* ===== Función para obtener datos de género ===== */
function getGenderDistribution(selectedPeriod) {
  console.log('getGenderDistribution llamada con:', { selectedPeriod, nominaDataLength: nominaData.length });
  
  if (!nominaData.length) {
    console.log('No hay datos de nómina disponibles');
    return { labels: [], data: [], colors: [] };
  }

  // Mostrar una muestra de los datos para debug
  if (nominaData.length > 0) {
    console.log('Muestra de campos en nominaData[0]:', Object.keys(nominaData[0]));
    console.log('Primer registro de nómina:', nominaData[0]);
  }

  // Filtrar por período si está disponible en los datos de nómina
  let filteredNomina = nominaData;
  if (selectedPeriod && nominaData.some(r => norm(r.PERIODO) === norm(selectedPeriod))) {
    filteredNomina = nominaData.filter(r => norm(r.PERIODO) === norm(selectedPeriod));
    console.log(`Filtrado por período ${selectedPeriod}: ${filteredNomina.length} registros`);
  } else {
    console.log(`⚠️ No hay registros para ${selectedPeriod}, usando todos los registros (${nominaData.length})`);
  }

  // Si hay filtro de carrera, aplicarlo también
  if (currentCareer) {
    filteredNomina = filteredNomina.filter(r => norm(r.CARRERA) === currentCareer);
    console.log(`Filtrado por carrera ${currentCareer}: ${filteredNomina.length} registros`);
  }

  const genderCounts = {};
  filteredNomina.forEach(r => {
    // Intentar diferentes campos posibles
    const gender = norm(r.SEXO || r.GENERO || r.GENDER || '').toUpperCase();
    if (gender) {
      // Normalizar valores comunes
      let normalizedGender = gender;
      if (gender === 'M' || gender === 'MASCULINO' || gender === 'HOMBRE') {
        normalizedGender = 'MASCULINO';
      } else if (gender === 'F' || gender === 'FEMENINO' || gender === 'MUJER') {
        normalizedGender = 'FEMENINO';
      }
      genderCounts[normalizedGender] = (genderCounts[normalizedGender] || 0) + 1;
    }
  });

  console.log('Conteos de género:', genderCounts);

  const labels = Object.keys(genderCounts);
  const data = Object.values(genderCounts);
  const colors = labels.map((_, index) => {
    const colorPalette = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF'];
    return colorPalette[index % colorPalette.length];
  });

  return { labels, data, colors };
}

/* ===== Función para obtener datos de etnia ===== */
function getEthnicityDistribution(selectedPeriod) {
  console.log('getEthnicityDistribution llamada con:', { selectedPeriod, nominaDataLength: nominaData.length });
  
  if (!nominaData.length) {
    console.log('No hay datos de nómina disponibles para etnia');
    return { labels: [], data: [], colors: [] };
  }

  // Filtrar por período si está disponible en los datos de nómina
  let filteredNomina = nominaData;
  if (selectedPeriod && nominaData.some(r => norm(r.PERIODO) === norm(selectedPeriod))) {
    filteredNomina = nominaData.filter(r => norm(r.PERIODO) === norm(selectedPeriod));
    console.log(`Filtrado por período ${selectedPeriod}: ${filteredNomina.length} registros`);
  } else {
    console.log(`⚠️ No hay registros para ${selectedPeriod}, usando todos los registros (${nominaData.length})`);
  }

  // Si hay filtro de carrera, aplicarlo también
  if (currentCareer) {
    filteredNomina = filteredNomina.filter(r => norm(r.CARRERA) === currentCareer);
    console.log(`Filtrado por carrera ${currentCareer}: ${filteredNomina.length} registros`);
  }

  const ethnicityCounts = {};
  filteredNomina.forEach(r => {
    // Intentar diferentes campos posibles
    const ethnicity = norm(r.ETNIA || r.ETNICITY || '').toUpperCase();
    if (ethnicity && ethnicity !== 'N/A' && ethnicity !== '' && ethnicity !== 'NULL') {
      ethnicityCounts[ethnicity] = (ethnicityCounts[ethnicity] || 0) + 1;
    }
  });

  console.log('Conteos de etnia:', ethnicityCounts);

  const labels = Object.keys(ethnicityCounts);
  const data = Object.values(ethnicityCounts);
  const colors = labels.map((_, index) => {
    const colorPalette = ['#FF9F43', '#10AC84', '#EE5A24', '#0ABDE3', '#5F27CD', '#FD79A8', '#FDCB6E'];
    return colorPalette[index % colorPalette.length];
  });

  return { labels, data, colors };
}

/* ===== Aplicar filtros ===== */
function applyFilters() {
  const period = document.getElementById('period-select').value;
  
  // Filtrar por período
  filteredData = allData.filter(r => norm(r.PERIODO) === norm(period));
  
  // Filtrar por carrera si está seleccionada
  if (currentCareer) {
    filteredData = filteredData.filter(r => norm(r.CARRERA) === currentCareer);
  }

  // Filtrar por materia
  if (currentMateria) {
    filteredData = filteredData.filter(r => norm(r.MATERIA || r.Materia || r.materia) === currentMateria);
  }
  
  return filteredData;
}

/* ===== Agregados generales ===== */
function buildMetrics(rows) {
  const registros = rows.length;
  const estudiantes = new Set(rows.map(r => norm(r.IDENTIFICACION)).filter(Boolean)).size;

  const vezCounts = { '1':0, '2':0, '3':0 };
  rows.forEach(r => {
    const v = norm(r['NO. VEZ']);
    if (v === '1') vezCounts['1']++;
    else if (v === '2') vezCounts['2']++;
    else if (v) vezCounts['3']++;
  });

  const estadoCounts = { APROBADO:0, REPROBADO:0, CURSANDO:0 };
  rows.forEach(r => {
    const e = norm(r.ESTADO).toUpperCase();
    if (e.includes('APROB')) estadoCounts.APROBADO++;
    else if (e.includes('REPROB')) estadoCounts.REPROBADO++;
    else estadoCounts.CURSANDO++;
  });

  const bins = Array.from({length: 10}, (_,i)=>({label:`${i}–${i+1}`, count:0}));
  rows.forEach(r => {
    const p = asNum(r.PROMEDIO);
    if (p === null) return;
    const idx = Math.max(0, Math.min(9, Math.floor(p)));
    bins[idx].count++;
  });

  const mapMat = new Map();
  rows.forEach(r => {
    const m = norm(r.MATERIA);
    if (!m) return;
    const e = norm(r.ESTADO).toUpperCase();
    const o = mapMat.get(m) || { total:0, rep:0 };
    o.total++;
    if (e.includes('REPROB')) o.rep++;
    mapMat.set(m, o);
  });
  const materias = [...mapMat.entries()]
  .map(([materia, o]) => ({
    materia,
    reprobados: o.rep,
    total: o.total,
    pct: o.total ? (o.rep / o.total) : 0
  }))
  // ordenar de mayor a menor % reprobados
  .sort((a, b) => b.pct - a.pct || b.reprobados - a.reprobados)
  .slice(0, 10);


  return { registros, estudiantes, vezCounts, estadoCounts, bins, materias };
}

/* ===== Normalización de docente y filtros ===== */
const canon = (s) =>
  (s ?? '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

// Acepta: 6+ dígitos + " - " + nombre
const DOCENTE_REGEX = /^\s*(\d{6,})\s*-\s*([A-Za-zÁÉÍÓÚÜÑ\s.'-]+)\s*$/i;

function parseDocente(raw) {
  const txt = norm(raw);
  const m = txt.match(DOCENTE_REGEX);
  if (!m) return null;
  return { id: m[1], nombre: norm(m[2]), canonNombre: canon(m[2]), full: txt };
}
function getNombreDocente(raw) {
  const p = parseDocente(raw);
  return p ? p.nombre : null;
}

const ESTADOS_PERMITIDOS = new Set(['APROBADA', 'REPROBADA']);
const MATERIAS_REGEX_EXCLUIR = [/^INGLES\s+(I|II|III|IV)\b/i];
const materiaExcluida = (materia) => MATERIAS_REGEX_EXCLUIR.some(rx => rx.test(canon(materia)));

/* ===== Top 10 DOCENTES (agregado por docente), solo si DOCENTE = "###### - Nombre" ===== */
function computeTop10DocentesReprobados(rows) {
  const aprobadas = {};
  const reprobadas = {};
  const totales   = {};

  rows.forEach(r => {
    const estado = canon(r.ESTADO);
    if (!ESTADOS_PERMITIDOS.has(estado)) return;

    if (materiaExcluida(r.MATERIA)) return;

    const d = parseDocente(r.DOCENTE);
    if (!d || d.canonNombre === 'MOVILIDAD') return;

    const docente = getNombreDocente(r.DOCENTE);
    if (!docente) return;

    totales[docente]   = (totales[docente]   ?? 0) + 1;
    if (estado === 'APROBADA')  aprobadas[docente]  = (aprobadas[docente]  ?? 0) + 1;
    if (estado === 'REPROBADA') reprobadas[docente] = (reprobadas[docente] ?? 0) + 1;
  });

  return Object.keys(totales).map(docente => {
    const ap  = aprobadas[docente]  ?? 0;
    const rp  = reprobadas[docente] ?? 0;
    const tot = ap + rp;
    const pctReprob = tot > 0 ? (rp / tot) * 100 : 0;
    return { docente, rp, tot, pctReprob };
  })
  .sort((a, b) => (b.pctReprob - a.pctReprob) || (b.tot - a.tot))
  .slice(0, 10);
}

/* ===== KPIs ===== */
function renderKPIs(m) {
  document.getElementById('kpi-registros').textContent = m.registros.toLocaleString('es');
  document.getElementById('kpi-estudiantes').textContent = m.estudiantes.toLocaleString('es');
  document.getElementById('kpi-no-vez').textContent =
    `1: ${m.vezCounts['1'].toLocaleString('es')}, 2: ${m.vezCounts['2'].toLocaleString('es')}, 3: ${m.vezCounts['3'].toLocaleString('es')}`;
}

/* ===== Charts ===== */
async function renderCharts(m) {
  destroyCharts();
  
  const selectedPeriod = document.getElementById('period-select').value;

  chartNoVez = new Chart(document.getElementById('chartNoVez'), {
    type: 'bar',
    data: {
      labels: ['1', '2', '3+'],
      datasets: [{ label: 'Conteo', data: [m.vezCounts['1'], m.vezCounts['2'], m.vezCounts['3']] }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx)=>` ${ctx.parsed.x.toLocaleString('es')}` } }
      },
      scales: { x: { beginAtZero: true, ticks: { precision:0 } }, y: { ticks: { precision:0 } } }
    }
  });

  chartAprobReprob = new Chart(document.getElementById('chartAprobReprob'), {
    type: 'doughnut',
    data: {
      labels: ['Aprobado','Reprobado','Cursando'],
      datasets: [{ data: [m.estadoCounts.APROBADO, m.estadoCounts.REPROBADO, m.estadoCounts.CURSANDO] }]
    },
    options: {
      responsive: true, 
      maintainAspectRatio: false, 
      cutout: '60%',
      plugins: { 
        legend: { position:'bottom' },
        tooltip: { 
          callbacks: { 
            label: (ctx) => {
              // Calcular el total
              const total = ctx.dataset.data.reduce((sum, value) => sum + value, 0);
              // Calcular el porcentaje
              const percentage = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0.0';
              // Mostrar: "Etiqueta: cantidad (porcentaje%)"
              return ` ${ctx.label}: ${ctx.parsed.toLocaleString('es')} (${percentage}%)`;
            }
          } 
        } 
      }
    }
  });

  const sp = await getStudentsByPeriod();
  chartEstPorPeriodo = new Chart(document.getElementById('chartEstPorPeriodo'), {
    type: 'bar',
    data: {
      labels: sp.labels,
      datasets: [{ label: 'Estudiantes únicos', data: sp.counts }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label:(ctx)=>` ${ctx.parsed.y.toLocaleString('es')}` } }
      },
      scales: {
        x: { ticks: { autoSkip: true, maxRotation: 0, minRotation: 0 } },
        y: { beginAtZero: true, ticks: { precision:0 } }
      }
    }
  });

  // Histograma de PROMEDIO
  chartHist = new Chart(document.getElementById('chartHist'), {
    type: 'bar',
    data: {
      labels: m.bins.map(b => b.label),
      datasets: [{ label: 'Estudiantes', data: m.bins.map(b => b.count) }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display:false }, tooltip: { callbacks: { label:(ctx)=>` ${ctx.parsed.y.toLocaleString('es')}` } } },
      scales: { y: { beginAtZero: true, ticks: { precision:0 } } }
    }
  });

  // Gráfico de Género
  const genderData = getGenderDistribution(selectedPeriod);
  console.log('Datos de género:', genderData); // Debug
  
  const genderCanvas = document.getElementById('chartGenero');
  if (genderCanvas && genderData.data.length > 0) {
    chartGenero = new Chart(genderCanvas, {
      type: 'doughnut',
      data: {
        labels: genderData.labels,
        datasets: [{
          data: genderData.data,
          backgroundColor: genderData.colors,
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '50%',
        plugins: {
          legend: { 
            position: 'bottom',
            labels: {
              padding: 20,
              usePointStyle: true
            }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((sum, value) => sum + value, 0);
                const percentage = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0.0';
                return ` ${ctx.label}: ${ctx.parsed.toLocaleString('es')} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  } else {
    console.log('No se puede crear gráfico de género:', {
      canvas: !!genderCanvas,
      dataLength: genderData.data.length,
      nominaDataLength: nominaData.length
    });
  }

  // Gráfico de Etnia (barras horizontales)
  const ethnicityData = getEthnicityDistribution(selectedPeriod);
  console.log('Datos de etnia:', ethnicityData); // Debug

  const ethnicityCanvas = document.getElementById('chartEtnia');
  if (ethnicityCanvas && ethnicityData.data.length > 0) {
    chartEtnia = new Chart(ethnicityCanvas, {
      type: 'bar',
      data: {
        labels: ethnicityData.labels,
        datasets: [{
          label: 'Estudiantes',
          data: ethnicityData.data,
          backgroundColor: ethnicityData.colors,
          borderWidth: 1
        }]
      },
      options: {
        indexAxis: 'y', // 👉 barras horizontales
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((sum, value) => sum + value, 0);
                const percentage = total > 0 ? ((ctx.parsed.x / total) * 100).toFixed(1) : '0.0';
                return ` ${ctx.label}: ${ctx.parsed.x.toLocaleString('es')} (${percentage}%)`;
              }
            }
          }
        },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 } },
          y: { ticks: { precision: 0 } }
        }
      }
    });
  } else {
    console.log('No se puede crear gráfico de etnia:', {
      canvas: !!ethnicityCanvas,
      dataLength: ethnicityData.data.length,
      nominaDataLength: nominaData.length
    });
  }
}

/* ===== Tablas ===== */
function renderTables(m, topDocentes) {
  const tbM = document.querySelector('#tbl-materias tbody');
  if (tbM) {
    tbM.innerHTML = m.materias.map((row,i)=>`
      <tr>
        <td>${i+1}</td>
        <td>${row.materia}</td>
        <td>${row.reprobados}</td>
        <td>${row.total}</td>
        <td>${(row.pct*100).toFixed(1)}%</td>
      </tr>
    `).join('');
  }

  const tblD  = document.querySelector('#tbl-docentes');
  const thead = tblD?.querySelector('thead');
  const tbD   = tblD?.querySelector('tbody');

  if (thead) {
    thead.innerHTML = `
      <tr>
        <th style="width:56px;">#</th>
        <th>Profesor</th>
        <th style="text-align:right;width:140px;">Reprobados</th>
        <th style="text-align:right;width:160px;">Total</th>
        <th style="text-align:right;width:160px;">% Reprobados</th>
      </tr>
    `;
  }

  if (tbD) {
    tbD.innerHTML = (topDocentes ?? []).map((x, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${x.docente}</td>
        <td style="text-align:right;">${x.rp}</td>
        <td style="text-align:right;">${x.tot}</td>
        <td style="text-align:right;">${x.pctReprob.toFixed(2)}%</td>
      </tr>
    `).join('');
  }
}

/* ===== Carga principal ===== */
async function loadReport() {
  const rows = applyFilters();

  if (!Array.isArray(rows) || !rows.length) {
    destroyCharts();
    renderKPIs({registros:0, estudiantes:0, vezCounts:{'1':0,'2':0,'3':0}});
    const tm = document.querySelector('#tbl-materias tbody');
    const td = document.querySelector('#tbl-docentes tbody');
    if (tm) tm.innerHTML = '';
    if (td) td.innerHTML = '';
    return;
  }

  const metrics     = buildMetrics(rows);
  const topDocentes = computeTop10DocentesReprobados(rows);
  renderKPIs(metrics);
  renderCharts(metrics);
  renderTables(metrics, topDocentes);
}

/* ===== Eventos ===== */
document.addEventListener('DOMContentLoaded', async () => {
  const initialSelected = await populatePeriodSelect();

  document.getElementById('btn-back').addEventListener('click', () => {
    window.location.href = '../index.html';
  });
  document.getElementById('btn-print').addEventListener('click', () => {
    window.print();
  });
  
  // Evento para cambio de período
  document.getElementById('period-select').addEventListener('change', (e) => {
    localStorage.setItem('selectedPeriod', e.target.value);
    populateCareerSelect(e.target.value);
    loadReport();
  });
  
  // Evento para cambio de carrera
  document.getElementById('career-select').addEventListener('change', (e) => {
    currentCareer = e.target.value;
    localStorage.setItem('selectedCareer', currentCareer);
    loadReport();
  });
  
  document.getElementById('materia-select')?.addEventListener('change', e => {
    currentMateria = e.target.value || '';
    localStorage.setItem('selectedMateria', currentMateria);
    loadReport();
  });

  if (initialSelected) {
    await loadReport();
  } else {
    document.getElementById('no-data').hidden = true;
  }
});