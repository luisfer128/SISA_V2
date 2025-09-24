import { loadData } from '../indexeddb-storage.js';

// ---- Utilidades ----
const norm = (s) => (s ?? '').toString().trim();
const asNum = (v) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const canon = (s) => (s ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

const parsePeriodo = (p) => {
  const m = String(p).match(/(\d{4})\s*-\s*(\d{4})\s*(CI{1,2})/i);
  return m ? { a: +m[1], b: +m[2], ciclo: /CII/i.test(m[3]) ? 1 : 0 } : { a: 0, b: 0, ciclo: 0 };
};

const cmpPeriodo = (p1, p2) => {
  const A = parsePeriodo(p1), B = parsePeriodo(p2);
  return A.a - B.a || A.b - B.b || A.ciclo - B.ciclo;
};

// Colores
const colorNivel = (n) => `hsl(${({1:210, 2:0, 3:30, 4:60, 5:120, 6:280, 7:330, 8:180, 9:40}[n] ?? (n * 37) % 360)}, 72%, 50%)`;
const getHeatmapColor = (percentage, maxPercentage) => `hsl(${120 * (1 - percentage / maxPercentage)}, 70%, 50%)`;

// ========= Horario del Estudiante =========
const generarHorarioEstudiante = (recordsEstudiante, horariosData) => {
  const periodos = [...new Set(recordsEstudiante.map(r => r.PERIODO))].sort(cmpPeriodo);
  const ultimoPeriodo = periodos[periodos.length - 1];
  if (!ultimoPeriodo) return null;

  const materiasUltimoPeriodo = recordsEstudiante
    .filter(r => r.PERIODO === ultimoPeriodo)
    .map(r => ({ materia: norm(r.MATERIA), grupo: norm(r['GRUPO/PARALELO']) }));

  const horariosEstudiante = materiasUltimoPeriodo.map(({ materia, grupo }) => {
    const horario = horariosData.find(h => 
      norm(h.MATERIA) === materia && norm(h.GRUPO) === grupo && norm(h.PERIODO) === ultimoPeriodo
    );
    return horario ? {
      materia, grupo,
      docente: norm(horario.DOCENTE),
      horarios: Object.fromEntries(['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO']
        .map(dia => [dia, norm(horario[dia])]))
    } : null;
  }).filter(Boolean);

  return horariosEstudiante.length ? { periodo: ultimoPeriodo, materias: horariosEstudiante } : null;
};

const renderHorarioEstudiante = (horarioData) => {
  if (!horarioData?.materias?.length) {
    return `<div class="chart-section" style="margin-top: 20px;"><h3>Horario del Último Período</h3><p class="muted">No se encontró información de horario.</p></div>`;
  }

  const dias = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
  const diasDisplay = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  const parseHorario = (horarioStr) => {
    if (!horarioStr || horarioStr === '-') return [];
    return horarioStr.split(',').flatMap(h => {
      const match = h.trim().match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
      if (!match) return [];
      const [, h1, m1, h2, m2] = match;
      const inicio = parseInt(h1) * 60 + parseInt(m1);
      const fin = parseInt(h2) * 60 + parseInt(m2);
      const intervalos = [];
      for (let minutos = inicio; minutos < fin; minutos += 60) {
        intervalos.push(`${Math.floor(minutos / 60).toString().padStart(2, '0')}:00`);
      }
      return intervalos;
    });
  };

  const todasLasHoras = Array.from({length: 16}, (_, i) => `${(i + 7).toString().padStart(2, '0')}:00`);
  
  // Mapear horarios
  const horarioMap = {};
  horarioData.materias.forEach(materia => {
    dias.forEach(dia => {
      parseHorario(materia.horarios[dia]).forEach(intervalo => {
        (horarioMap[dia] ||= {})[intervalo] ||= [];
        horarioMap[dia][intervalo].push(materia);
      });
    });
  });

  const agruparBloques = (dia, horas) => {
    const bloques = [];
    let bloqueActual = null;
    
    horas.forEach(hora => {
      const materiasEnHora = horarioMap[dia]?.[hora] || [];
      
      if (materiasEnHora.length === 0) {
        if (bloqueActual) { bloques.push(bloqueActual); bloqueActual = null; }
        bloques.push({ tipo: 'vacio', hora, rowspan: 1 });
      } else if (materiasEnHora.length === 1) {
        const materia = materiasEnHora[0];
        if (bloqueActual?.materia.materia === materia.materia && bloqueActual?.materia.grupo === materia.grupo) {
          bloqueActual.rowspan++;
          bloqueActual.horaFin = hora;
        } else {
          if (bloqueActual) bloques.push(bloqueActual);
          bloqueActual = { tipo: 'materia', materia, hora, horaFin: hora, rowspan: 1 };
        }
      } else {
        if (bloqueActual) { bloques.push(bloqueActual); bloqueActual = null; }
        bloques.push({ tipo: 'multiple', materias: materiasEnHora, hora, rowspan: 1 });
      }
    });
    
    if (bloqueActual) bloques.push(bloqueActual);
    return bloques;
  };

  const bloquesPorDia = {};
  dias.forEach(dia => { bloquesPorDia[dia] = agruparBloques(dia, todasLasHoras); });

  const horasOcupadas = new Set();
  Object.values(bloquesPorDia).forEach(bloques => {
    bloques.forEach(bloque => {
      if (bloque.tipo !== 'vacio') {
        horasOcupadas.add(bloque.hora);
        if (bloque.rowspan > 1) {
          const inicioIndex = todasLasHoras.indexOf(bloque.hora);
          for (let i = 0; i < bloque.rowspan; i++) {
            const hora = todasLasHoras[inicioIndex + i];
            if (hora) horasOcupadas.add(hora);
          }
        }
      }
    });
  });

  const ultimaHora = horasOcupadas.size > 0 ? [...horasOcupadas].sort().pop() : '07:00';
  const horasAMostrar = todasLasHoras.slice(0, Math.min(todasLasHoras.indexOf(ultimaHora) + 3, todasLasHoras.length));

  const crearCeldaMateria = (materia, alturaMinima) => `
    <div style="background: color-mix(in srgb, var(--accent) 20%, transparent); border: 2px solid var(--accent); border-radius: 10px; padding: 12px 10px; font-size: 12px; line-height: 1.4; height: calc(100% - 8px); min-height: ${alturaMinima - 8}px; display: flex; flex-direction: column; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); word-wrap: break-word;">
      <div style="font-weight: 700; color: var(--text); margin-bottom: 10px; font-size: 13px; text-align: center; line-height: 1.3;">${materia.materia}</div>
      <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 6px; text-align: center;">Grupo: ${materia.grupo}</div>
      <div style="color: var(--accent); font-size: 10px; font-weight: 600; margin-top: 6px; text-align: center; font-style: italic;">Docente: ${materia.docente}</div>
    </div>`;

  const bloquesRenderizados = {};
  dias.forEach(dia => { bloquesRenderizados[dia] = {}; });

  let tablaHorario = `
    <div class="chart-section" style="margin-top: 20px;">
      <h3>Horario del Período ${horarioData.periodo}</h3>
      <div style="overflow-x: auto; width: 100%;">
        <table class="striped" style="width: 100%; border-collapse: collapse;">
          <thead><tr><th style="text-align: center; min-width: 80px; font-weight: 700;">Hora</th>
          ${diasDisplay.map(dia => `<th style="text-align: center; min-width: 143px; font-weight: 700;">${dia}</th>`).join('')}</tr></thead><tbody>`;

  horasAMostrar.forEach(hora => {
    tablaHorario += '<tr><td style="font-weight: 600; text-align: center; background: color-mix(in srgb, var(--card) 96%, transparent); border-right: 2px solid var(--border); padding: 12px 8px;">' + hora + '</td>';
    
    dias.forEach(dia => {
      const bloque = bloquesPorDia[dia].find(b => b.hora === hora || 
        (b.rowspan > 1 && todasLasHoras.indexOf(b.hora) <= todasLasHoras.indexOf(hora) && 
         todasLasHoras.indexOf(b.hora) + b.rowspan > todasLasHoras.indexOf(hora)));
      
      if (bloque?.hora === hora && !bloquesRenderizados[dia][bloque.hora]) {
        bloquesRenderizados[dia][bloque.hora] = true;
        const alturaMinima = bloque.rowspan * 60;
        let contenidoCelda = '';
        
        if (bloque.tipo === 'materia') {
          contenidoCelda = crearCeldaMateria(bloque.materia, alturaMinima);
        } else if (bloque.tipo === 'multiple') {
          contenidoCelda = bloque.materias.map(materia => `
            <div style="background: color-mix(in srgb, var(--accent) 15%, transparent); border: 1px solid var(--accent); border-radius: 8px; padding: 10px 8px; margin: 4px 0; font-size: 11px; line-height: 1.3; word-wrap: break-word;">
              <div style="font-weight: 600; color: var(--text); margin-bottom: 4px; text-align: center; line-height: 1.2;">${materia.materia}</div>
              <div style="color: var(--text-secondary); font-size: 10px; text-align: center; margin-bottom: 3px;">Gr: ${materia.grupo}</div>
              <div style="color: var(--accent); font-size: 9px; text-align: center; font-style: italic;">Docente: ${materia.docente}</div>
            </div>`).join('');
        }
        
        tablaHorario += `<td style="padding: 4px; vertical-align: middle; min-width: 140px; text-align: center; border-left: 1px solid var(--border); height: ${alturaMinima}px;" rowspan="${bloque.rowspan}">${contenidoCelda}</td>`;
      } else if (!bloque || (bloque?.hora !== hora && todasLasHoras.indexOf(bloque.hora) > todasLasHoras.indexOf(hora))) {
        const hayBloqueAnterior = bloquesPorDia[dia].some(b => 
          b.rowspan > 1 && todasLasHoras.indexOf(b.hora) < todasLasHoras.indexOf(hora) &&
          todasLasHoras.indexOf(b.hora) + b.rowspan > todasLasHoras.indexOf(hora));
        
        if (!hayBloqueAnterior) {
          tablaHorario += '<td style="padding: 15px 8px; vertical-align: middle; min-width: 140px; border-left: 1px solid var(--border); background: color-mix(in srgb, var(--muted) 5%, transparent); height: 60px;"></td>';
        }
      }
    });
    tablaHorario += '</tr>';
  });

  return tablaHorario + `</tbody></table></div>
    <span style="color: var(--primary); font-size: 16px; font-weight: 600; display: block; margin-top: 15px;">Materias del Período:</span>
    <div style="margin-top: 20px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
      ${horarioData.materias.map(materia => `
        <div style="padding: 12px 16px; background: color-mix(in srgb, var(--card) 96%, transparent); border: 1px solid var(--border); border-radius: 8px; font-size: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div style="font-weight: 600; color: var(--text); margin-bottom: 3px; line-height: 1.3; font-size: 13px;">${materia.materia}</div>
          <div class="muted" style="font-size: 11px; line-height: 1.3;">
            <div style="margin-bottom: 1px;">Grupo: ${materia.grupo}</div>
            <div>Docente: ${materia.docente}</div>
          </div>
        </div>`).join('')}
    </div>`;
};

// ========= Sistema de Autocompletado =========
const initStudentAutocomplete = (dataFiltrada, input, onSearch) => {
  const listaEstudiantes = [...new Map(
    dataFiltrada.map(record => {
      const id = record.IDENTIFICACION;
      const nombres = `${record.APELLIDOS || ''} ${record.NOMBRES || ''}`.trim();
      return id && nombres ? [id, {
        id, nombre: nombres, canonNombre: canon(nombres),
        correo: record.CORREO_INSTITUCIONAL || record.CORREO_PERSONAL || '',
        carrera: record.CARRERA || ''
      }] : null;
    }).filter(Boolean)
  ).values()];

  const dropdown = document.createElement('div');
  dropdown.className = 'autocomplete-dropdown';
  dropdown.style.cssText = `position: absolute; top: 100%; left: 0; right: 0; background: var(--card, white); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); z-index: 1000; max-height: 300px; overflow-y: auto; display: none; margin-top: 4px;`;

  const container = input.parentElement;
  container.style.position = container.style.position || 'relative';
  container.appendChild(dropdown);

  const showDropdown = (estudiantes) => {
    dropdown.innerHTML = '';
    if (!estudiantes.length) { dropdown.style.display = 'none'; return; }

    estudiantes.slice(0, 10).forEach((estudiante, index) => {
      const item = document.createElement('div');
      item.style.cssText = `padding: 12px 16px; cursor: pointer; border-bottom: 1px solid var(--border); font-size: 14px; transition: all 0.15s ease; ${index === estudiantes.slice(0, 10).length - 1 ? 'border-bottom: none;' : ''}`;
      item.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 2px;">${estudiante.nombre}</div>
        <div style="font-size: 12px; color: var(--muted); opacity: 0.9;">ID: ${estudiante.id} • ${estudiante.carrera}</div>`;

      ['mouseenter', 'mouseleave'].forEach(event => {
        item.addEventListener(event, () => {
          item.style.backgroundColor = event === 'mouseenter' ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent';
        });
      });

      item.addEventListener('click', () => {
        input.value = estudiante.nombre;
        dropdown.style.display = 'none';
        onSearch();
      });

      dropdown.appendChild(item);
    });
    dropdown.style.display = 'block';
  };

  const filterEstudiantes = (query) => {
    if (!query || query.length < 2) return [];
    const queryCanon = canon(query);
    return listaEstudiantes.filter(est => est.id.includes(query.trim()) || est.canonNombre.includes(queryCanon));
  };

  // Event listeners
  input.addEventListener('input', e => {
    const query = e.target.value;
    query.length >= 2 ? showDropdown(filterEstudiantes(query)) : (dropdown.style.display = 'none');
  });

  input.addEventListener('blur', () => setTimeout(() => dropdown.style.display = 'none', 200));
  input.addEventListener('focus', e => {
    const query = e.target.value;
    if (query.length >= 2) showDropdown(filterEstudiantes(query));
  });

  input.addEventListener('keydown', e => {
    const items = dropdown.querySelectorAll('div');
    let current = dropdown.querySelector('.selected');
    
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      if (current) current.classList.remove('selected');
      
      if (e.key === 'ArrowDown') {
        const next = current ? items[Array.from(items).indexOf(current) + 1] || items[0] : items[0];
        if (next) next.classList.add('selected');
      } else {
        const prev = current ? items[Array.from(items).indexOf(current) - 1] || items[items.length - 1] : items[items.length - 1];
        if (prev) prev.classList.add('selected');
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      current ? current.click() : onSearch();
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
      input.blur();
    }
  });
};

// ========= Funciones de Gráficos =========
const promedioPorNivel = (data) => {
  const perNiv = {};
  data.forEach(e => {
    const per = e.PERIODO, niv = e.NIVEL, pr = asNum(e.PROMEDIO);
    if (per && niv && pr !== null) ((perNiv[per] ||= {})[niv] ||= []).push(pr);
  });

  const labels = Object.keys(perNiv).sort(cmpPeriodo);
  const niveles = [...new Set(data.map(d => d.NIVEL))].sort((a, b) => a - b);
  
  return {
    labels,
    datasets: niveles.map(niv => ({
      label: `Nivel ${niv}`,
      data: labels.map(p => {
        const arr = perNiv[p]?.[niv] || [];
        return arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null;
      }),
      spanGaps: true, tension: 0.3, borderWidth: 2,
      borderColor: colorNivel(niv), backgroundColor: colorNivel(niv),
      pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: '#fff', pointBorderWidth: 2
    }))
  };
};

const crearGraficoLinea = (canvasId, data, titulo = '') => {
  const opciones = {
    responsive: true,
    interaction: { mode: 'dataset', intersect: false },
    hover: { mode: 'dataset', intersect: false },
    plugins: {
      ...(titulo && { title: { display: true, text: titulo } }),
      legend: { position: 'bottom' },
      tooltip: {
        title: (items) => items?.[0]?.dataset?.label ?? '',
        callbacks: {
          label: (ctx) => `${data.labels[ctx.dataIndex]}: ${ctx.parsed.y ?? '-'}`,
          labelColor: (ctx) => ({ borderColor: ctx.dataset.borderColor, backgroundColor: ctx.dataset.backgroundColor })
        },
        displayColors: true
      }
    },
    elements: { line: { borderWidth: 2 }, point: { radius: 4, hoverRadius: 6, backgroundColor: '#fff', borderWidth: 2 } },
    scales: { y: { beginAtZero: false, grace: '5%' } }
  };
  new Chart(document.getElementById(canvasId), { type: 'line', data, options: opciones });
};

const calcularMatrizReprobados = (data) => {
  const materias = [...new Set(data.map(d => d.MATERIA))].sort();
  const periodos = [...new Set(data.map(d => d.PERIODO))].sort(cmpPeriodo);
  const matrix = materias.map(() => Array(periodos.length).fill(0));
  const totalPorPeriodo = Array(periodos.length).fill(0);
  
  data.forEach(d => {
    if (d.ESTADO === 'REPROBADA') {
      const i = materias.indexOf(d.MATERIA), j = periodos.indexOf(d.PERIODO);
      if (i !== -1 && j !== -1) { matrix[i][j]++; totalPorPeriodo[j]++; }
    }
  });
  
  for (let j = 0; j < periodos.length; j++) {
    const tot = totalPorPeriodo[j] || 1;
    for (let i = 0; i < materias.length; i++) matrix[i][j] = Math.round((matrix[i][j] / tot) * 100);
  }
  
  return { matrix, materias, periods: periodos };
};

const drawBubbleHeatmap = (canvasId, title, m) => {
  const maxPct = Math.max(...m.matrix.flat(), 1);
  const pts = [];
  
  m.periods.forEach((per, j) => {
    m.materias.forEach((mat, i) => {
      const v = m.matrix[i][j];
      if (v > 0) {
        const color = getHeatmapColor(v, maxPct);
        pts.push({ x: per, y: mat, r: (v / maxPct) * 25 + 5, v, backgroundColor: color, borderColor: color });
      }
    });
  });
  
  const canvas = document.getElementById(canvasId);
  canvas.height = Math.max(400, m.materias.length * 25);
  
  new Chart(canvas, {
    type: 'bubble',
    data: { datasets: [{ label: '% Reprobados', data: pts }] },
    options: {
      responsive: false,
      plugins: {
        title: { display: true, text: title },
        tooltip: { 
          callbacks: { 
            title: (it) => `${it[0].raw.y} — ${it[0].raw.x}`,
            label: (it) => `${it.raw.v}%`,
            labelColor: (ctx) => ({ borderColor: ctx.raw.borderColor, backgroundColor: ctx.raw.backgroundColor })
          }
        }
      },
      scales: {
        x: { type: 'category', labels: m.periods },
        y: { type: 'category', labels: m.materias }
      },
      elements: {
        point: {
          backgroundColor: ctx => ctx.raw?.backgroundColor || '#999',
          borderColor: ctx => ctx.raw?.borderColor || '#999'
        }
      }
    }
  });
};

// ========= CÓDIGO PRINCIPAL =========
document.addEventListener('DOMContentLoaded', async () => {
  // Elementos DOM
  const elementos = {
    chartDistribucion: document.getElementById('chartDistribucionPromedios'),
    studentFilter: document.getElementById('studentFilter'),
    searchButton: document.getElementById('searchButton'),
    clearButton: document.getElementById('clearButton'),
    backButton: document.getElementById('goToMenuButton'),
    secciones: {
      distribucion: document.getElementById('sectionDistribucion'),
      promedioNivel: document.getElementById('sectionPromedioNivel'),
      heatmaps: document.getElementById('sectionHeatmaps')
    },
    estudiante: {
      details: document.getElementById('studentDetails'),
      infoBody: document.getElementById('studentInfoBody'),
      heading: document.getElementById('studentHeading'),
      accordion: document.getElementById('studentAccordion'),
      lineCanvas: document.getElementById('chartEstudianteLine'),
      barsCanvas: document.getElementById('chartEstudianteBars')
    }
  };

  // Cargar datos
  const [allData, horariosData, estudiantesData] = await Promise.all([
    loadData('academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx'),
    loadData('academicTrackingData_REPORTE_NOMINA_CARRERA_DOCENTES_MATERIA___HORARIOS_xlsx'),
    loadData('academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx')
  ]);

  if (!Array.isArray(allData)) {
    console.error("❌ No se pudo cargar data principal");
    return;
  }

  // Procesar estudiantes
  const estudiantesMap = new Map();
  if (Array.isArray(estudiantesData)) {
    estudiantesData.forEach(est => {
      const id = norm(est.IDENTIFICACION);
      if (!id) return;
      
      let edad = null;
      const fechaNacimiento = norm(est['FECHA NACIMIENTO']);
      if (fechaNacimiento && fechaNacimiento.includes('/')) {
        const [dia, mes, año] = fechaNacimiento.split('/');
        const fechaNac = new Date(`${año}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`);
        if (!isNaN(fechaNac.getTime())) {
          const hoy = new Date();
          edad = hoy.getFullYear() - fechaNac.getFullYear();
          if (hoy.getMonth() < fechaNac.getMonth() || 
              (hoy.getMonth() === fechaNac.getMonth() && hoy.getDate() < fechaNac.getDate())) {
            edad--;
          }
        }
      }
      
      estudiantesMap.set(id, {
        sexo: norm(est.SEXO), etnia: norm(est.ETNIA), discapacidad: norm(est.DISCAPACIDAD),
        porcentajeDiscapacidad: norm(est['PORCENTAJE DISCAPACIDAD']), numeroHijos: norm(est['NUMERO HIJOS']),
        fechanac: fechaNacimiento, edad, ciudadResidencia: norm(est['CIUDAD RESIDENCIA'])
      });
    });
  }

  elementos.backButton?.addEventListener('click', () => window.location.href = '../index.html');

  // Filtrar datos
  const ESTADOS_PERMITIDOS = new Set(['APROBADA', 'REPROBADA']);
  const DOCENTES_EXCLUIDOS = new Set(['MOVILIDAD']);
  const MATERIAS_EXCLUIR = [/^INGLES\s+(I|II|III|IV)\b$/];
  
  const dataFiltrada = allData.filter(r => 
    ESTADOS_PERMITIDOS.has(canon(r.ESTADO)) &&
    !DOCENTES_EXCLUIDOS.has(canon(r.DOCENTE)) &&
    !MATERIAS_EXCLUIR.some(rx => rx.test(canon(r.MATERIA)))
  );

  initStudentAutocomplete(dataFiltrada, elementos.studentFilter, buscar);

  // Calcular promedios generales por estudiante
  const estudiantesPorPeriodo = {};
  dataFiltrada.forEach(e => {
    const { IDENTIFICACION: id, PERIODO: per, PROMEDIO: pr } = e;
    const promedio = asNum(pr);
    if (id && per && promedio !== null) {
      ((estudiantesPorPeriodo[id] ||= {})[per] ||= []).push(promedio);
    }
  });

  const promediosGenerales = Object.values(estudiantesPorPeriodo).map(perMap => {
    const ultimoPer = Object.keys(perMap).sort(cmpPeriodo).reverse()[0];
    const arr = perMap[ultimoPer] || [];
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  });

  // Gráfico distribución
  const distribucion = new Array(10).fill(0);
  promediosGenerales.forEach(p => distribucion[Math.min(Math.floor(p), 9)]++);

  new Chart(elementos.chartDistribucion, {
    type: 'bar',
    data: { 
      labels: ['0–1','1–2','2–3','3–4','4–5','5–6','6–7','7–8','8–9','9–10'], 
      datasets: [{ label: 'Cantidad de estudiantes', data: distribucion }] 
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });

  // Gráficos de línea
  crearGraficoLinea('chartPromedioPorNivel', promedioPorNivel(dataFiltrada));
  crearGraficoLinea('chartPedagogia', promedioPorNivel(dataFiltrada.filter(e => e.CARRERA === 'PEDAGOGÍA DE LA ACTIVIDAD FÍSICA Y DEPORTE')));
  crearGraficoLinea('chartEntrenamiento', promedioPorNivel(dataFiltrada.filter(e => e.CARRERA === 'ENTRENAMIENTO DEPORTIVO')));

  // Heatmaps
  drawBubbleHeatmap('heatmapGeneral', 'Heatmap General % Reprobados (Normalizado)', calcularMatrizReprobados(dataFiltrada));
  drawBubbleHeatmap('heatmapPAF', 'PAF % Reprobados (Normalizado)', calcularMatrizReprobados(dataFiltrada.filter(d => d.CARRERA === 'PEDAGOGÍA DE LA ACTIVIDAD FÍSICA Y DEPORTE')));
  drawBubbleHeatmap('heatmapEntrenamiento', 'Entrenamiento Deportivo % Reprobados (Normalizado)', calcularMatrizReprobados(dataFiltrada.filter(d => d.CARRERA === 'ENTRENAMIENTO DEPORTIVO')));

  // Variables para gráficos del estudiante
  let lineChart = null, barsChart = null;

  const showGeneralView = () => {
    Object.values(elementos.secciones).forEach(s => s.style.display = '');
    elementos.estudiante.details.style.display = 'none';
    [lineChart, barsChart].forEach(chart => { if (chart) { chart.destroy(); } });
    lineChart = barsChart = null;
  };

  const showStudentView = () => {
    Object.values(elementos.secciones).forEach(s => s.style.display = 'none');
    elementos.estudiante.details.style.display = '';
  };

  const pickStudentRecords = (q) => {
    const qCanon = canon(q);
    if (!qCanon) return null;
    
    const filters = [
      r => canon(r.IDENTIFICACION) === qCanon,
      r => canon(`${r.APELLIDOS} ${r.NOMBRES}`) === qCanon,
      r => canon(`${r.APELLIDOS} ${r.NOMBRES}`).includes(qCanon),
      r => String(r.IDENTIFICACION || '').includes(q)
    ];
    
    for (const filter of filters) {
      const results = dataFiltrada.filter(filter);
      if (results.length) return results;
    }
    return null;
  };

  const renderStudent = (records) => {
    const first = records[0];
    const nombre = `${norm(first.APELLIDOS)} ${norm(first.NOMBRES)}`.trim();
    const cedula = norm(first.IDENTIFICACION);
    const correos = [...new Set(records.flatMap(r => [norm(r.CORREO_INSTITUCIONAL), norm(r.CORREO_PERSONAL)]).filter(Boolean))].join(', ').toLowerCase();
    const telefono = norm(first.CELULAR);
    const carrera = norm(first.CARRERA);
    const aprobadas = records.filter(r => canon(r.ESTADO) === 'APROBADA').length;
    const reprobadas = records.filter(r => canon(r.ESTADO) === 'REPROBADA').length;

    const datosAdicionales = estudiantesMap.get(cedula) || {};
    const {
      sexo = '-', etnia = '-', discapacidad = '-', porcentajeDiscapacidad = '',
      numeroHijos = '-', fechanac: fechaNacimiento = '-', edad = '-', ciudadResidencia = '-'
    } = datosAdicionales;

    const discapacidadCompleta = discapacidad !== '-' && porcentajeDiscapacidad 
      ? `${discapacidad} (${porcentajeDiscapacidad}%)` : discapacidad;

    const periodos = [...new Set(records.map(r => r.PERIODO))].sort(cmpPeriodo);
    const todosLosPromedios = records.map(r => asNum(r.PROMEDIO)).filter(v => v !== null);
    const promedioGeneral = todosLosPromedios.length 
      ? (todosLosPromedios.reduce((a, b) => a + b, 0) / todosLosPromedios.length) : null;

    elementos.estudiante.heading.textContent = `Datos Generales de ${nombre}`;
    const fotoUrl = `http://67.205.132.245/get_photoSIUG.php?cedula=${cedula}`;
    
    elementos.estudiante.infoBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 20px 10px; background: color-mix(in srgb, var(--card) 98%, transparent);">
          <div style="display: flex; align-items: flex-start; gap: 25px; justify-content: center; flex-wrap: wrap;">
            <div style="flex-shrink: 0; margin-left: 40px;">
              <style>
                .logo-container .logo-light { display: block; }
                .logo-container .logo-dark { display: none; }
                .dark-mode .logo-container .logo-light,
                html.dark-mode .logo-container .logo-light { display: none; }
                .dark-mode .logo-container .logo-dark,
                html.dark-mode .logo-container .logo-dark { display: block; }
              </style>
              <div class="logo-container">
                <img src="../recursos/FACAF-CUADRADO.png" style="width: 200px; height: 200px; object-fit: contain;" alt="Logo FACAF" class="logo-light" />
                <img src="../recursos/FACAF-CUADRADO-NEGATIVO.png" style="width: 200px; height: 200px; object-fit: contain;" alt="Logo FACAF" class="logo-dark" />
              </div>
            </div>
            
            <div style="flex-shrink: 0;">
              <img src="${fotoUrl}" width="150px" style="border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border: 3px solid var(--border); object-fit: cover; height: 180px; width: 150px;" alt="Foto de ${nombre}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
              <div style="display: none; width: 150px; height: 180px; background: color-mix(in srgb, var(--muted) 20%, transparent); border: 2px dashed var(--border); border-radius: 12px; align-items: center; justify-content: center; color: var(--muted-foreground); font-size: 12px; text-align: center; flex-direction: column; gap: 8px;">
                <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 1H5C3.89 1 3 1.89 3 3V19A2 2 0 0 0 5 21H19A2 2 0 0 0 21 19V9M19 9H14V4H19V9Z"/></svg>
                <span>Foto no<br/>disponible</span>
              </div>
            </div>
            
            <div style="flex: 1; min-width: 300px; text-align: left;">
              <h3 style="margin: 0 0 20px 0; color: var(--primary); font-size: 22px; font-weight: 700; text-transform: uppercase;">${nombre}</h3>
              <div style="display: grid; grid-template-columns: auto 1fr; gap: 12px 20px; font-size: 15px;">
                <span style="font-weight: 700; color: var(--primary); font-size: 16px;">Cédula:</span>
                <span style="color: var(--text); font-weight: 600; font-size: 16px;">${cedula || '-'}</span>
                <span style="font-weight: 700; color: var(--primary);">Carrera:</span>
                <span style="color: var(--text); font-weight: 500;">${carrera || '-'}</span>
                <span style="font-weight: 700; color: var(--primary);">Promedio General:</span>
                <span style="color: var(--primary); font-weight: 700; font-size: 16px;">${promedioGeneral !== null ? promedioGeneral.toFixed(2) : '-'}</span>
                <span style="font-weight: 700; color: var(--primary);">Aprobadas / Reprobadas:</span>
                <span style="color: var(--text); font-weight: 600;">${aprobadas} / <span style="color: var(--destructive); font-weight: 700;">${reprobadas}</span></span>
              </div>
            </div>
          </div>
        </td>
      </tr>
      <tr><th style="width:160px;">Correos</th><td colspan="3">${correos || '-'}</td></tr>
      <tr><th>Teléfono</th><td>${telefono || '-'}</td><th>Sexo</th><td>${sexo}</td></tr>
      <tr><th>Fecha Nacimiento</th><td>${fechaNacimiento}</td><th>Edad</th><td>${edad}</td></tr>
      <tr><th>Ciudad Residencia</th><td>${ciudadResidencia}</td><th>Etnia</th><td>${etnia}</td></tr>
      <tr><th>Discapacidad</th><td>${discapacidadCompleta}</td><th>Número de Hijos</th><td>${numeroHijos}</td></tr>`;

    // Gráficos del estudiante
    const promsPorPeriodo = periodos.map(p => {
      const arr = records.filter(r => r.PERIODO === p).map(r => asNum(r.PROMEDIO)).filter(v => v !== null);
      return arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null;
    });

    if (lineChart) lineChart.destroy();
    lineChart = new Chart(elementos.estudiante.lineCanvas, {
      type: 'line',
      data: {
        labels: periodos,
        datasets: [{
          label: 'Promedio',
          data: promsPorPeriodo,
          spanGaps: true, tension: 0.3, borderWidth: 2,
          borderColor: 'hsl(210, 72%, 50%)', backgroundColor: 'hsl(210, 72%, 50%)',
          pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: '#fff', pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        interaction: { mode: 'dataset', intersect: false },
        hover: { mode: 'dataset', intersect: false },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            title: (items) => items?.[0]?.dataset?.label ?? '',
            callbacks: { label: (ctx) => `${periodos[ctx.dataIndex]}: ${ctx.parsed.y ?? '-'}` }
          }
        },
        scales: { y: { beginAtZero: false, grace: '5%' } }
      }
    });

    const aprobadasPer = periodos.map(p => records.filter(r => r.PERIODO === p && canon(r.ESTADO) === 'APROBADA').length);
    const reprobadasPer = periodos.map(p => records.filter(r => r.PERIODO === p && canon(r.ESTADO) === 'REPROBADA').length);
    
    if (barsChart) barsChart.destroy();
    barsChart = new Chart(elementos.estudiante.barsCanvas, {
      type: 'bar',
      data: {
        labels: periodos,
        datasets: [
          { label: 'Aprobadas', data: aprobadasPer, backgroundColor: 'hsl(210, 72%, 55%)' },
          { label: 'Reprobadas', data: reprobadasPer, backgroundColor: 'hsl(0, 72%, 60%)' }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
      }
    });

    // Acordeón de períodos
    elementos.estudiante.accordion.innerHTML = '';
    [...periodos].sort(cmpPeriodo).reverse().forEach(p => {
      const rows = records.filter(r => r.PERIODO === p);
      const idx = periodos.indexOf(p);
      const prom = promsPorPeriodo[idx];
      const htmlRows = rows.map(r => `
        <tr>
          <td>${norm(r.NIVEL)}</td>
          <td>${norm(r.MATERIA)}</td>
          <td>${norm(r['GRUPO/PARALELO'])}</td>
          <td>${norm(r.DOCENTE).split(' - ').pop()}</td>
          <td>${asNum(r.PROMEDIO) ?? '-'}</td>
          <td>${norm(r['NO. VEZ'])}</td>
          <td>${norm(r.ESTADO)}</td>
        </tr>`).join('');
      
      const details = document.createElement('details');
      details.style.marginBottom = '10px';
      details.innerHTML = `
        <summary style="cursor:pointer;font-weight:600;">${p} — Promedio: ${prom !== null ? prom.toFixed(2) : '-'}</summary>
        <div style="overflow:auto;margin-top:8px;">
          <table class="striped">
            <thead><tr><th>Nivel</th><th>Materia</th><th>Grupo</th><th>Docente</th><th>Promedio</th><th>Vez</th><th>Estado</th></tr></thead>
            <tbody>${htmlRows}</tbody>
          </table>
        </div>`;
      elementos.estudiante.accordion.appendChild(details);
    });

    // Horario
    if (horariosData?.length) {
      const horarioEstudiante = generarHorarioEstudiante(records, horariosData);
      const horarioContainer = document.getElementById('horarioContainer') || 
                              (() => {
                                const div = document.createElement('div');
                                div.id = 'horarioContainer';
                                elementos.estudiante.accordion.parentNode.appendChild(div);
                                return div;
                              })();
      horarioContainer.innerHTML = renderHorarioEstudiante(horarioEstudiante);
    }

    setTimeout(() => window.dispatchEvent(new CustomEvent('student-rendered')), 100);
  };

  function buscar() {
    const q = elementos.studentFilter.value.trim();
    if (!q) { reset(); return; }
    
    const records = pickStudentRecords(q);
    if (!records?.length) {
      alert('No se encontró el estudiante.');
      return;
    }
    
    showStudentView();
    renderStudent(records);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reset() {
    elementos.studentFilter.value = '';
    
    const dropdown = document.querySelector('.autocomplete-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    
    const horarioContainer = document.getElementById('horarioContainer');
    if (horarioContainer) horarioContainer.innerHTML = '';
    
    Object.values(elementos.secciones).forEach(s => s.style.display = '');
    elementos.estudiante.details.style.display = 'none';
    
    [lineChart, barsChart].forEach(chart => { if (chart) { chart.destroy(); } });
    lineChart = barsChart = null;
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Event listeners
  elementos.clearButton.addEventListener('click', reset);
  elementos.studentFilter.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') buscar();
    if (e.key === 'Escape') reset();
  });
  elementos.studentFilter.addEventListener('input', () => {
    if (elementos.studentFilter.value.trim() === '') showGeneralView();
  });
  elementos.searchButton?.addEventListener('click', buscar);
});