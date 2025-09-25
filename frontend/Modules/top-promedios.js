// top-promedios.js
import { loadData } from '../indexeddb-storage.js';

const KEY = 'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx';
const carreras = {
  'ENTRENAMIENTO DEPORTIVO': { alias: 'ED', niveles: {1:7, 2:7, 3:7, 4:6, 5:5, 6:5, 7:5, 8:5} },
  'PEDAGOGÍA DE LA ACTIVIDAD FÍSICA Y DEPORTE': { alias: 'PAF', niveles: {1:7, 2:7, 3:7, 4:6, 5:6, 6:5, 7:5, 8:6, 9:4} }
};

const norm = (v) => (v ?? '').toString().trim();
const asNum = (v) => { const n = Number((v ?? '').toString().replace(',', '.')); return Number.isFinite(n) ? n : null; };
const groupBy = (arr, fn) => arr.reduce((acc, item) => { const key = fn(item); (acc[key] ||= []).push(item); return acc; }, {});

function sortPeriodosDesc(periodos) {
  const roman = { 'I':1, 'II':2, 'III':3, 'IV':4 };
  const parse = (p) => {
    const s = norm(p);
    const m = s.match(/(?:(\d{4})(?:\s*[-/]\s*(\d{4}))?)\s*([IVX]+|\bI{1,3}\b|\bII\b|\bIII\b)?$/i);
    if (!m) return { y1: s, y2: '', t: 0, raw: s };
    const y1 = Number(m[1]) || 0, y2 = Number(m[2]) || y1, t = roman[norm(m[3] || '')] || 0;
    return { y1, y2, t, raw: s };
  };
  return [...periodos].sort((a, b) => {
    const A = parse(a), B = parse(b);
    return (B.y2 - A.y2) || (B.y1 - A.y1) || (B.t - A.t) || B.raw.localeCompare(A.raw);
  });
}

async function initTopPromedios() {
  const data = await loadData(KEY);
  const container = document.getElementById('top-promedios-container');
  const periodSelect = document.getElementById('periodSelect');

  if (!Array.isArray(data) || data.length === 0) {
    container.innerHTML = `<p>No hay datos disponibles.</p>`;
    return;
  }

  const periodos = sortPeriodosDesc([...new Set(data.map(r => norm(r["PERIODO"])).filter(Boolean))]);
  periodSelect.innerHTML = periodos.map(p => `<option value="${p}">${p}</option>`).join('');
  periodSelect.value = periodos[0];

  renderForPeriodo(data, periodos[0]);
  periodSelect.addEventListener('change', () => renderForPeriodo(data, periodSelect.value));
}

function renderForPeriodo(allData, periodoSeleccionado) {
  const data = allData.filter(r => norm(r["PERIODO"]) === norm(periodoSeleccionado));
  const agrupados = groupBy(data, row => norm(row["IDENTIFICACION"]));
  const resultados = {};

  Object.entries(agrupados).forEach(([id, materias]) => {
    if (!materias.length) return;

    const row = materias[0];
    const carrera = norm(row["CARRERA"]), nivel = norm(row["NIVEL"]);
    const carreraInfo = carreras[carrera];
    
    if (!carreraInfo || asNum(row["NO. VEZ"]) !== 1) return;
    
    const numEsperado = carreraInfo.niveles[nivel];
    if (!numEsperado || !materias.every(r => norm(r["NIVEL"]) === nivel) || materias.length !== numEsperado) return;

    const proms = materias.map(m => asNum(m["PROMEDIO"])).filter(n => n !== null);
    if (proms.length !== numEsperado) return;

    const promGeneral = (proms.reduce((a, b) => a + b) / proms.length).toFixed(2);
    const grupoParalelos = materias.map(m => norm(m["GRUPO/PARALELO"]));
    const total = grupoParalelos.length;
    const calcPorcentaje = (tipo) => total > 0 ? `${((grupoParalelos.filter(g => g.includes(tipo)).length / total) * 100).toFixed(2)}%` : "NO REGISTRADO%";

    const key = `${carreraInfo.alias} - Nivel ${nivel}`;
    (resultados[key] ||= []).push({
      id,
      nombre: `${norm(row["APELLIDOS"])} ${norm(row["NOMBRES"])}`,
      correo: [norm(row["CORREO_INSTITUCIONAL"]), norm(row["CORREO_PERSONAL"])].filter(Boolean).join('<br>'),
      grupo: `<strong>MA:</strong> ${calcPorcentaje("MA")}<br><strong>VE:</strong> ${calcPorcentaje("VE")}`,
      promedio: promGeneral
    });
  });

  renderResultados(resultados, periodoSeleccionado);
}

function renderResultados(resultados, periodoLabel) {
  const container = document.getElementById('top-promedios-container');
  container.innerHTML = `
    <h1>Top 5 Promedios por Carrera y Nivel [${periodoLabel}]</h1>
    <p><strong>Criterios:</strong><br>
    • Deben tener todas las asignaturas que les corresponde<br>
    • No repetidores<br>
    • No materias adelantadas/atrasadas<br>
    • Corresponde por nivel dentro de malla</p>`;

  const keysOrdenadas = Object.keys(resultados).sort((a, b) => {
    const [carA, nA] = a.split(' - Nivel ').map(v => isNaN(v) ? v : Number(v));
    const [carB, nB] = b.split(' - Nivel ').map(v => isNaN(v) ? v : Number(v));
    return carA.localeCompare(carB) || (Number(nA) - Number(nB));
  });

  if (!keysOrdenadas.length) {
    container.innerHTML += `<p>No hay estudiantes que cumplan los criterios en este periodo.</p>`;
    return;
  }

  keysOrdenadas.forEach(key => {
    const top5 = resultados[key].sort((a, b) => parseFloat(b.promedio) - parseFloat(a.promedio)).slice(0, 5);
    container.innerHTML += `
      <h2>${key}</h2>
      <table>
        <thead>
          <tr>
            <th>Identificación</th>
            <th>Nombre</th>
            <th>Correo</th>
            <th>Grupo</th>
            <th>Promedio General</th>
          </tr>
        </thead>
        <tbody>
          ${top5.map(s => `
            <tr>
              <td data-label="Identificación"><a class="table-link" href="/Modules/consulta-estudiante.html?q=${encodeURIComponent(s.id)}"title="Ver datos de ${s.nombre}">${s.id}</a></td>
              <td data-label="Nombre"><a class="table-link" href="/Modules/consulta-estudiante.html?q=${encodeURIComponent(s.nombre)}"title="Ver datos de ${s.nombre}">${s.nombre}</a></td>
              <td data-label="Correo">${s.correo}</td>
              <td data-label="Grupo">${s.grupo}</td>
              <td data-label="Promedio General">${s.promedio}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
  });
}

document.addEventListener('DOMContentLoaded', initTopPromedios);