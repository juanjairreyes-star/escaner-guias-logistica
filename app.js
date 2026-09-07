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

const COL_GUIAS = 'guias';
const COL_REGISTRO = 'registro';
const DOC_RESUMEN = 'meta/resumen';

const ACCENTS = {
  'PALET 01': 'var(--loc-palet01)',
  'PALET 02': 'var(--loc-palet02)',
  'PALET 03': 'var(--loc-palet03)',
  'ESTANTE 04': 'var(--loc-estante04)',
  'PISO': 'var(--loc-piso)',
  'REVISAR PESO': 'var(--loc-revisar)',
  'YA_COMPLETA': 'var(--loc-revisar)',
  'MIXTA': 'var(--loc-estante04)'
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

function limpiarNombre(n) {
  return String(n || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

// Resume las ubicaciones de todas las cajas de una guía en un texto.
// Si todas están en el mismo sitio → "PALET 01".
// Si están repartidas → "PALET 01 + PALET 02".
function resumenUbicaciones(g) {
  const ubis = g.ubicaciones || [];
  if (!ubis.length) return g.ubicacionSugerida || '—';
  const unicas = [...new Set(ubis.map(u => u.ubicacion))];
  return unicas.join(' + ');
}

// ============================================
// ESTADO LOCAL
// ============================================
let currentAwb = null;
let currentCaja = null;      // número de caja recién escaneada (para corregir esa, no toda la guía)
let currentGuia = null;
let resumenLocal = { totalGuias: 0, totalCompletas: 0, porManifiesto: {} };
let guiasParsadas = [];
let html5QrCode = null;
let camaraActiva = false;
let archivadosAbiertos = false;

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
  toggleCamaraBtn: document.getElementById('toggleCamaraBtn'),
  reader: document.getElementById('reader'),
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
  ubicacionesCajas: document.getElementById('ubicacionesCajas'),
  overrideLabel: document.getElementById('overrideLabel'),
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
// FEEDBACK: SONIDO + VIBRACIÓN
// ============================================
let audioCtx = null;

function beep(exito) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.value = exito ? 880 : 300;   // agudo = ok, grave = problema
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.18);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.18);
  } catch (e) { /* audio no disponible, no es crítico */ }
}

function vibrar(exito) {
  if (navigator.vibrate) navigator.vibrate(exito ? 120 : [80, 60, 80]);
}

function feedback(exito) {
  beep(exito);
  vibrar(exito);
}

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

function hideError() { els.errorMsg.hidden = true; }

function hideResult() {
  els.result.hidden = true;
  currentAwb = null;
  currentCaja = null;
  currentGuia = null;
}

function pintarProgreso(r) {
  resumenLocal = r;
  els.progressLabel.textContent = (r.totalCompletas || 0) + ' / ' + (r.totalGuias || 0) + ' guías completas';
  const pct = r.totalGuias > 0 ? (r.totalCompletas / r.totalGuias) * 100 : 0;
  els.progressFill.style.width = pct + '%';
}

function pintarPlacard(accentKey, label, valor) {
  els.placard.style.setProperty('--loc-accent', ACCENTS[accentKey] || 'var(--text-muted)');
  els.placardLabel.textContent = label;
  els.placardValue.textContent = valor;
}

function actualizarPills(ubicacionActiva) {
  document.querySelectorAll('.pill').forEach(btn => {
    btn.dataset.active = btn.dataset.loc === ubicacionActiva ? 'true' : 'false';
  });
}

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
// PROGRESO
// ============================================
async function actualizarProgreso() {
  try {
    const doc = await db.doc(DOC_RESUMEN).get();
    if (doc.exists) pintarProgreso(doc.data());
  } catch (e) { /* silencioso */ }
}

// ============================================
// CÁMARA (html5-qrcode)
// ============================================
async function toggleCamara() {
  if (camaraActiva) { await detenerCamara(); return; }

  els.reader.hidden = false;
  els.toggleCamaraBtn.textContent = '✕ Detener cámara';
  els.toggleCamaraBtn.dataset.activa = 'true';
  camaraActiva = true;

  html5QrCode = new Html5Qrcode('reader');
  try {
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      (texto) => { onCodigoEscaneado(texto); },
      () => { /* fotograma sin código legible */ }
    );
  } catch (err) {
    showError('No se pudo activar la cámara. Revisa los permisos del navegador.');
    await detenerCamara();
  }
}

async function detenerCamara() {
  camaraActiva = false;
  els.toggleCamaraBtn.textContent = '📷 Escanear con cámara';
  els.toggleCamaraBtn.dataset.activa = 'false';
  els.reader.hidden = true;
  if (html5QrCode) {
    try {
      await html5QrCode.stop();
      html5QrCode.clear();
    } catch (e) { /* ya estaba detenida */ }
    html5QrCode = null;
  }
}

function onCodigoEscaneado(texto) {
  detenerCamara();
  els.awbInput.value = texto.trim();
  procesarEscaneo(texto.trim());
}

els.toggleCamaraBtn.addEventListener('click', toggleCamara);

// ============================================
// ESCANEO — transacción atómica
// Ahora guarda la ubicación DE CADA CAJA en el array `ubicaciones`,
// no solo un contador — así dos cajas de la misma guía pueden estar
// en palets distintos y el sistema lo refleja correctamente.
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
    const ubicaciones = g.ubicaciones || [];
    const yaEscaneadas = g.cajasEscaneadas || 0;

    if (yaEscaneadas >= g.cajas) {
      return {
        ok: true, registrado: false, completa: true, guia: g,
        cajaActual: yaEscaneadas, cajasTotal: g.cajas
      };
    }

    const cajaActual = yaEscaneadas + 1;
    const completa = cajaActual >= g.cajas;
    const nuevasUbicaciones = ubicaciones.concat([{ caja: cajaActual, ubicacion: g.ubicacionSugerida }]);

    tx.update(guiaRef, {
      cajasEscaneadas: cajaActual,
      completa: completa,
      ubicaciones: nuevasUbicaciones
    });

    const registroRef = db.collection(COL_REGISTRO).doc();
    tx.set(registroRef, {
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      awb: g.awb, cliente: g.cliente, pesoTotal: g.pesoTotal,
      tipoCliente: g.tipoCliente, ubicacionFinal: g.ubicacionSugerida,
      operador: operador || 'SIN NOMBRE', tipoEvento: 'ESCANEO',
      cajaActual: cajaActual, cajasTotal: g.cajas, manifiesto: g.manifiesto
    });

    if (completa) {
      tx.update(resumenRef, {
        totalCompletas: firebase.firestore.FieldValue.increment(1),
        ['porManifiesto.' + g.manifiesto + '.completas']: firebase.firestore.FieldValue.increment(1)
      });
    }

    const gActualizada = Object.assign({}, g, {
      cajasEscaneadas: cajaActual, completa: completa, ubicaciones: nuevasUbicaciones
    });

    return { ok: true, registrado: true, completa, guia: gActualizada, cajaActual, cajasTotal: g.cajas };
  });
}

// ============================================
// RENDER RESULTADO
// ============================================
function renderResultado(data) {
  const g = data.guia;
  currentAwb = g.awb;
  currentGuia = g;
  currentCaja = data.registrado ? data.cajaActual : null;

  const yaCompleta = data.registrado === false && data.completa === true;
  const ubicacionEstaCaja = data.registrado ? g.ubicacionSugerida : resumenUbicaciones(g);

  // Feedback físico
  feedback(!yaCompleta);

  // Overlay
  if (yaCompleta) {
    mostrarConfirmacion('YA ESTABA COMPLETA (' + data.cajaActual + '/' + data.cajasTotal + ')', 'YA_COMPLETA');
  } else if (data.cajasTotal <= 1) {
    mostrarConfirmacion('GUÍA ÚNICA COMPLETA', 'PALET 01');
  } else if (data.completa) {
    mostrarConfirmacion('GUÍA COMPLETADA (' + data.cajaActual + '/' + data.cajasTotal + ')', 'PALET 01');
  } else {
    mostrarConfirmacion('REGISTRADO ' + data.cajaActual + '/' + data.cajasTotal, 'ESTANTE 04');
  }

  // Placard
  if (yaCompleta) {
    pintarPlacard('YA_COMPLETA', 'UBICACIÓN REGISTRADA', ubicacionEstaCaja);
  } else {
    pintarPlacard(ubicacionEstaCaja, 'UBICACIÓN CAJA ' + data.cajaActual, ubicacionEstaCaja);
  }

  // Badge
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

  els.dataAwb.textContent = g.awb;
  els.dataCliente.textContent = g.cliente || '—';
  els.dataPeso.textContent = (typeof g.pesoTotal === 'number' ? g.pesoTotal.toFixed(2) : g.pesoTotal) + ' kg';
  els.dataTipo.textContent = g.tipoCliente;
  els.dataCasillero.textContent = g.casillero || '—';

  renderUbicacionesCajas(g);
  actualizarPanelCorreccion(g);

  els.result.hidden = false;

  if (data.registrado === true && data.completa === true) {
    resumenLocal.totalCompletas = Math.min((resumenLocal.totalCompletas || 0) + 1, resumenLocal.totalGuias);
    pintarProgreso(resumenLocal);
  }
}

// Muestra dónde quedó cada caja. Cada fila es un botón: al tocarla se
// selecciona esa caja y las pastillas de abajo corrigen SU ubicación.
// Esto permite reubicar cajas de guías ya completas.
function renderUbicacionesCajas(g) {
  const ubis = g.ubicaciones || [];
  if (!ubis.length) {
    els.ubicacionesCajas.hidden = true;
    return;
  }
  const filas = ubis.map(u =>
    '<button type="button" class="ubicacion-caja" data-caja="' + u.caja + '" data-actual="' + (u.caja === currentCaja) + '">' +
    '<span class="ubicacion-caja__num">Caja ' + u.caja + ' / ' + g.cajas + '</span>' +
    '<span class="ubicacion-caja__loc">' + escapeHtml(u.ubicacion) + '</span>' +
    '</button>'
  ).join('');
  els.ubicacionesCajas.innerHTML =
    '<div class="ubicaciones-cajas__titulo">Ubicación por caja — toca una para corregirla</div>' + filas;
  els.ubicacionesCajas.hidden = false;
}

// Habilita o no las pastillas según haya una caja seleccionada
function actualizarPanelCorreccion(g) {
  const ubis = g.ubicaciones || [];
  if (!ubis.length) {
    els.overridePills.parentElement.hidden = true;
    return;
  }
  els.overridePills.parentElement.hidden = false;

  if (currentCaja) {
    const actual = ubis.find(u => u.caja === currentCaja);
    els.overrideLabel.textContent = 'Corregir ubicación de la caja ' + currentCaja + ' de ' + g.cajas;
    actualizarPills(actual ? actual.ubicacion : null);
  } else {
    els.overrideLabel.textContent = 'Toca una caja arriba para corregir su ubicación';
    actualizarPills(null);
  }
  document.querySelectorAll('.pill').forEach(p => { p.disabled = !currentCaja; });
}

// Selección de caja desde la lista
els.ubicacionesCajas.addEventListener('click', (e) => {
  const btn = e.target.closest('.ubicacion-caja');
  if (!btn || !currentGuia) return;
  currentCaja = parseInt(btn.dataset.caja, 10);
  renderUbicacionesCajas(currentGuia);
  actualizarPanelCorreccion(currentGuia);
});

// ============================================
// PROCESAR ESCANEO
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
      feedback(false);
      showError(data.error);
      return;
    }
    els.awbInput.value = '';
    renderResultado(data);
  } catch (err) {
    feedback(false);
    showError('Error de conexión. Intenta de nuevo.');
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
// CORRECCIÓN MANUAL — ahora SÍ actualiza el documento de la guía,
// no solo el historial. Corrige la caja recién escaneada.
// ============================================
els.overridePills.addEventListener('click', async (e) => {
  const btn = e.target.closest('.pill');
  if (!btn || !currentAwb || !currentCaja) return;

  const nuevaUbicacion = btn.dataset.loc;
  const operador = els.operadorInput.value.trim();
  const guiaRef = db.collection(COL_GUIAS).doc(currentAwb);

  document.querySelectorAll('.pill').forEach(p => p.disabled = true);

  try {
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(guiaRef);
      if (!doc.exists) throw new Error('Guía no encontrada');
      const g = doc.data();
      const ubicaciones = (g.ubicaciones || []).map(u =>
        u.caja === currentCaja ? { caja: u.caja, ubicacion: nuevaUbicacion } : u
      );
      tx.update(guiaRef, { ubicaciones: ubicaciones });

      const regRef = db.collection(COL_REGISTRO).doc();
      tx.set(regRef, {
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        awb: currentAwb, cliente: g.cliente, operador: operador || 'SIN NOMBRE',
        tipoEvento: 'CORRECCION', ubicacionFinal: nuevaUbicacion,
        cajaActual: currentCaja, cajasTotal: g.cajas, manifiesto: g.manifiesto
      });

      currentGuia = Object.assign({}, g, { ubicaciones: ubicaciones });
    });

    pintarPlacard(nuevaUbicacion, 'CAJA ' + currentCaja + ' — CORREGIDA', nuevaUbicacion);
    renderUbicacionesCajas(currentGuia);
    actualizarPanelCorreccion(currentGuia);
    feedback(true);
  } catch (err) {
    showError('No se pudo guardar la corrección.');
    console.error(err);
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
    // Filtra los archivados en la consulta, no en el navegador: Firestore
    // solo cobra los documentos que devuelve, así que los manifiestos
    // archivados dejan de consumir cuota de lectura por completo.
    const snapshot = await db.collection(COL_GUIAS).where('archivado', '==', false).get();
    const resultados = [];
    snapshot.forEach(doc => {
      const g = doc.data();
      if (limpiarNombre(g.cliente).includes(buscado)) resultados.push(g);
    });

    if (!resultados.length) {
      els.clienteResultados.innerHTML = '<p class="cliente-empty">No se encontraron guías para "' + escapeHtml(nombre) + '".</p>';
      return;
    }

    els.clienteResultados.innerHTML =
      '<p class="cliente-total">' + resultados.length + ' guía(s) encontradas</p>' +
      resultados.map(g => renderItemGuia(g, g.manifiesto)).join('');
  } catch (err) {
    els.clienteResultados.innerHTML = '<p class="error">No se pudo buscar. Revisa la conexión.</p>';
  }
}

// Item compartido entre "Por cliente" y "Detalle de manifiesto".
// Lee de `ubicaciones` (donde vive la corrección), no de ubicacionSugerida.
function renderItemGuia(g, contexto) {
  const completa = g.completa || false;
  const cajaActual = g.cajasEscaneadas || 0;
  const estadoTexto = completa
    ? escapeHtml(resumenUbicaciones(g))
    : (cajaActual > 0
        ? 'Parcial ' + cajaActual + '/' + g.cajas + ' · ' + escapeHtml(resumenUbicaciones(g))
        : 'Pendiente (0/' + g.cajas + ')');
  return '<div class="cliente-item">' +
    '<div class="cliente-item__awb">' + escapeHtml(g.awb) + '</div>' +
    '<div class="cliente-item__meta">' + escapeHtml(contexto || '') + ' · ' +
      parseFloat(g.pesoTotal).toFixed(2) + ' kg · ' + escapeHtml(g.tipoCliente) + '</div>' +
    '<span class="cliente-item__estado" data-estado="' + (completa ? 'completa' : 'pendiente') + '">' +
      estadoTexto + '</span>' +
    '</div>';
}

els.clienteForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const nombre = els.clienteInput.value.trim();
  if (nombre) buscarCliente(nombre);
});

// ============================================
// MANIFIESTOS
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

function tarjetaManifiesto(nombre, m, archivado) {
  const total = m.total || 0;
  const completas = m.completas || 0;
  const pct = total > 0 ? (completas / total * 100) : 0;
  const completado = total > 0 && completas === total;
  const n = escapeHtml(nombre);

  const botonesComunes =
    '<button type="button" class="manifiesto-item__conteo-btn" data-hoja="' + n + '">' + completas + ' / ' + total + '</button>' +
    '<button type="button" class="manifiesto-item__exportar" data-exportar="' + n + '">Exportar</button>';

  if (archivado) {
    return '<div class="manifiesto-item manifiesto-item--archivado">' +
      '<div class="manifiesto-item__header">' +
        '<span class="manifiesto-item__nombre">' + n + '</span>' +
        '<div class="manifiesto-item__acciones">' + botonesComunes +
          '<button type="button" class="manifiesto-item__desarchivar" data-desarchivar="' + n + '">Desarchivar</button>' +
        '</div>' +
      '</div></div>';
  }

  const badge = completado ? '<span class="manifiesto-item__badge">MANIFIESTO COMPLETADO</span>' : '';
  return '<div class="manifiesto-item" data-completo="' + completado + '">' +
    '<div class="manifiesto-item__header">' +
      '<span class="manifiesto-item__nombre">' + n + '</span>' +
      '<div class="manifiesto-item__acciones">' + botonesComunes +
        '<div class="menu-wrap">' +
          '<button type="button" class="manifiesto-item__menu" data-menu="' + n + '" aria-label="Más acciones">⋮</button>' +
          '<div class="menu-desplegable" data-menu-de="' + n + '">' +
            '<button type="button" class="menu-item" data-archivar="' + n + '">Archivar</button>' +
            '<button type="button" class="menu-item menu-item--aviso" data-reiniciar="' + n + '">Reiniciar</button>' +
            '<div class="menu-sep"></div>' +
            '<button type="button" class="menu-item menu-item--peligro" data-borrar="' + n + '">Borrar manifiesto</button>' +
            '<button type="button" class="menu-item menu-item--peligro" data-borrar-historial="' + n + '">Borrar historial de pruebas</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="manifiesto-item__track"><div class="manifiesto-item__fill" style="width:' + pct + '%"></div></div>' +
    badge + '</div>';
}

function renderManifiestos(data) {
  const por = data.porManifiesto || {};
  const nombres = Object.keys(por).sort();
  if (!nombres.length) {
    els.manifiestosResultados.innerHTML = '<p class="cliente-empty">Sin manifiestos registrados.</p>';
    return;
  }

  const activos = nombres.filter(n => !por[n].archivado);
  const archivados = nombres.filter(n => por[n].archivado);

  let html = '';
  html += activos.length
    ? activos.map(n => tarjetaManifiesto(n, por[n], false)).join('')
    : '<p class="cliente-empty">No hay manifiestos activos.</p>';

  if (archivados.length) {
    html += '<button type="button" class="archivados-toggle" data-abierto="' + archivadosAbiertos + '">' +
      '<span class="archivados-toggle__flecha">' + (archivadosAbiertos ? '▾' : '▸') + '</span>' +
      'Archivados (' + archivados.length + ')</button>';
    if (archivadosAbiertos) {
      html += '<div class="archivados-lista">' +
        archivados.map(n => tarjetaManifiesto(n, por[n], true)).join('') + '</div>';
    }
  }

  els.manifiestosResultados.innerHTML = html;
}

async function verDetalleManifiesto(manifiesto) {
  els.manifiestosResultados.innerHTML = '<p class="cliente-loading">Cargando ' + escapeHtml(manifiesto) + '…</p>';
  try {
    const snapshot = await db.collection(COL_GUIAS).where('manifiesto', '==', manifiesto).get();
    const guias = [];
    snapshot.forEach(doc => guias.push(doc.data()));
    guias.sort((a, b) => (a.completa === b.completa) ? a.awb.localeCompare(b.awb) : (a.completa ? 1 : -1));

    const encabezado = '<button type="button" class="manifiesto-detalle__volver">← Volver</button>' +
      '<p class="cliente-total">' + escapeHtml(manifiesto) + ' — ' + guias.length + ' guía(s)</p>';

    els.manifiestosResultados.innerHTML = encabezado +
      (guias.length ? guias.map(g => renderItemGuia(g, g.cliente)).join('') : '<p class="cliente-empty">Sin guías.</p>');
  } catch (err) {
    els.manifiestosResultados.innerHTML = '<p class="error">No se pudo cargar el detalle.</p>';
  }
}

// ============================================
// REINICIAR MANIFIESTO — deja las guías en la app pero borra su
// estado de escaneo: vuelven todas a "pendiente 0/N" y se limpian
// las ubicaciones por caja. Útil para repetir una recepción o
// deshacer un turno de pruebas sin volver a importar nada.
// ============================================
async function reiniciarManifiesto(manifiesto, boton) {
  const confirmar = confirm(
    'REINICIAR "' + manifiesto + '"\n\n' +
    'Las guías se conservan, pero vuelven todas a estado pendiente (0/N) ' +
    'y se borran las ubicaciones por caja ya asignadas.\n\n' +
    'No hace falta volver a importar el manifiesto.\n' +
    'El historial de escaneos se conserva como bitácora.\n\n¿Continuar?'
  );
  if (!confirmar) return;

  boton.disabled = true;
  boton.textContent = 'Reiniciando…';

  try {
    const snapshot = await db.collection(COL_GUIAS).where('manifiesto', '==', manifiesto).get();
    const docs = snapshot.docs;

    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach(d => {
        batch.update(d.ref, { cajasEscaneadas: 0, completa: false, ubicaciones: [] });
      });
      await batch.commit();
    }

    // Deja constancia del reinicio en la bitácora
    await db.collection(COL_REGISTRO).add({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      operador: els.operadorInput.value.trim() || 'SIN NOMBRE',
      tipoEvento: 'REINICIO_MANIFIESTO',
      manifiesto: manifiesto,
      guiasAfectadas: docs.length
    });

    await recalcularResumen();
    await buscarManifiestos();
  } catch (err) {
    showError('No se pudo reiniciar el manifiesto: ' + err.message);
    boton.disabled = false;
    boton.textContent = 'Reiniciar';
  }
}

// ============================================
// ARCHIVAR / DESARCHIVAR
// Marca las guías con archivado=true y lo refleja en el resumen.
// La búsqueda por cliente filtra por ese campo en la consulta, así que
// un manifiesto archivado deja de consumir cuota de lectura.
// No se borra nada: sigue consultable desde su propia sección.
// ============================================
async function cambiarArchivado(manifiesto, archivar, boton) {
  boton.disabled = true;
  boton.textContent = archivar ? 'Archivando…' : 'Restaurando…';

  try {
    const snapshot = await db.collection(COL_GUIAS).where('manifiesto', '==', manifiesto).get();
    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { archivado: archivar }));
      await batch.commit();
    }

    await db.doc(DOC_RESUMEN).set({
      porManifiesto: { [manifiesto]: { archivado: archivar } }
    }, { merge: true });

    if (archivar) archivadosAbiertos = true;
    await buscarManifiestos();
  } catch (err) {
    showError('No se pudo ' + (archivar ? 'archivar' : 'desarchivar') + ': ' + err.message);
    boton.disabled = false;
    boton.textContent = archivar ? 'Archivar' : 'Desarchivar';
  }
}

// ============================================
// BORRAR HISTORIAL — SOLO PARA DATOS DE PRUEBA
// El historial es el respaldo de auditoría a 5 años. Esta acción lo
// destruye sin posibilidad de recuperación, por eso exige escribir el
// nombre del manifiesto a mano antes de ejecutarse.
// ============================================
async function borrarHistorialManifiesto(manifiesto, boton) {
  const advertencia =
    'BORRAR HISTORIAL DE "' + manifiesto + '"\n\n' +
    'Esto elimina de forma permanente todos los escaneos, correcciones y ' +
    'reinicios registrados para este manifiesto.\n\n' +
    'El historial es el respaldo de auditoría. Usa esto ÚNICAMENTE sobre ' +
    'manifiestos de prueba, nunca sobre operaciones reales.\n\n' +
    'No se puede deshacer.\n\n' +
    'Escribe ' + manifiesto + ' para confirmar:';

  const respuesta = prompt(advertencia);
  if (respuesta === null) return;

  if (respuesta.trim().toUpperCase() !== manifiesto.trim().toUpperCase()) {
    showError('El nombre no coincide. No se borró nada.');
    return;
  }

  boton.disabled = true;
  boton.textContent = 'Borrando historial…';

  try {
    const snapshot = await db.collection(COL_REGISTRO).where('manifiesto', '==', manifiesto).get();
    const docs = snapshot.docs;

    if (!docs.length) {
      showError('No se encontró historial para ' + manifiesto + '.');
      return;
    }

    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    cerrarMenus();
    mostrarConfirmacion('HISTORIAL BORRADO (' + docs.length + ' eventos)', 'YA_COMPLETA');
  } catch (err) {
    showError('No se pudo borrar el historial: ' + err.message);
  } finally {
    boton.disabled = false;
    boton.textContent = 'Borrar historial de pruebas';
  }
}

// ============================================
// EXPORTACIÓN A CSV
// Genera dos archivos: el listado de guías con su ubicación real por
// caja, y el historial completo de escaneos y correcciones. CSV plano
// para que se pueda abrir en cualquier equipo dentro de 5 años sin
// depender de esta aplicación ni de Firebase.
// ============================================
function csvCampo(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}

function csvLinea(campos) {
  return campos.map(csvCampo).join(',');
}

function descargarCSV(nombreArchivo, contenido) {
  // El BOM inicial hace que Excel lea bien las tildes y la Ñ
  const blob = new Blob(['\ufeff' + contenido], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatearFecha(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

async function exportarManifiesto(manifiesto, boton) {
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Generando…';

  try {
    const snapGuias = await db.collection(COL_GUIAS).where('manifiesto', '==', manifiesto).get();

    const filasGuias = [csvLinea([
      'AWB', 'Consignatario', 'Cliente', 'Tipo de cliente', 'Peso Total (kg)',
      'Cajas', 'Casillero', 'Manifiesto', 'Cajas escaneadas', 'Estado',
      'Ubicacion sugerida', 'Ubicacion real por caja'
    ])];

    snapGuias.forEach(doc => {
      const g = doc.data();
      const detalle = (g.ubicaciones || []).map(u => 'Caja ' + u.caja + ': ' + u.ubicacion).join(' | ');
      filasGuias.push(csvLinea([
        g.awb, g.consignatario, g.cliente, g.tipoCliente, g.pesoTotal,
        g.cajas, g.casillero, g.manifiesto, g.cajasEscaneadas || 0,
        g.completa ? 'COMPLETA' : 'PENDIENTE', g.ubicacionSugerida, detalle
      ]));
    });

    const snapReg = await db.collection(COL_REGISTRO).where('manifiesto', '==', manifiesto).get();
    const eventos = [];
    snapReg.forEach(doc => eventos.push(doc.data()));
    eventos.sort((a, b) => {
      const ta = a.timestamp && a.timestamp.seconds ? a.timestamp.seconds : 0;
      const tb = b.timestamp && b.timestamp.seconds ? b.timestamp.seconds : 0;
      return ta - tb;
    });

    const filasHist = [csvLinea([
      'Fecha y hora', 'AWB', 'Cliente', 'Operador', 'Tipo de evento',
      'Caja', 'Cajas totales', 'Ubicacion asignada', 'Manifiesto'
    ])];
    eventos.forEach(e => {
      filasHist.push(csvLinea([
        formatearFecha(e.timestamp), e.awb, e.cliente, e.operador, e.tipoEvento,
        e.cajaActual, e.cajasTotal, e.ubicacionFinal, e.manifiesto
      ]));
    });

    descargarCSV(manifiesto + '_guias.csv', filasGuias.join('\n'));
    setTimeout(() => descargarCSV(manifiesto + '_historial.csv', filasHist.join('\n')), 600);
  } catch (err) {
    showError('No se pudo exportar: ' + err.message);
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

// ============================================
// MIGRACIÓN — marca archivado=false en las guías que se crearon antes
// de que existiera este campo. Sin esto, la consulta filtrada no las
// devolvería y desaparecerían de la búsqueda por cliente.
// Corre una sola vez; queda registrada en el documento de resumen.
// ============================================
async function migrarCampoArchivado() {
  try {
    const resumenDoc = await db.doc(DOC_RESUMEN).get();
    if (resumenDoc.exists && resumenDoc.data().migracionArchivado) return;

    const snap = await db.collection(COL_GUIAS).get();
    const pendientes = snap.docs.filter(d => d.data().archivado === undefined);

    for (let i = 0; i < pendientes.length; i += 400) {
      const batch = db.batch();
      pendientes.slice(i, i + 400).forEach(d => batch.update(d.ref, { archivado: false }));
      await batch.commit();
    }

    await db.doc(DOC_RESUMEN).set({ migracionArchivado: true }, { merge: true });
  } catch (e) {
    console.warn('Migración de campo archivado pendiente:', e);
  }
}

// ============================================
// BORRAR MANIFIESTO — elimina sus guías y recalcula el resumen.
// El historial en `registro` NO se borra: queda como bitácora.
// ============================================
async function borrarManifiesto(manifiesto, boton) {
  const confirmar = confirm(
    'Vas a borrar TODAS las guías del manifiesto "' + manifiesto + '".\n\n' +
    'El historial de escaneos se conserva, pero las guías desaparecen de la app ' +
    'y habría que volver a importarlas.\n\n¿Continuar?'
  );
  if (!confirmar) return;

  boton.disabled = true;
  boton.textContent = 'Borrando…';

  try {
    const snapshot = await db.collection(COL_GUIAS).where('manifiesto', '==', manifiesto).get();

    // Borrado en lotes de 400 (límite Firestore = 500 por lote)
    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    await recalcularResumen();
    await buscarManifiestos();
  } catch (err) {
    showError('No se pudo borrar el manifiesto: ' + err.message);
    boton.disabled = false;
    boton.textContent = 'Borrar';
  }
}

// Recalcula el resumen leyendo las guías reales — evita que los
// contadores se desincronicen tras importar o borrar.
async function recalcularResumen() {
  const snapshot = await db.collection(COL_GUIAS).get();
  const porManifiesto = {};
  let totalGuias = 0;
  let totalCompletas = 0;

  snapshot.forEach(doc => {
    const g = doc.data();
    totalGuias++;
    if (g.completa) totalCompletas++;
    const m = g.manifiesto || 'SIN MANIFIESTO';
    if (!porManifiesto[m]) porManifiesto[m] = { total: 0, completas: 0 };
    porManifiesto[m].total++;
    if (g.completa) porManifiesto[m].completas++;
  });

  // Preserva el estado archivado que ya tuviera cada manifiesto
  const previo = await db.doc(DOC_RESUMEN).get();
  const porManifiestoPrevio = previo.exists ? (previo.data().porManifiesto || {}) : {};
  Object.keys(porManifiesto).forEach(m => {
    if (porManifiestoPrevio[m] && porManifiestoPrevio[m].archivado) porManifiesto[m].archivado = true;
  });

  await db.doc(DOC_RESUMEN).set({ totalGuias, totalCompletas, porManifiesto, migracionArchivado: true });
  pintarProgreso({ totalGuias, totalCompletas, porManifiesto });
}

function cerrarMenus() {
  document.querySelectorAll('.menu-desplegable').forEach(m => m.dataset.abierto = 'false');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-wrap')) cerrarMenus();
});

els.manifiestosResultados.addEventListener('click', (e) => {
  const btnMenu = e.target.closest('.manifiesto-item__menu');
  if (btnMenu) {
    const menu = els.manifiestosResultados.querySelector('.menu-desplegable[data-menu-de="' + btnMenu.dataset.menu + '"]');
    const estaAbierto = menu && menu.dataset.abierto === 'true';
    cerrarMenus();
    if (menu && !estaAbierto) menu.dataset.abierto = 'true';
    return;
  }

  const btnToggle = e.target.closest('.archivados-toggle');
  if (btnToggle) { archivadosAbiertos = !archivadosAbiertos; buscarManifiestos(); return; }

  const btnExportar = e.target.closest('.manifiesto-item__exportar');
  if (btnExportar) { exportarManifiesto(btnExportar.dataset.exportar, btnExportar); return; }

  const btnArchivar = e.target.closest('[data-archivar]');
  if (btnArchivar) { cerrarMenus(); cambiarArchivado(btnArchivar.dataset.archivar, true, btnArchivar); return; }

  const btnDesarchivar = e.target.closest('.manifiesto-item__desarchivar');
  if (btnDesarchivar) { cambiarArchivado(btnDesarchivar.dataset.desarchivar, false, btnDesarchivar); return; }

  const btnReiniciar = e.target.closest('[data-reiniciar]');
  if (btnReiniciar) { cerrarMenus(); reiniciarManifiesto(btnReiniciar.dataset.reiniciar, btnReiniciar); return; }
  const btnBorrarHist = e.target.closest('[data-borrar-historial]');
  if (btnBorrarHist) { borrarHistorialManifiesto(btnBorrarHist.dataset.borrarHistorial, btnBorrarHist); return; }
  const btnBorrar = e.target.closest('[data-borrar]');
  if (btnBorrar) { cerrarMenus(); borrarManifiesto(btnBorrar.dataset.borrar, btnBorrar); return; }
  const btnConteo = e.target.closest('.manifiesto-item__conteo-btn');
  if (btnConteo) { verDetalleManifiesto(btnConteo.dataset.hoja); return; }
  const btnVolver = e.target.closest('.manifiesto-detalle__volver');
  if (btnVolver) buscarManifiestos();
});

// ============================================
// IMPORTACIÓN DESDE TSV
// ============================================
function parsearTSV(texto) {
  const lineas = texto.trim().split('\n');
  const guias = [];

  lineas.forEach(linea => {
    const cols = linea.split('\t');
    const awb = (cols[0] || '').trim();
    if (!awb || /^awb$/i.test(awb)) return;

    const pesoTotal = parseFloat((cols[10] || '').replace(',', '.')) || 0;
    const cajas = parseInt(cols[6], 10) || 1;
    const tipoCliente = (cols[14] || 'SIN CLASIFICAR').trim().toUpperCase();
    const manifiesto = (cols[15] || '').trim();
    const estadoTexto = (cols[16] || '').trim().toUpperCase();
    const ubicacionSugerida = calcularUbicacion(pesoTotal, tipoCliente);

    let cajasEscaneadas = 0;
    if (estadoTexto === 'REGISTRADO') {
      cajasEscaneadas = cajas;
    } else {
      cajasEscaneadas = parseInt(estadoTexto.split('/')[0], 10) || 0;
    }
    const completa = cajasEscaneadas >= cajas;

    // Para guías que llegan ya escaneadas, asumimos la ubicación sugerida
    // en cada caja (no hay dato histórico por caja en la hoja de origen).
    const ubicaciones = [];
    for (let c = 1; c <= cajasEscaneadas; c++) {
      ubicaciones.push({ caja: c, ubicacion: ubicacionSugerida });
    }

    guias.push({
      awb: awb.toUpperCase(),
      consignatario: (cols[1] || '').trim(),
      cliente: (cols[13] || '').trim(),
      clienteNorm: limpiarNombre(cols[13] || ''),
      pesoTotal, cajas, tipoCliente, manifiesto,
      casillero: (cols[9] || '').trim(),
      ubicacionSugerida, cajasEscaneadas, completa, ubicaciones,
      archivado: false
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
  els.importPreview.textContent = guiasParsadas.length + ' guías · Manifiestos: ' +
    (manifiestos.join(', ') || '(sin dato)') + ' · Ya registradas: ' + completas;
  els.importCargarBtn.disabled = false;
});

els.importCargarBtn.addEventListener('click', async () => {
  if (!guiasParsadas.length) return;

  els.importCargarBtn.disabled = true;
  els.importPrevisualizarBtn.disabled = true;
  els.importLog.innerHTML = '';

  try {
    const LOTE = 400;
    let escritas = 0;
    for (let i = 0; i < guiasParsadas.length; i += LOTE) {
      const batch = db.batch();
      guiasParsadas.slice(i, i + LOTE).forEach(g => {
        batch.set(db.collection(COL_GUIAS).doc(g.awb), g);
      });
      await batch.commit();
      escritas += Math.min(LOTE, guiasParsadas.length - i);
      logImport('✅ ' + escritas + ' / ' + guiasParsadas.length + ' guías cargadas…', 'ok');
    }

    // Recalcula desde los datos reales — así reimportar el mismo
    // manifiesto no duplica los contadores.
    await recalcularResumen();
    logImport('✅ Resumen recalculado. Importación completa.', 'ok');

    guiasParsadas = [];
    els.importTextarea.value = '';
    els.importPreview.textContent = '';
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
    els.tabEscanear.hidden    = activo !== 'escanear';
    els.tabCliente.hidden     = activo !== 'cliente';
    els.tabManifiestos.hidden = activo !== 'manifiestos';
    els.tabImportar.hidden    = activo !== 'importar';
    if (activo !== 'escanear' && camaraActiva) detenerCamara();
    if (activo === 'escanear') els.awbInput.focus();
    if (activo === 'manifiestos') buscarManifiestos();
  });
});

// ============================================
// ARRANQUE
// ============================================
auth.onAuthStateChanged(user => {
  if (user) {
    setStatus('ok');
    actualizarProgreso();
    migrarCampoArchivado();
  }
});

auth.signInAnonymously().catch(err => {
  setStatus('error');
  showError('No se pudo conectar con Firebase: ' + err.message);
});

cargarOperador();
els.awbInput.focus();
setInterval(actualizarProgreso, 30000);
