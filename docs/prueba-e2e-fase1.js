// Prueba end-to-end manual (no forma parte del repositorio entregado):
// login, selección finca/área, creación de área SIN internet, reconexión y
// verificación de que sincroniza sin duplicar.
const { chromium } = require('playwright');

function log(msg) {
  console.log(`[e2e] ${msg}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[navegador:error]', m.text());
  });

  await page.goto('http://localhost:8080/index.html');

  // ---- Login ----
  await page.fill('#campo-usuario', 'admin');
  await page.fill('#campo-password', 'cambiar123');
  await page.click('#form-login button[type=submit]');
  await page.waitForSelector('#vista-selector-finca:not([hidden])', { timeout: 8000 });
  log('Login OK, selector de finca visible');

  // ---- Seleccionar Finca 1 ----
  await page.click('.tarjeta-finca >> text=Finca 1');
  await page.waitForSelector('#vista-selector-area:not([hidden])', { timeout: 8000 });
  log('Selector de área visible tras elegir Finca 1');

  // ---- Ir sin conexión ANTES de crear el área ----
  await context.setOffline(true);
  log('Contexto puesto SIN CONEXIÓN');

  await page.waitForTimeout(500);
  const indicadorOffline = await page.textContent('#indicador-conexion');
  log(`Indicador tras desconectar: "${indicadorOffline}"`);
  if (!indicadorOffline.includes('📴')) throw new Error('El indicador no muestra "sin conexión"');

  // ---- Crear un área ESTANDO offline ----
  page.once('dialog', (dialog) => dialog.accept('Área de prueba offline'));
  await page.click('#boton-agregar-area');
  await page.waitForTimeout(700);

  const listaTexto = await page.textContent('#lista-areas');
  if (!listaTexto.includes('Área de prueba offline')) {
    throw new Error('El área creada offline no aparece en la lista local (falló el guardado optimista en IndexedDB)');
  }
  log('Área creada offline aparece de inmediato en la UI (guardado local funcionando)');

  const indicadorPendiente = await page.textContent('#indicador-conexion');
  log(`Indicador tras crear offline: "${indicadorPendiente}"`);
  if (!indicadorPendiente.includes('🟡') && !indicadorPendiente.includes('📴')) {
    throw new Error('El indicador no refleja que hay un registro pendiente de sincronizar');
  }

  // ---- Cerrar y reabrir la app SIGUIENDO sin internet (simula cerrar la app en el campo) ----
  await page.reload();
  await page.waitForSelector('#vista-inicio:not([hidden]), #vista-selector-area:not([hidden]), #vista-selector-finca:not([hidden])', { timeout: 8000 });
  // La sesión y la selección de finca/área deben recordarse tras recargar
  const contextoTrasReload = await page.textContent('#barra-contexto');
  log(`Contexto tras recargar (offline): "${contextoTrasReload}"`);
  if (!contextoTrasReload.includes('Finca 1')) {
    throw new Error('No se recordó la finca activa tras recargar la app');
  }

  // Reabrir el selector de área para reconfirmar que el área sigue local
  await page.click('#boton-cambiar-finca');
  await page.click('.tarjeta-finca >> text=Finca 1');
  await page.waitForSelector('#vista-selector-area:not([hidden])');
  const listaTrasReload = await page.textContent('#lista-areas');
  if (!listaTrasReload.includes('Área de prueba offline')) {
    throw new Error('El área creada offline se perdió al recargar (no debería pasar: IndexedDB debe persistir)');
  }
  log('El área offline sigue presente tras recargar la app (persistencia local OK)');

  // ---- Reconectar y esperar a que sincronice ----
  await context.setOffline(false);
  log('Contexto reconectado a internet');
  await page.waitForFunction(
    () => document.getElementById('indicador-conexion').textContent.includes('🟢'),
    { timeout: 15000 }
  );
  log('Indicador pasó a 🟢 Sincronizado');

  // ---- Verificar en el backend que existe exactamente UNA fila (no duplicada) ----
  const resp = await page.evaluate(async () => {
    const login = await fetch('http://localhost:3000/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: 'admin', password: 'cambiar123' }),
    }).then((r) => r.json());
    const areas = await fetch('http://localhost:3000/fincas/00000000-0000-0000-0001-000000000001/areas', {
      headers: { Authorization: `Bearer ${login.accessToken}` },
    }).then((r) => r.json());
    return areas.filter((a) => a.nombre === 'Área de prueba offline');
  });
  log(`Filas en el servidor con ese nombre: ${resp.length}`);
  if (resp.length !== 1) {
    throw new Error(`Se esperaba exactamente 1 fila sincronizada, se encontraron ${resp.length} (duplicación o falla de sync)`);
  }

  log('✅ TODO OK: guardado offline, persistencia, reconexión y sincronización sin duplicar — verificado de punta a punta.');
  await browser.close();
  process.exit(0);
})().catch((err) => {
  console.error('❌ FALLÓ LA PRUEBA:', err.message);
  process.exit(1);
});
