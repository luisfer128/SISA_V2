import { loadData } from '../indexeddb-storage.js';

const DAYS = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO'];
const START_TIME = '07:00', END_TIME = '22:00', SLOT_MIN = 30;

// Elementos DOM
const elements = {
  docenteInput: document.getElementById('docenteInput'),
  docenteDropdown: document.getElementById('docenteDropdown'),
  clearBtn: document.getElementById('clearBtn'),
  heatWrap: document.getElementById('heatWrap'),
  heatLegend: document.getElementById('heatLegend'),
  heatBody: document.getElementById('heatBody'),
  schedBody: document.getElementById('schedBody'),
  schedWrap: document.getElementById('schedWrap'),
  teacherHeader: document.getElementById('teacherHeader'),
  teacherTitle: document.getElementById('teacherTitle'),
  teacherSub: document.getElementById('teacherSub'),
  chipClassHours: document.getElementById('chipClassHours'),
  chipActHours: document.getElementById('chipActHours'),
  goMenuBtn: document.getElementById('goMenu'),
  overlay: document.getElementById('loading-overlay')
};

// Utilidades
const norm = v => (v ?? '').toString().trim();
const normalizeFileName = fileName => fileName.replace(/\W+/g, "_");
const showOverlay = (msg = 'Procesando...') => {
  if (elements.overlay) {
    elements.overlay.style.display = 'flex';
    const spinner = elements.overlay.querySelector('.loading-spinner');
    if (spinner) spinner.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${msg}`;
  }
};
const hideOverlay = () => elements.overlay && (elements.overlay.style.display = 'none');

// Carga de datos
const keys = {
  clases: 'academicTrackingData_' + normalizeFileName('REPORTE_NOMINA_CARRERA_DOCENTES_MATERIA_+_HORARIOS.xlsx'),
  activ: 'academicTrackingData_' + normalizeFileName('REPORTE_DOCENTES_HORARIOS_DISTRIBITIVO.xlsx')
};

async function loadFromGuess(regex) {
  const processed = await loadData('processedFiles');
  if (!Array.isArray(processed)) return [];
  const hit = processed.find(n => regex.test(n));
  if (hit) {
    const data = await loadData('academicTrackingData_' + normalizeFileName(hit));
    if (Array.isArray(data) && data.length) return data;
  }
  return [];
}

const loadClasesData = async () => {
  let data = await loadData(keys.clases);
  return (Array.isArray(data) && data.length) ? data : await loadFromGuess(/NOMINA.*DOCENTES.*HORARIOS/i);
};

const loadActividadesData = async () => {
  let data = await loadData(keys.activ);
  return (Array.isArray(data) && data.length) ? data : await loadFromGuess(/DOCENTES.*HORARIOS.*DISTRIB/i);
};

// Manejo de tiempo
const toMinutes = hhmm => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

function* slotsRange(startHHMM, endHHMM, stepMin = SLOT_MIN) {
  for (let t = toMinutes(startHHMM), end = toMinutes(endHHMM); t < end; t += stepMin) yield t;
}

const minutesToLabel = min => `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`;

const parseRanges = cell => {
  const s = norm(cell);
  return s ? s.split(/[;,]/).map(x => x.trim()).filter(Boolean).map(part => {
    const m = part.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    if (!m) return null;
    let [, a, b] = m;
    if (a.length < 5) a = a.padStart(5, '0');
    if (b.length < 5) b = b.padStart(5, '0');
    return { start: a, end: b };
  }).filter(Boolean) : [];
};

const colorFor = (value, max) => {
  const t = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  return `hsl(${120 * (1 - t)} 60% 45%)`;
};

const buildTimeAxis = () => {
  const out = [];
  for (let m = toMinutes(START_TIME); m <= toMinutes(END_TIME); m += SLOT_MIN) {
    out.push(minutesToLabel(m));
  }
  return out;
};

// Heatmap
function buildHeatCounts(data) {
  const times = buildTimeAxis();
  const counts = Object.fromEntries(times.map(t => [t, Object.fromEntries(DAYS.map(d => [d, 0]))]));
  let max = 0;

  data.forEach(row => {
    DAYS.forEach(day => {
      parseRanges(row?.[day]).forEach(rr => {
        Array.from(slotsRange(rr.start, rr.end, SLOT_MIN)).forEach(t => {
          const label = minutesToLabel(t);
          if (counts[label]) {
            counts[label][day]++;
            max = Math.max(max, counts[label][day]);
          }
        });
      });
    });
  });

  return { counts, max, times };
}

function renderHeatTable({ counts, max, times }) {
  elements.heatBody.innerHTML = '';
  times.slice(0, -1).forEach(t => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = t;
    tr.appendChild(th);

    DAYS.forEach(day => {
      const v = counts[t][day] || 0;
      const td = document.createElement('td');
      const div = document.createElement('div');
      Object.assign(div, {
        className: 'cell',
        textContent: String(v)
      });
      Object.assign(div.style, {
        background: colorFor(v, max),
        color: '#fff'
      });
      td.appendChild(div);
      tr.appendChild(td);
    });
    elements.heatBody.appendChild(tr);
  });
}

// Autocompletado
let allDocentes = [], selectedTeacher = '', currentHighlighted = -1;

const filterDocentes = query => query.trim() ? 
  allDocentes.filter(doc => doc.toLowerCase().includes(query.toLowerCase())).slice(0, 10) : [];

const highlightMatch = (text, query) => query ? 
  text.replace(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<span class="highlight-match">$1</span>') : text;

function showDropdown(matches) {
  elements.docenteDropdown.innerHTML = '';
  const query = elements.docenteInput.value.trim();
  
  if (!matches.length) {
    elements.docenteDropdown.classList.remove('show');
    return;
  }

  matches.forEach((docente, index) => {
    const item = document.createElement('div');
    item.className = 'dropdown-item';
    item.innerHTML = highlightMatch(docente, query);
    item.setAttribute('data-docente', docente);
    item.setAttribute('data-index', index);
    
    item.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      selectTeacher(docente);
    });
    
    item.addEventListener('mouseenter', () => {
      document.querySelectorAll('.dropdown-item.highlighted').forEach(el => el.classList.remove('highlighted'));
      item.classList.add('highlighted');
      currentHighlighted = index;
    });
    
    elements.docenteDropdown.appendChild(item);
  });

  elements.docenteDropdown.classList.add('show');
}

const hideDropdown = () => {
  elements.docenteDropdown.classList.remove('show');
  currentHighlighted = -1;
};

function selectTeacher(teacher) {
  selectedTeacher = teacher;
  elements.docenteInput.value = teacher;
  elements.docenteInput.style.borderColor = '';
  hideDropdown();
  loadTeacherSchedule(teacher);
}

const updateHighlight = items => items.forEach((item, index) => 
  item.classList.toggle('highlighted', index === currentHighlighted));

function validateAndLoadTeacher() {
  const inputValue = elements.docenteInput.value.trim();
  if (!inputValue) {
    showHeatMap();
    return;
  }

  const exactMatch = allDocentes.find(doc => doc.toLowerCase() === inputValue.toLowerCase());
  if (exactMatch) {
    selectTeacher(exactMatch);
  } else {
    elements.docenteInput.style.borderColor = '#e74c3c';
    setTimeout(() => elements.docenteInput.style.borderColor = '', 2000);
  }
}

const clearSelection = () => {
  elements.docenteInput.value = '';
  selectedTeacher = '';
  hideDropdown();
  showHeatMap();
};

function showHeatMap() {
  if (elements.heatBody.children.length > 0) {
    elements.heatWrap.style.display = '';
    elements.heatLegend.style.display = '';
  }
  elements.schedWrap.style.display = 'none';
  elements.teacherHeader.style.display = 'none';
  elements.teacherSub.style.display = 'none';
}

function loadTeacherSchedule(teacher) {
  elements.heatWrap.style.display = 'none';
  elements.heatLegend.style.display = 'none';
  const M = buildTeacherMatrixUnified(dataClases || [], dataActiv || [], teacher);
  renderTeacherTableUnified(M, teacher);
}

// Horario unificado por docente
function buildTeacherMatrixUnified(dataClases, dataActiv, teacher) {
  const times = buildTimeAxis();
  const matrix = Object.fromEntries(times.map(t => 
    [t, Object.fromEntries(DAYS.map(d => [d, { classes: [], acts: [] }]))]));

  // Procesar clases
  dataClases.filter(r => norm(r.DOCENTE).toUpperCase() === norm(teacher).toUpperCase())
    .forEach(r => {
      const { MATERIA: subj = '', AULA: aula = '', GRUPO: grupo = '' } = r;
      DAYS.forEach(day => {
        parseRanges(r?.[day]).forEach(rr => {
          Array.from(slotsRange(rr.start, rr.end, SLOT_MIN)).forEach(t => {
            const label = minutesToLabel(t);
            matrix[label][day].classes.push({ subj: norm(subj), aula: norm(aula), grupo: norm(grupo) });
          });
        });
      });
    });

  // Procesar actividades (omitir HABILITADO=NO)
  dataActiv.filter(r => 
    norm(r.DOCENTE).toUpperCase() === norm(teacher).toUpperCase() &&
    norm(r.HABILITADO).toUpperCase() !== 'NO'
  ).forEach(r => {
    const gestion = norm(r.GESTIONES_VARIAS) || 'GESTIONES VARIAS';
    const actividad = norm(r.ACTIVIDADES);
    DAYS.forEach(day => {
      parseRanges(r?.[day]).forEach(rr => {
        Array.from(slotsRange(rr.start, rr.end, SLOT_MIN)).forEach(t => {
          const label = minutesToLabel(t);
          matrix[label][day].acts.push({ gestion, actividad });
        });
      });
    });
  });

  // Calcular horas
  let classSlots = 0, actSlots = 0;
  times.slice(0, -1).forEach(t => {
    DAYS.forEach(day => {
      if (matrix[t][day].classes.length > 0) classSlots++;
      if (matrix[t][day].acts.length > 0) actSlots++;
    });
  });

  const slotHours = SLOT_MIN / 60;
  return { 
    matrix, 
    times, 
    hoursClass: classSlots * slotHours, 
    hoursAct: actSlots * slotHours 
  };
}

const fmtHours = h => {
  const rounded = Math.round(h * 2) / 2;
  return Number.isInteger(rounded) ? `${rounded}H` : `${rounded.toFixed(1)}H`;
};

// Consolidación de bloques
function consolidateBlocks(matrix, times) {
  const consolidated = {};
  
  DAYS.forEach(day => {
    consolidated[day] = [];
    let i = 0;
    
    while (i < times.length - 1) {
      const currentTime = times[i];
      const currentSlot = matrix[currentTime][day];
      
      if (currentSlot.classes.length === 0 && currentSlot.acts.length === 0) {
        consolidated[day].push({ startTime: currentTime, endTime: times[i + 1], isEmpty: true, rowspan: 1 });
        i++;
        continue;
      }
      
      // Bloques de clases
      if (currentSlot.classes.length > 0) {
        const classInfo = currentSlot.classes[0];
        let endIndex = i + 1;
        
        while (endIndex < times.length - 1) {
          const nextSlot = matrix[times[endIndex]][day];
          if (nextSlot.classes.length === 0 || !isSameClass(classInfo, nextSlot.classes[0])) break;
          endIndex++;
        }
        
        consolidated[day].push({
          type: 'class', startTime: currentTime, endTime: times[endIndex], 
          rowspan: endIndex - i, data: classInfo
        });
        i = endIndex;
        continue;
      }
      
      // Bloques de actividades
      if (currentSlot.acts.length > 0) {
        const actInfo = currentSlot.acts[0];
        let endIndex = i + 1;
        
        while (endIndex < times.length - 1) {
          const nextSlot = matrix[times[endIndex]][day];
          if (nextSlot.acts.length === 0 || !isSameActivity(actInfo, nextSlot.acts[0])) break;
          endIndex++;
        }
        
        consolidated[day].push({
          type: 'activity', startTime: currentTime, endTime: times[endIndex], 
          rowspan: endIndex - i, data: actInfo
        });
        i = endIndex;
      }
    }
  });
  
  return consolidated;
}

const isSameClass = (class1, class2) => 
  class1.subj === class2.subj && class1.aula === class2.aula && class1.grupo === class2.grupo;

const isSameActivity = (act1, act2) => 
  act1.gestion === act2.gestion && act1.actividad === act2.actividad;

function renderTeacherTableUnified({ matrix, times, hoursClass, hoursAct }, teacher) {
  Object.assign(elements.teacherHeader.style, { display: '' });
  Object.assign(elements.teacherSub.style, { display: '' });
  Object.assign(elements.schedWrap.style, { display: '' });
  
  elements.teacherTitle.textContent = teacher;
  elements.chipClassHours.textContent = fmtHours(hoursClass);
  elements.chipActHours.textContent = fmtHours(hoursAct);
  elements.schedBody.innerHTML = '';

  const consolidatedBlocks = consolidateBlocks(matrix, times);
  const renderedMatrix = Object.fromEntries(times.slice(0, -1).map(t => 
    [t, Object.fromEntries(DAYS.map(d => [d, false]))]));

  // Pre-marcar celdas ocupadas
  DAYS.forEach(day => {
    consolidatedBlocks[day].forEach(block => {
      if (!block.isEmpty && block.rowspan > 1) {
        const startIndex = times.indexOf(block.startTime);
        for (let j = startIndex; j < startIndex + block.rowspan && j < times.length - 1; j++) {
          renderedMatrix[times[j]][day] = true;
        }
      }
    });
  });

  times.slice(0, -1).forEach((t, i) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = t;
    tr.appendChild(th);

    DAYS.forEach(day => {
      const block = consolidatedBlocks[day].find(b => b.startTime === t);
      
      if (block) {
        const td = document.createElement('td');
        
        if (block.isEmpty) {
          const div = document.createElement('div');
          div.className = 'slot';
          td.appendChild(div);
        } else {
          td.rowSpan = block.rowspan;
          const div = document.createElement('div');
          div.className = 'slot busy consolidated-block';
          
          const blockDiv = document.createElement('div');
          blockDiv.className = 'row';
          
          if (block.type === 'class') {
            const c = block.data;
            blockDiv.innerHTML = `
              <span class="tag class">CLASE</span>
              <div class="subj">${c.subj || 'Clase'}</div>
              <div class="meta">
                ${c.grupo ? `Grupo: ${c.grupo}` : ''}${c.grupo && c.aula ? ' · ' : ''}${c.aula ? `Aula: ${c.aula}` : ''}
              </div>
              <div class="time-range">${block.startTime} - ${block.endTime}</div>
            `;
          } else if (block.type === 'activity') {
            const a = block.data;
            blockDiv.innerHTML = `
              <span class="tag act">GESTIONES_VARIAS</span>
              <div class="subj">${a.gestion}</div>
              ${a.actividad ? `<div class="meta">Actividad: ${a.actividad}</div>` : ''}
              <div class="time-range">${block.startTime} - ${block.endTime}</div>
            `;
          }
          
          div.appendChild(blockDiv);
          td.appendChild(div);
        }
        tr.appendChild(td);
      } else if (!renderedMatrix[t][day]) {
        const td = document.createElement('td');
        const div = document.createElement('div');
        div.className = 'slot';
        td.appendChild(div);
        tr.appendChild(td);
      }
    });
    elements.schedBody.appendChild(tr);
  });
}

let dataClases = [], dataActiv = [];

// Inicialización
(async function init() {
  elements.goMenuBtn?.addEventListener('click', () => window.location.href = '../index.html');

  showOverlay('Cargando datos...');
  [dataClases, dataActiv] = await Promise.all([loadClasesData(), loadActividadesData()]);
  hideOverlay();

  if (Array.isArray(dataClases) && dataClases.length) {
    const heatData = buildHeatCounts(dataClases);
    renderHeatTable(heatData);
  } else {
    elements.heatWrap.style.display = 'none';
    elements.heatLegend.style.display = 'none';
  }

  allDocentes = Array.from(new Set([
    ...(dataClases || []).map(r => norm(r.DOCENTE)).filter(Boolean),
    ...(dataActiv || []).map(r => norm(r.DOCENTE)).filter(Boolean),
  ])).sort((a, b) => a.localeCompare(b));

  // Event listeners
  elements.docenteInput.addEventListener('input', e => {
    const query = e.target.value;
    if (query.trim()) {
      showDropdown(filterDocentes(query));
      currentHighlighted = -1;
    } else {
      hideDropdown();
      showHeatMap();
    }
  });

  elements.docenteInput.addEventListener('keydown', e => {
    const items = elements.docenteDropdown.querySelectorAll('.dropdown-item');
    
    const actions = {
      'ArrowDown': () => {
        if (items.length > 0) {
          currentHighlighted = Math.min(currentHighlighted + 1, items.length - 1);
          updateHighlight(items);
        }
      },
      'ArrowUp': () => {
        if (items.length > 0) {
          currentHighlighted = Math.max(currentHighlighted - 1, 0);
          updateHighlight(items);
        }
      },
      'Enter': () => {
        if (currentHighlighted >= 0 && items[currentHighlighted]) {
          selectTeacher(items[currentHighlighted].getAttribute('data-docente'));
        } else {
          hideDropdown();
          validateAndLoadTeacher();
        }
      },
      'Escape': hideDropdown
    };

    if (actions[e.key]) {
      e.preventDefault();
      actions[e.key]();
    }
  });

  elements.docenteInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (!elements.docenteDropdown.matches(':hover') && 
          !elements.docenteDropdown.contains(document.activeElement)) {
        hideDropdown();
        if (elements.docenteInput.value.trim()) validateAndLoadTeacher();
      }
    }, 200);
  });

  elements.docenteDropdown.addEventListener('mousedown', e => e.preventDefault());
  elements.clearBtn?.addEventListener('click', clearSelection);

  document.addEventListener('click', e => {
    if (!elements.docenteInput.contains(e.target) && !elements.docenteDropdown.contains(e.target)) {
      hideDropdown();
    }
  });
})();