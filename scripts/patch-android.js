// Aplica ao projeto Android gerado pelo Capacitor: modo quiosco, icone e tela cheia.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = path.join(root, 'android', 'app', 'src', 'main');
const pkgDir = path.join(app, 'java', 'com', 'brasilhomens', 'catalogo');

function must(cond, msg) { if (!cond) { console.error('ERRO: ' + msg); process.exit(1); } }
function copy(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }

must(fs.existsSync(pkgDir), 'pasta do pacote nao encontrada: ' + pkgDir);

// 0. remove de www/media tudo o que o catalogo nao usa (sobras de versoes antigas)
const www = path.join(root, 'www');
const code = fs.readFileSync(path.join(www, 'app.js'), 'utf8') + fs.readFileSync(path.join(www, 'index.html'), 'utf8');
const mediaDir = path.join(www, 'media');
if (fs.existsSync(mediaDir)) {
  fs.readdirSync(mediaDir).forEach(f => {
    if (!code.includes(f)) { fs.unlinkSync(path.join(mediaDir, f)); console.log('Removido (nao usado): media/' + f); }
  });
}

// 1. codigo nativo
['MainActivity.java', 'KioskPlugin.java', 'KioskAdminReceiver.java'].forEach(f =>
  copy(path.join(root, 'native', f), path.join(pkgDir, f)));
copy(path.join(root, 'native', 'device_admin.xml'), path.join(app, 'res', 'xml', 'device_admin.xml'));

// 2. icones
const icons = path.join(root, 'native', 'icons');
fs.readdirSync(icons).forEach(d => {
  fs.readdirSync(path.join(icons, d)).forEach(f =>
    copy(path.join(icons, d, f), path.join(app, 'res', d, f)));
});
const bg = path.join(app, 'res', 'values', 'ic_launcher_background.xml');
fs.writeFileSync(bg, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#000000</color>\n</resources>\n');

// 3. manifesto
const mf = path.join(app, 'AndroidManifest.xml');
let x = fs.readFileSync(mf, 'utf8');
if (!x.includes('KioskAdminReceiver')) {
  const homeFilter =
    '\n            <intent-filter>\n' +
    '                <action android:name="android.intent.action.MAIN" />\n' +
    '                <category android:name="android.intent.category.HOME" />\n' +
    '                <category android:name="android.intent.category.DEFAULT" />\n' +
    '            </intent-filter>\n';
  const a1 = '</intent-filter>\n\n        </activity>';
  must(x.includes(a1), 'ancora da activity nao encontrada no manifesto');
  x = x.replace(a1, '</intent-filter>\n' + homeFilter + '\n        </activity>');
  const receiver =
    '\n        <receiver\n' +
    '            android:name=".KioskAdminReceiver"\n' +
    '            android:exported="true"\n' +
    '            android:permission="android.permission.BIND_DEVICE_ADMIN">\n' +
    '            <meta-data\n' +
    '                android:name="android.app.device_admin"\n' +
    '                android:resource="@xml/device_admin" />\n' +
    '            <intent-filter>\n' +
    '                <action android:name="android.app.action.DEVICE_ADMIN_ENABLED" />\n' +
    '            </intent-filter>\n' +
    '        </receiver>\n';
  must(x.includes('</application>'), 'ancora </application> nao encontrada');
  x = x.replace('</application>', receiver + '    </application>');
  // sem backup automatico do Android para a nuvem
  x = x.replace('android:allowBackup="true"', 'android:allowBackup="false"');
  fs.writeFileSync(mf, x);
}
console.log('Projeto Android ajustado.');
