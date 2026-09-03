// ============================================
// FIREBASE CONFIG
// ============================================
const firebaseConfig = {
  apiKey: "AIzaSyBQNZNKtm1H13dBOVMxASshPeZgbQCPkrg",
  authDomain: "base-de-datos-1-880b2.firebaseapp.com",
  projectId: "base-de-datos-1-880b2",
  storageBucket: "base-de-datos-1-880b2.firebasestorage.app",
  messagingSenderId: "119206858948",
  appId: "1:119206858948:web:4ac0339a061da74b63b991"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Colecciones
const COL_GUIAS = 'guias';           // doc ID = AWB normalizado
const COL_REGISTRO = 'registro';     // append-only, auto ID
const DOC_RESUMEN = 'meta/resumen';  // totales globales + por manifiesto

// ============================================
// COLORES POR UBICACIÓN
// ============================================
const ACCENTS = {
  'PALET 01': 'var(--loc-palet01)',
  'PALET 02': 'var(--loc-palet02)',
  'PALET 03': 'var(--loc-palet03)',
  'ESTANTE 04': 'var(--loc-estante04)',
  'PISO': 'var(--loc-piso)',
  'REVISAR PESO': 'var(--loc-revisar)',
  'YA_COMPLETA': 'var(--loc-revisar)'
};

// ============================================
// LÓGICA DE NEGOCIO
// ============================================
function calcularUbicacion(pesoTotal, tipoCliente) {
  const peso = parseFloat(pesoTotal);
  if (isNaN(peso)) return 'REVISAR PESO';
  if (peso < 1.5) return 'ESTANTE 04';
  if (tipoCliente === 'RECURRENTE') return 'PALET 01';
  if (tipoCliente === 'RETRASO') return 'PALET 03';
  return 'PALET 02';
}

function limpiarNombre(nombre) {
  return String(nombre || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

// ============================================
// ESTADO LOCAL
// ============================================
let currentAwb = null;
let currentUbicacion = null;
let resumenLocal = { totalGuias: 0, totalCompletas: 0, porManifiesto: {} };
let guiasParsadas = [];

// ============================================
// ELEMENTOS
// ============================================
const els = {
  statusDot: document.getElementById('statusDot'),
  statusLabel: document.getElementById('statusLabel'),
  operadorInput: document.getElementById('operadorInput'),
  progressLabel: document.getElementById('progressLabel'),
  progressFill: document.getElementById('progressFill'),
  tabs: document.querySelectorAll('.tab'),
  tabEscanear: document.getElementById('tabEscanear'),
  tabCliente: document.getElementById('tabCliente'),
  tabManifiestos: document.getElementById('tabManifiestos'),
  tabImportar: document.getElementById('tabImportar'),
  manualForm: document.getElementById('manualForm'),
  awbInput: document.getElementById('awbInput'),
  btnBuscar: document.getElementById('btnBuscar'),
  errorMsg: document.getElementById('errorMsg'),
  result: document.getElementById('result'),
  placard: document.getElementById('placard'),
  placardLabel: document.getElementById('placardLabel'),
  placardValue: document.getElementById('placardValue'),
  cajaBadge: document.getElementById('cajaBadge'),
  dataAwb: document.getElementById('dataAwb'),
  dataCliente: document.getElementById('dataCliente'),
  dataPeso: document.getElementById('dataPeso'),
  dataTipo: document.getElementById('dataTipo'),
  dataCasillero: document.getElementById('dataCasillero'),
  overridePills: document.getElementById('overridePills'),
  nextBtn: document.getElementById('nextBtn'),
  confirmOverlay: document.getElementById('confirmOverlay'),
  confirmCard: document.getElementById('confirmCard'),
  confirmValue: document.getElementById('confirmValue'),
  clienteForm: document.getElementById('clienteForm'),
  clienteInput: document.getElementById('clienteInput'),
  clienteResultados: document.getElementById('clienteResultados'),
  manifiestosResultados: document.getElementById('manifiestosResultados'),
  importTextarea: document.getElementById('importTextarea'),
  importPreview: document.getElementById('importPreview'),
  importPrevisualizarBtn: document.getElementById('importPrevisualizarBtn'),
  importCargarBtn: document.getElementById('importCargarBtn'),
  importLog: document.getElementById('importLog')
};

// ============================================
// HELPERS UI
// ============================================
function setStatus(state) {
  const textos = { conectando: 'conectando', ok: 'conectado', error: 'sin conexión' };
  els.statusDot.dataset.state = state === 'ok' ? 'ok' : (state === 'error' ? 'error' : '');
  els.statusLabel.textContent = textos[state] || state;
}

function showError(msg) {
  els.errorMsg.textContent = msg;
  els.errorMsg.hidden = false;
}

function hideError() {
  els.errorMsg.hidden = true;
}

function hideResult() {
  els.result.hidden = true;
  currentAwb = null;
  currentUbicacion = null;
}

function pintarProgreso(resumen) {
  resumenLocal = resumen;
  els.progressLabel.textContent = resumen.totalCompletas + ' / ' + resumen.totalGuias + ' guías completas';
  const pct = resumen.totalGuias > 0 ? (resumen.totalCompletas / resumen.totalGuias) * 100 : 0;
  els.progressFill.style.width = pct + '%';
}

// ============================================
// OVERLAY DE CONFIRMACIÓN
// ============================================
let overlayTimer = null;

function mostrarConfirmacion(mensaje, accentKey) {
  clearTimeout(overlayTimer);
  els.confirmCard.style.setProperty('--loc-accent', ACCENTS[accentKey] || 'var(--loc-palet01)');
  els.confirmValue.textContent = mensaje;
  els.confirmOverlay.hidden = false;
  overlayTimer = setTimeout(() => { els.confirmOverlay.hidden = true; }, 1800);
}

els.confirmOverlay.addEventListener('click', () => {
  clearTimeout(overlayTimer);
  els.confirmOverlay.hidden = true;
});

// ============================================
// OPERADOR
// ============================================
function cargarOperador() {
  const g = localStorage.getItem('crsOperador');
  if (g) els.operadorInput.value = g;
}

function guardarOperador() {
  localStorage.setItem('crsOperador', els.operadorInput.value.trim());
}

els.operadorInput.addEventListener('change', guardarOperador);
els.operadorInput.addEventListener('blur', guardarOperador);

// ============================================
// PROGRESO — lee el doc resumen (1 lectura, instant)
// ============================================
async function actualizarProgreso() {
  try {
    const doc = await db.doc(DOC_RESUMEN).get();
    if (doc.exists) pintarProgreso(doc.data());
  } catch (e) { /* silencioso */ }
}

// ============================================
// ESCANEO — transacción atómica en Firestore
// Esta es la ruta caliente: 1 lectura + 2 escrituras,
// sin Apps Script de intermediario → ~100-200ms esperados.
// ============================================
async function escanearAwb(awbRaw, operador) {
  const awb = awbRaw.toString().trim().toUpperCase();
  const guiaRef = db.collection(COL_GUIAS).doc(awb);
  const resumenRef = db.doc(DOC_RESUMEN);

  return db.runTransaction(async (tx) => {
    const guiaDoc = await tx.get(guiaRef);

    if (!guiaDoc.exists) {
      return { ok: false, error: 'AWB "' + awb + '" no encontrado. Verifica que el manifiesto esté importado.' };
    }

    const g = guiaDoc.data();
    const yaEscaneadas = g.cajasEscaneadas || 0;

    if (yaEscaneadas >= g.cajas) {
      return {
        ok: true, registrado: false, completa: true,
        awb: g.awb, cliente: g.cliente, pesoTotal: g.pesoTotal,
        tipoCliente: g.tipoCliente, ubicacionSugerida: g.ubicacionSugerida,
        casillero: g.casillero, cajaActual: yaEscaneadas, cajasTotal: g.cajas,
        mensaje: 'Ya estaba completa (' + yaEscaneadas + '/' + g.cajas + ')'
      };
    }

    const cajaActual = yaEscaneadas + 1;
    const completa = cajaActual >= g.cajas;

    // Actualizar guía
    tx.update(guiaRef, {
      cajasEscaneadas: cajaActual,
      completa: completa
    });

    // Agregar al registro
    const registroRef = db.collection(COL_REGISTRO).doc();
    tx.set(registroRef, {
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      awb: g.awb, cliente: g.cliente, pesoTotal: g.pesoTotal,
      tipoCliente: g.tipoCliente, ubicacionFinal: g.ubicacionSugerida,
      operador: operador || 'SIN NOMBRE', tipoEvento: 'ESCANEO',
      cajaActual: cajaActual, cajasTotal: g.cajas
    });

    // Actualizar resumen solo si esta caja completa la guía
    if (completa) {
      tx.update(resumenRef, {
        totalCompletas: firebase.firestore.FieldValue.increment(1),
        ['porManifiesto.' + g.manifiesto + '.completas']: firebase.firestore.FieldValue.increment(1)
      });
    }

    return {
      ok: true, registrado: true, completa,
      awb: g.awb, cliente: g.cliente, pesoTotal: g.pesoTotal,
      tipoCliente: g.tipoCliente, ubicacionSugerida: g.ubicacionSugerida,
      ubicacionFinal: g.ubicacionSugerida, casillero: g.casillero,
      cajaActual, cajasTotal: g.cajas
    };
  });
}

// ============================================
// RENDER RESULTADO DEL ESCANEO
// ============================================
function renderResultado(data) {
  currentAwb = data.awb;
  const yaCompleta = data.registrado === false && data.completa === true;
  const ubicacion = data.ubicacionFinal || data.ubicacionSugerida;
  currentUbicacion = ubicacion;

  // Cartel overlay de confirmación
  if (yaCompleta) {
    mostrarConfirmacion('YA ESTABA COMPLETA (' + data.cajaActual + '/' + data.cajasTotal + ')', 'YA_COMPLETA');
  } else if (data.cajasTotal <= 1) {
    mostrarConfirmacion('GUÍA ÚNICA COMPLETA', 'PALET 01');
  } else if (data.cajaActual >= data.cajasTotal) {
    mostrarConfirmacion('GUÍA COMPLETADA (' + data.cajaActual + '/' + data.cajasTotal + ')', 'PALET 01');
  } else {
    mostrarConfirmacion('REGISTRADO ' + data.cajaActual + '/' + data.cajasTotal, 'ESTANTE 04');
  }

  // Placard
  if (yaCompleta) {
    pintarPlacard('YA_COMPLETA', 'UBICACIÓN REGISTRADA', ubicacion);
  } else {
    pintarPlacard(ubicacion, 'UBICACIÓN', ubicacion);
  }

  // Badge de caja
  if (data.cajasTotal <= 1) {
    els.cajaBadge.textContent = 'GUÍA ÚNICA COMPLETA';
    els.cajaBadge.dataset.completa = 'true';
  } else if (data.cajaActual >= data.cajasTotal) {
    els.cajaBadge.textContent = 'GUÍA COMPLETA (' + data.cajaActual + '/' + data.cajasTotal + ')';
    els.cajaBadge.dataset.completa = 'true';
  } else {
    els.cajaBadge.textContent = 'CAJA ' + data.cajaActual + ' / ' + data.cajasTotal;
    els.cajaBadge.dataset.completa = 'false';
  }

  // Datos
  els.dataAwb.textContent = data.awb;
  els.dataCliente.textContent = data.cliente || '—';
  els.dataPeso.textContent = (typeof data.pesoTotal === 'number' ? data.pesoTotal.toFixed(2) : data.pesoTotal) + ' kg';
  els.dataTipo.textContent = data.tipoCliente;
  els.dataCasillero.textContent = data.casillero || '—';

  actualizarPills(ubicacion);
  els.result.hidden = false;

  // Actualizar contador local sin esperar al servidor
  if (data.registrado === true && data.completa === true) {
    resumenLocal.totalCompletas = Math.min(resumenLocal.totalCompletas + 1, resumenLocal.totalGuias);
    pintarProgreso(resumenLocal);
  }
}

function pintarPlacard(accentKey, label, valor) {
  els.placard.style.setProperty('--loc-accent', ACCENTS[accentKey] || 'var(--text-muted)');
  els.placardLabel.textContent = label;
  els.placardValue.textContent = valor;
}

function actualizarPills(ubicacionActiva) {
  document.querySelectorAll('.pill').forEach((btn) => {
    btn.dataset.active = btn.dataset.loc === ubicacionActiva ? 'true' : 'false';
  });
}

// ============================================
// FORMULARIO DE ESCANEO
// ============================================
async function procesarEscaneo(awb) {
  hideError();
  const operador = els.operadorInput.value.trim();
  if (!operador) {
    showError('Escribe el nombre del operador antes de escanear.');
    els.operadorInput.focus();
    return;
  }

  els.btnBuscar.disabled = true;
  els.btnBuscar.textContent = 'Buscando…';

  try {
    const data = await escanearAwb(awb, operador);
    if (!data.ok) {
      showError(data.error);
      return;
    }
    els.awbInput.value = '';
    renderResultado(data);
  } catch (err) {
    showError('Error de conexión. Verifica tu red e intenta de nuevo.');
    console.error(err);
  } finally {
    els.btnBuscar.disabled = false;
    els.btnBuscar.textContent = 'Buscar';
  }
}

els.manualForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const awb = els.awbInput.value.trim();
  if (awb) procesarEscaneo(awb);
});

// ============================================
// CORRECCIÓN MANUAL DE UBICACIÓN
// ============================================
els.overridePills.addEventListener('click', async (e) => {
  const btn = e.target.closest('.pill');
  if (!btn || !currentAwb) return;

  const nuevaUbicacion = btn.dataset.loc;
  const operador = els.operadorInput.value.trim();

  document.querySelectorAll('.pill').forEach(p => p.disabled = true);

  try {
    await db.collection(COL_REGISTRO).add({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      awb: currentAwb, operador, tipoEvento: 'CORRECCION',
      ubicacionFinal: nuevaUbicacion
    });
    currentUbicacion = nuevaUbicacion;
    actualizarPills(nuevaUbicacion);
    pintarPlacard(nuevaUbicacion, 'CORREGIDO MANUALMENTE', nuevaUbicacion);
  } catch (err) {
    showError('No se pudo guardar la corrección.');
  } finally {
    document.querySelectorAll('.pill').forEach(p => p.disabled = false);
  }
});

els.nextBtn.addEventListener('click', () => {
  hideResult();
  hideError();
  els.awbInput.value = '';
  els.awbInput.focus();
});

// ============================================
// BÚSQUEDA POR CLIENTE
// ============================================
async function buscarCliente(nombre) {
  els.clienteResultados.innerHTML = '<p class="cliente-loading">Buscando…</p>';
  const buscado = limpiarNombre(nombre);

  try {
    // Fetch all y filtra client-side (dataset pequeño, ~274 guías)
    const snapshot = await db.collection(COL_GUIAS).get();
    const resultados = [];
    snapshot.forEach(doc => {
      const g = doc.data();
      if (limpiarNombre(g.cliente).includes(buscado)) resultados.push(g);
    });

    if (!resultados.length) {
      els.clienteResultados.innerHTML = '<p class="cliente-empty">No se encontraron guías para "' + escapeHtml(nombre) + '".</p>';
      return;
    }

    const filas = resultados.map(g => {
      const completa = g.completa || false;
      const cajaActual = g.cajasEscaneadas || 0;
      const estadoTexto = completa
        ? escapeHtml(g.ubicacionSugerida)
        : 'Pendiente (' + cajaActual + '/' + g.cajas + ')';
      return '<div class="cliente-item">' +
        '<div class="cliente-item__awb">' + escapeHtml(g.awb) + '</div>' +
        '<div class="cliente-item__meta">' + escapeHtml(g.manifiesto) + ' · ' + parseFloat(g.pesoTotal).toFixed(2) + ' kg · ' + escapeHtml(g.tipoCliente) + '</div>' +
        '<span class="cliente-item__estado" data-estado="' + (completa ? 'completa' : 'pendiente') + '">' + estadoTexto + '</span>' +
        '</div>';
    }).join('');

    els.clienteResultados.innerHTML = '<p class="cliente-total">' + resultados.length + ' guía(s) encontradas</p>' + filas;
  } catch (err) {
    els.clienteResultados.innerHTML = '<p class="error">No se pudo buscar. Revisa la conexión.</p>';
  }
}

els.clienteForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const nombre = els.clienteInput.value.trim();
  if (nombre) buscarCliente(nombre);
});

// ============================================
// MANIFIESTOS — lee del doc resumen (instant)
// ============================================
async function buscarManifiestos() {
  els.manifiestosResultados.innerHTML = '<p class="cliente-loading">Cargando…</p>';
  try {
    const doc = await db.doc(DOC_RESUMEN).get();
    if (!doc.exists) {
      els.manifiestosResultados.innerHTML = '<p class="cliente-empty">Sin datos. Importa un manifiesto primero.</p>';
      return;
    }
    renderManifiestos(doc.data());
  } catch (err) {
    els.manifiestosResultados.innerHTML = '<p class="error">No se pudo cargar.</p>';
  }
}

function renderManifiestos(data) {
  const por = data.porManifiesto || {};
  if (!Object.keys(por).length) {
    els.manifiestosResultados.innerHTML = '<p class="cliente-empty">Sin manifiestos registrados.</p>';
    return;
  }

  els.manifiestosResultados.innerHTML = Object.keys(por).sort().map(nombre => {
    const m = por[nombre];
    const total = m.total || 0;
    const completas = m.completas || 0;
    const pct = total > 0 ? (completas / total * 100) : 0;
    const completado = total > 0 && completas === total;
    const badge = completado ? '<span class="manifiesto-item__badge">MANIFIESTO COMPLETADO</span>' : '';

    return '<div class="manifiesto-item" data-completo="' + completado + '">' +
      '<div class="manifiesto-item__header">' +
      '<span class="manifiesto-item__nombre">' + escapeHtml(nombre) + '</span>' +
      '<button type="button" class="manifiesto-item__conteo-btn" data-hoja="' + escapeHtml(nombre) + '">' + completas + ' / ' + total + '</button>' +
      '</div>' +
      '<div class="manifiesto-item__track"><div class="manifiesto-item__fill" style="width:' + pct + '%"></div></div>' +
      badge + '</div>';
  }).join('');
}

async function verDetalleManifiesto(manifiesto) {
  els.manifiestosResultados.innerHTML = '<p class="cliente-loading">Cargando ' + escapeHtml(manifiesto) + '…</p>';
  try {
    const snapshot = await db.collection(COL_GUIAS).where('manifiesto', '==', manifiesto).get();
    const guias = [];
    snapshot.forEach(doc => guias.push(doc.data()));
    guias.sort((a, b) => (a.completa === b.completa) ? a.awb.localeCompare(b.awb) : (a.completa ? 1 : -1));
    renderDetalleManifiesto(manifiesto, guias);
  } catch (err) {
    els.manifiestosResultados.innerHTML = '<p class="error">No se pudo cargar el detalle.</p>';
  }
}

function renderDetalleManifiesto(manifiesto, guias) {
  const encabezado = '<button type="button" class="manifiesto-detalle__volver">← Volver</button>' +
    '<p class="cliente-total">' + escapeHtml(manifiesto) + ' — ' + guias.length + ' guía(s)</p>';

  if (!guias.length) {
    els.manifiestosResultados.innerHTML = encabezado + '<p class="cliente-empty">Sin guías.</p>';
    return;
  }

  const filas = guias.map(g => {
    const cajaActual = g.cajasEscaneadas || 0;
    const estadoTexto = g.completa
      ? escapeHtml(g.ubicacionSugerida)
      : 'Pendiente (' + cajaActual + '/' + g.cajas + ')';
    return '<div class="cliente-item">' +
      '<div class="cliente-item__awb">' + escapeHtml(g.awb) + '</div>' +
      '<div class="cliente-item__meta">' + escapeHtml(g.cliente) + ' · ' + parseFloat(g.pesoTotal).toFixed(2) + ' kg</div>' +
      '<span class="cliente-item__estado" data-estado="' + (g.completa ? 'completa' : 'pendiente') + '">' + estadoTexto + '</span>' +
      '</div>';
  }).join('');

  els.manifiestosResultados.innerHTML = encabezado + filas;
}

els.manifiestosResultados.addEventListener('click', (e) => {
  const btnConteo = e.target.closest('.manifiesto-item__conteo-btn');
  if (btnConteo) { verDetalleManifiesto(btnConteo.dataset.hoja); return; }
  const btnVolver = e.target.closest('.manifiesto-detalle__volver');
  if (btnVolver) buscarManifiestos();
});

// ============================================
// IMPORTACIÓN DE GUÍAS DESDE TSV (Sheets → Firebase)
//
// CÓMO USAR:
// 1. Abre tu hoja Mxxx en Google Sheets.
// 2. Selecciona TODAS las filas de datos (sin la fila de encabezado).
// 3. Copia (Ctrl+C).
// 4. Pega en el textarea de abajo.
// 5. Haz clic en "Previsualizar", revisa, y luego "Cargar a Firebase".
//
// Columnas esperadas (A a Q):
// AWB, Consignatario, Dirección, Distrito, Descripción, FOB, Cajas,
// Peso(kg), RUC/DNI, Casillero, Peso Total(kg), Nota, Referencia,
// Cliente, Tipo de cliente, Manifiesto, Estado
// ============================================
function parsearTSV(texto) {
  const lineas = texto.trim().split('\n');
  const guias = [];

  lineas.forEach((linea, idx) => {
    const cols = linea.split('\t');
    const awb = (cols[0] || '').trim();

    // Saltar filas vacías o que parezcan encabezado
    if (!awb || /^awb$/i.test(awb)) return;

    const pesoTotal = parseFloat((cols[10] || '').replace(',', '.')) || 0;
    const cajas = parseInt(cols[6], 10) || 1;
    const tipoCliente = (cols[14] || 'SIN CLASIFICAR').trim().toUpperCase();
    const manifiesto = (cols[15] || '').trim();
    const estadoTexto = (cols[16] || '').trim().toUpperCase();

    // Interpretar estado actual desde la columna Estado
    let cajasEscaneadas = 0;
    let completa = false;
    if (estadoTexto === 'REGISTRADO') {
      cajasEscaneadas = cajas;
      completa = true;
    } else {
      const partes = estadoTexto.split('/');
      cajasEscaneadas = parseInt(partes[0], 10) || 0;
      completa = cajasEscaneadas >= cajas;
    }

    guias.push({
      awb: awb.toUpperCase(),
      consignatario: (cols[1] || '').trim(),
      cliente: (cols[13] || '').trim(),
      clienteNorm: limpiarNombre(cols[13] || ''),
      pesoTotal: pesoTotal,
      cajas: cajas,
      tipoCliente: tipoCliente,
      manifiesto: manifiesto,
      casillero: (cols[9] || '').trim(),
      ubicacionSugerida: calcularUbicacion(pesoTotal, tipoCliente),
      cajasEscaneadas: cajasEscaneadas,
      completa: completa
    });
  });

  return guias;
}

function logImport(msg, tipo) {
  const p = document.createElement('p');
  p.textContent = msg;
  if (tipo) p.className = tipo;
  els.importLog.appendChild(p);
  els.importLog.scrollTop = els.importLog.scrollHeight;
}

els.importPrevisualizarBtn.addEventListener('click', () => {
  guiasParsadas = parsearTSV(els.importTextarea.value);
  if (!guiasParsadas.length) {
    els.importPreview.textContent = 'No se detectaron guías válidas. Revisa el formato.';
    els.importCargarBtn.disabled = true;
    return;
  }
  const manifiestos = [...new Set(guiasParsadas.map(g => g.manifiesto).filter(Boolean))];
  const completas = guiasParsadas.filter(g => g.completa).length;
  els.importPreview.textContent = guiasParsadas.length + ' guías detectadas · Manifiestos: ' + manifiestos.join(', ') + ' · Ya registradas: ' + completas;
  els.importCargarBtn.disabled = false;
});

els.importCargarBtn.addEventListener('click', async () => {
  if (!guiasParsadas.length) return;

  els.importCargarBtn.disabled = true;
  els.importPrevisualizarBtn.disabled = true;
  els.importLog.innerHTML = '';

  try {
    // 1. Escribir las guías en lotes de 400 (límite Firestore = 500)
    const LOTE = 400;
    let escritas = 0;

    for (let i = 0; i < guiasParsadas.length; i += LOTE) {
      const batch = db.batch();
      const trozo = guiasParsadas.slice(i, i + LOTE);
      trozo.forEach(g => {
        const ref = db.collection(COL_GUIAS).doc(g.awb);
        batch.set(ref, g); // overwrite — importar = estado fresco
      });
      await batch.commit();
      escritas += trozo.length;
      logImport('✅ ' + escritas + ' / ' + guiasParsadas.length + ' guías cargadas…', 'ok');
    }

    // 2. Calcular totales para el doc resumen
    const porManifiesto = {};
    guiasParsadas.forEach(g => {
      if (!g.manifiesto) return;
      if (!porManifiesto[g.manifiesto]) porManifiesto[g.manifiesto] = { total: 0, completas: 0 };
      porManifiesto[g.manifiesto].total++;
      if (g.completa) porManifiesto[g.manifiesto].completas++;
    });

    const totalGuias = guiasParsadas.length;
    const totalCompletas = guiasParsadas.filter(g => g.completa).length;

    // 3. Actualizar el doc resumen (merge para no pisar manifiestos anteriores)
    await db.doc(DOC_RESUMEN).set({
      totalGuias: firebase.firestore.FieldValue.increment(totalGuias),
      totalCompletas: firebase.firestore.FieldValue.increment(totalCompletas),
      porManifiesto: Object.fromEntries(
        Object.entries(porManifiesto).map(([k, v]) => [k, v])
      )
    }, { merge: true });

    logImport('✅ Resumen actualizado. Importación completa.', 'ok');
    await actualizarProgreso();
    guiasParsadas = [];
    els.importTextarea.value = '';
    els.importPreview.textContent = '';
    els.importCargarBtn.disabled = true;
  } catch (err) {
    logImport('❌ Error: ' + err.message, 'err');
    console.error(err);
  } finally {
    els.importPrevisualizarBtn.disabled = false;
  }
});

// ============================================
// TABS
// ============================================
els.tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    els.tabs.forEach(t => t.setAttribute('aria-selected', 'false'));
    tab.setAttribute('aria-selected', 'true');
    const activo = tab.dataset.tab;
    els.tabEscanear.hidden   = activo !== 'escanear';
    els.tabCliente.hidden    = activo !== 'cliente';
    els.tabManifiestos.hidden = activo !== 'manifiestos';
    els.tabImportar.hidden   = activo !== 'importar';
    if (activo === 'escanear') els.awbInput.focus();
    if (activo === 'manifiestos') buscarManifiestos();
  });
});

// ============================================
// ARRANQUE — Auth anónima + carga inicial
// ============================================
auth.onAuthStateChanged(user => {
  if (user) {
    setStatus('ok');
    actualizarProgreso();
  }
});

auth.signInAnonymously().catch(err => {
  setStatus('error');
  showError('No se pudo conectar con Firebase: ' + err.message);
});

cargarOperador();
els.awbInput.focus();

// Refrescar progreso cada 30s (por si otro operador escanea en paralelo)
setInterval(actualizarProgreso, 30000);
