# APK de Cosechas Presbere (TWA)

Esto **no** es una app nativa aparte: es un envoltorio delgado (Trusted Web
Activity / TWA) que abre `https://bananera-app.web.app` a pantalla completa,
sin barra de navegador. El contenido real sigue viviendo en Firebase
Hosting — **cualquier cambio que se despliegue ahí se ve solo la próxima vez
que alguien abre la app, sin reinstalar el APK.**

Solo hace falta generar un APK nuevo si cambia algo a nivel nativo:
ícono, nombre del paquete, colores de la barra de estado, etc. (lo que vive
en `twa-manifest.json`, que a su vez se generó a partir de
`frontend/manifest.json`).

## Requisitos para reconstruir

- JDK **17** (no funciona con 8 ni con versiones más nuevas — Bubblewrap lo
  exige exacto). Si no está instalado, descargar Eclipse Temurin 17:
  https://adoptium.net/temurin/releases/?version=17
- Android SDK con `build-tools;36.1.0`, `platform-tools` y al menos una
  `platform` instalada (cualquiera reciente sirve, el TWA usa `minSdkVersion`
  bajo).
- `npm install -g @bubblewrap/cli`
- La huella `android.keystore` de este proyecto (**no está en el repo por
  seguridad** — pedírsela a quien lo generó, o generar una nueva si se
  perdió; ver abajo).

Apuntar Bubblewrap a las herramientas (una sola vez por máquina):

```
bubblewrap updateConfig --jdkPath="<ruta al JDK 17>" --androidSdkPath="<ruta al Android SDK>"
bubblewrap doctor   # debe decir "Your jdkpath and androidSdkPath are valid."
```

### Nota sobre el Android SDK "cmdline-tools" moderno

Si el Android SDK solo tiene `cmdline-tools/latest` (sin una carpeta `tools/`
en la raíz), Bubblewrap no reconoce la ruta como válida. Arreglo de una sola
vez (crea un enlace, no duplica archivos):

```powershell
New-Item -ItemType Junction -Path "<SDK>\tools" -Target "<SDK>\cmdline-tools\latest"
```

### Nota sobre `bubblewrap build` fallando al instalar build-tools

Con Android SDK muy reciente, el paso automático de Bubblewrap para instalar
`build-tools;36.1.0` puede fallar con un error de "Illegal char" en la ruta
(bug de cómo Bubblewrap invoca la herramienta nueva `android` de línea de
comandos en Windows). Si pasa, instalarlo a mano una vez y Bubblewrap lo
detectará ya instalado en el siguiente intento:

```
<SDK>\cmdline-tools\latest\bin\android.exe --sdk="<SDK>" sdk install "build-tools/36.1.0"
```

### Nota sobre `gradlew.bat: no se reconoce como un comando`

Si `bubblewrap build` genera el proyecto pero falla al compilar con ese
error, es otro problema de cómo Node invoca procesos en Windows. Solución:
correr Gradle directamente desde esta carpeta (usa el `gradlew.bat` que ya
generó Bubblewrap):

```bash
export JAVA_HOME="<ruta al JDK 17>"
./gradlew.bat assembleRelease
```

Y firmar el resultado a mano:

```bash
BT="<SDK>/build-tools/36.1.0"
"$BT/zipalign.exe" -v -p 4 app/build/outputs/apk/release/app-release-unsigned.apk app-release-unsigned-aligned.apk
"$BT/apksigner.bat" sign --ks android.keystore --ks-pass "pass:<CONTRASEÑA>" --key-pass "pass:<CONTRASEÑA>" \
  --ks-key-alias cosechaspresbere --out app-release-signed.apk app-release-unsigned-aligned.apk
```

## Rebuild normal (cuando todo lo anterior ya funciona)

```bash
export BUBBLEWRAP_KEYSTORE_PASSWORD="<contraseña del keystore>"
export BUBBLEWRAP_KEY_PASSWORD="<misma contraseña>"
bubblewrap build
```

Genera `app-release-signed.apk` (para instalar directo en un teléfono) y
`app-release-bundle.aab` (para subir a Google Play, si algún día se publica
ahí).

## Verificación de dominio (Digital Asset Links)

Para que el APK abra sin barra de navegador, el dominio debe confirmar que
es dueño de la firma del APK. Eso vive en
`frontend/.well-known/assetlinks.json` (ya publicado en producción) y debe
coincidir con la huella SHA-256 de `android.keystore`. Si algún día se
regenera el keystore, hay que actualizar ese archivo con la huella nueva:

```
keytool -list -v -keystore android.keystore -alias cosechaspresbere -storepass <CONTRASEÑA>
```

**Importante:** `firebase.json` tiene una excepción explícita
(`"!/.well-known/**"`) para que Firebase Hosting no ignore esta carpeta —
por defecto ignora todo lo que empieza con punto.

## Si se pierde el keystore

No hay forma de recuperarlo — hay que generar uno nuevo (mismo comando de
`keytool` de arriba con un `alias`/contraseña nuevos), actualizar
`assetlinks.json` con la huella nueva, y reconstruir el APK. Cualquiera que
ya tenga el APK viejo instalado **no podrá actualizarlo** con el nuevo APK
sin desinstalar primero, porque Android exige que las actualizaciones estén
firmadas con la misma llave. Por eso conviene guardar el keystore y su
contraseña en un lugar seguro (gestor de contraseñas, no en este repo).
