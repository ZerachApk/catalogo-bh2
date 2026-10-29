(function(){
'use strict';
/* Catalogo Brasil Homens: app offline para tablet. Dados em localStorage + IndexedDB (somente no aparelho). */
var APP_VERSION='3.0 (teste)';
var MAXPAD=5;
var SECURE=false; /* true = bloqueia captura de tela. Fica false no teste para poder tirar prints. */
var IDLE_MS=150000;

function $(s,r){return (r||document).querySelector(s);}
function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function fmtTime(t){t=Math.max(0,t||0);return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');}
function play(v){try{var pr=v.play();if(pr&&pr.catch)pr.catch(function(){});}catch(e){}}

var Kiosk=null;
try{if(window.Capacitor&&window.Capacitor.registerPlugin)Kiosk=window.Capacitor.registerPlugin('Kiosk');}catch(e){Kiosk=null;}

/* ---------- armazenamento ---------- */
var ST={pin:null,over:{},custom:[],fails:0,lockUntil:0};
function loadState(){try{var j=localStorage.getItem('bh.state');if(j){var o=JSON.parse(j);if(o&&typeof o==='object'){ST.pin=o.pin||null;ST.over=o.over||{};ST.custom=o.custom||[];ST.fails=o.fails||0;ST.lockUntil=o.lockUntil||0;}}}catch(e){}}
function saveState(){try{localStorage.setItem('bh.state',JSON.stringify(ST));}catch(e){}}
var db=null;
function idb(){return new Promise(function(res){
  if(db)return res(db);
  try{var r=indexedDB.open('bh-media',1);r.onupgradeneeded=function(){r.result.createObjectStore('m');};r.onsuccess=function(){db=r.result;res(db);};r.onerror=function(){res(null);};}catch(e){res(null);}
});}
function idbPut(k,v){return idb().then(function(d){return new Promise(function(res,rej){if(!d)return rej(new Error('Sem armazenamento no aparelho.'));var t=d.transaction('m','readwrite');t.objectStore('m').put(v,k);t.oncomplete=function(){res();};t.onerror=function(){rej(t.error||new Error('Falha ao salvar.'));};t.onabort=function(){rej(t.error||new Error('Sem espaço para salvar.'));};});});}
function idbGet(k){return idb().then(function(d){return new Promise(function(res){if(!d)return res(null);var r=d.transaction('m','readonly').objectStore('m').get(k);r.onsuccess=function(){res(r.result||null);};r.onerror=function(){res(null);};});});}
function idbDel(k){return idb().then(function(d){return new Promise(function(res){if(!d)return res();var t=d.transaction('m','readwrite');t.objectStore('m').delete(k);t.oncomplete=function(){res();};t.onerror=function(){res();};});});}
try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist();}catch(e){}

/* ---------- PIN ---------- */
function rnd(n){var a=new Uint8Array(n);(window.crypto||{getRandomValues:function(x){for(var i=0;i<x.length;i++)x[i]=Math.floor(Math.random()*256);}}).getRandomValues(a);return Array.prototype.map.call(a,function(x){return x.toString(16).padStart(2,'0');}).join('');}
function sha(s){
  if(window.crypto&&crypto.subtle&&window.TextEncoder){
    return crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)).then(function(b){return Array.prototype.map.call(new Uint8Array(b),function(x){return x.toString(16).padStart(2,'0');}).join('');});
  }
  var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  return Promise.resolve('f'+(h>>>0).toString(16));
}
function genRecovery(){var al='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',o='',a=new Uint8Array(8);(window.crypto||{getRandomValues:function(x){for(var i=0;i<x.length;i++)x[i]=Math.floor(Math.random()*256);}}).getRandomValues(a);for(var i=0;i<8;i++){o+=al[a[i]%al.length];if(i===3)o+='-';}return o;}
function normRec(s){return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');}

/* ---------- modal ---------- */
var modal=$('#modal'),mbody=$('#mbody');
function openModal(html){mbody.innerHTML=html;modal.hidden=false;}
function closeModal(){modal.hidden=true;mbody.innerHTML='';pinCtx=null;}
var pinCtx=null;
function dots(){var n=pinCtx?pinCtx.val.length:0,h='';for(var i=0;i<8;i++)h+='<i class="'+(i<n?'on':'')+'"></i>';return h;}
function askPin(o){
  return new Promise(function(resolve){
    pinCtx={val:'',resolve:resolve};
    var keys='';for(var i=1;i<=9;i++)keys+='<button type="button" data-act="pk" data-k="'+i+'">'+i+'</button>';
    keys+='<button type="button" data-act="pk" data-k="back" aria-label="Apagar">⌫</button><button type="button" data-act="pk" data-k="0">0</button><button type="button" class="ok" data-act="pk" data-k="ok">OK</button>';
    openModal('<h2>'+esc(o.title)+'</h2>'+(o.sub?'<p class="note">'+esc(o.sub)+'</p>':'')+'<div class="pindots" id="pindots" aria-live="polite">'+dots()+'</div><div class="err" id="pinerr" hidden></div><div class="keypad">'+keys+'</div><div class="mactions">'+(o.cancel===false?'':'<button type="button" class="mini" data-act="pk" data-k="cancel">Cancelar</button>')+(o.forgot?'<button type="button" class="mini" data-act="pk" data-k="forgot">Esqueci o PIN</button>':'')+'</div>');
  });
}
function pinKey(k){
  if(!pinCtx)return;
  var c=pinCtx;
  if(k==='back'){c.val=c.val.slice(0,-1);}
  else if(k==='cancel'){var r1=c.resolve;closeModal();r1(null);return;}
  else if(k==='forgot'){var r2=c.resolve;closeModal();r2('__forgot__');return;}
  else if(k==='ok'){
    if(c.val.length<4){var e=$('#pinerr');e.textContent='Use de 4 a 8 números.';e.hidden=false;return;}
    var r3=c.resolve,v=c.val;closeModal();r3(v);return;
  }else if(c.val.length<8){c.val+=k;}
  var d=$('#pindots');if(d)d.innerHTML=dots();
  var er=$('#pinerr');if(er)er.hidden=true;
}
function showRecovery(code){
  return new Promise(function(resolve){
    openModal('<h2>Guarde este código</h2><p class="note">Ele é a única forma de recuperar o acesso se o PIN for esquecido. Anote em papel e guarde longe do tablet. Ele não será mostrado de novo.</p><div class="reccode">'+esc(code)+'</div><button class="cta" type="button" data-act="recok" style="width:100%">Anotei o código</button>');
    pinCtx={val:'',resolve:resolve,recovery:true};
  });
}
function askText(title,sub,ph){
  return new Promise(function(resolve){
    pinCtx={val:'',resolve:resolve,text:true};
    openModal('<h2>'+esc(title)+'</h2>'+(sub?'<p class="note">'+esc(sub)+'</p>':'')+'<div class="field" style="margin:14px 0"><input id="txtin" autocomplete="off" autocapitalize="characters" placeholder="'+esc(ph||'')+'"></div><div class="mactions"><button class="cta" type="button" data-act="txtok">Confirmar</button><button class="mini" type="button" data-act="txtcancel">Cancelar</button></div>');
    setTimeout(function(){var i=$('#txtin');if(i)i.focus();},50);
  });
}

async function setupPin(first){
  while(true){
    var p1=await askPin({title:first?'Criar o PIN do administrador':'Novo PIN',sub:'De 4 a 8 números. Libera a área da equipe e a saída do app.',cancel:!first});
    if(p1===null)return false;
    var p2=await askPin({title:'Repita o PIN',cancel:!first});
    if(p2===null)return false;
    if(p1!==p2){toast('Os PINs não conferem. Tente de novo.');continue;}
    var rec=genRecovery(),salt=rnd(8),rsalt=rnd(8);
    ST.pin={salt:salt,hash:await sha(salt+p1),rsalt:rsalt,rhash:await sha(rsalt+normRec(rec))};
    ST.fails=0;ST.lockUntil=0;saveState();
    await showRecovery(rec);
    return true;
  }
}
function lockedMsg(){var s=Math.ceil((ST.lockUntil-Date.now())/1000);toast('Muitas tentativas. Aguarde '+s+' segundos.');}
function registerFail(){ST.fails=(ST.fails||0)+1;if(ST.fails>=5){ST.lockUntil=Date.now()+60000;ST.fails=0;saveState();toast('Errou 5 vezes. Aguarde 1 minuto.');return true;}saveState();return false;}
async function verifyPin(){
  while(true){
    if(ST.lockUntil>Date.now()){lockedMsg();return false;}
    var r=await askPin({title:'PIN do administrador',cancel:true,forgot:true});
    if(r===null)return false;
    if(r==='__forgot__')return recoverPin();
    if(await sha(ST.pin.salt+r)===ST.pin.hash){ST.fails=0;saveState();return true;}
    if(registerFail())return false;
    toast('PIN incorreto.');
  }
}
async function recoverPin(){
  while(true){
    if(ST.lockUntil>Date.now()){lockedMsg();return false;}
    var t=await askText('Código de recuperação','Digite o código anotado na criação do PIN.','XXXX-XXXX');
    if(t===null)return false;
    if(await sha(ST.pin.rsalt+normRec(t))===ST.pin.rhash){return setupPin(false);}
    if(registerFail())return false;
    toast('Código incorreto.');
  }
}
var adminBusy=false;
async function adminEntry(){
  if(adminBusy)return;adminBusy=true;
  try{
    if(!ST.pin){await setupPin(true);enableKiosk();}
    var ok=await verifyPin();
    if(ok){S.view='staff';S.staff.on=true;S.staff.tab='modelos';renderAll();window.scrollTo(0,0);}
  }finally{adminBusy=false;}
}
var taps=[];
function logoTap(){
  var n=Date.now();taps.push(n);taps=taps.filter(function(t){return n-t<4000;});
  if(taps.length>=5){taps=[];adminEntry();return;}
  if(S.view!=='shop'){S.view='shop';S.staff.on=false;renderAll();}
}

/* ---------- quiosco ---------- */
function enableKiosk(){if(!Kiosk)return Promise.resolve(null);return Kiosk.enable({secure:SECURE}).catch(function(){return null;});}
function disableKiosk(){if(!Kiosk)return Promise.resolve(null);return Kiosk.disable().catch(function(){return null;});}
function kioskStatus(){if(!Kiosk)return Promise.resolve(null);return Kiosk.status().catch(function(){return null;});}

/* ---------- catalogo ---------- */
var ADS=[{id:'ad1',ad:true,photo:'media/ad-1.jpg'},{id:'ad2',ad:true,photo:'media/ad-2.jpg'},{id:'ad3',ad:true,photo:'media/ad-3.jpg'},{id:'ad4',ad:true,photo:'media/ad-4.jpg'},{id:'ad5',ad:true,photo:'media/ad-5.jpg'}];
var AD_EVERY=8;
var FAMS=["Branco", "Bege", "Amarelo", "Rosé", "Vinho", "Verde", "Petróleo", "Azul claro", "Azul médio", "Azul royal", "Azul-marinho", "Cinza claro", "Cinza", "Grafite", "Preto"];
var BUILTIN=[
 {id:'01',num:1,name:"Verde-petróleo",fam:"Petróleo",hex:'#18414d',cut:'media/cut-01.webp',photo:'media/01.jpg',video:'media/01.mp4',pad:false},
 {id:'02',num:2,name:"Azul-marinho com lapela preta",fam:"Azul-marinho",hex:'#121b30',cut:'media/cut-02.webp',photo:'media/02.jpg',video:'media/02.mp4',pad:false},
 {id:'03',num:3,name:"Taupe",fam:"Bege",hex:'#8c6d58',cut:'media/cut-03.webp',photo:'media/03.jpg',video:'media/03.mp4',pad:false},
 {id:'04',num:4,name:"Vinho",fam:"Vinho",hex:'#4d1517',cut:'media/cut-04.webp',photo:'media/04.jpg',video:'media/04.mp4',pad:false},
 {id:'05',num:5,name:"Verde-sálvia",fam:"Verde",hex:'#58573f',cut:'media/cut-05.webp',photo:'media/05.jpg',video:'media/05.mp4',pad:false},
 {id:'06',num:6,name:"Vinho com lapela preta",fam:"Vinho",hex:'#461215',cut:'media/cut-06.webp',photo:'media/06.jpg',video:'media/06.mp4',pad:false},
 {id:'07',num:7,name:"Verde-oliva",fam:"Verde",hex:'#473a21',cut:'media/cut-07.webp',photo:'media/07.jpg',video:'media/07.mp4',pad:false},
 {id:'08',num:8,name:"Verde-esmeralda",fam:"Verde",hex:'#0e3934',cut:'media/cut-08.webp',photo:'media/08.jpg',video:'media/08.mp4',pad:false},
 {id:'09',num:9,name:"Verde-menta",fam:"Verde",hex:'#888964',cut:'media/cut-09.webp',photo:'media/09.jpg',video:'media/09.mp4',pad:false},
 {id:'10',num:10,name:"Terracota",fam:"Vinho",hex:'#551717',cut:'media/cut-10.webp',photo:'media/10.jpg',video:'media/10.mp4',pad:false},
 {id:'11',num:11,name:"Bege-areia",fam:"Bege",hex:'#ad907c',cut:'media/cut-11.webp',photo:'media/11.jpg',video:'media/11.mp4',pad:false},
 {id:'12',num:12,name:"Off-white com lapela de cetim",fam:"Branco",hex:'#cfbaa2',cut:'media/cut-12.webp',photo:'media/12.jpg',video:'media/12.mp4',pad:false},
 {id:'13',num:13,name:"Rosé-nude",fam:"Rosé",hex:'#af8d7c',cut:'media/cut-13.webp',photo:'media/13.jpg',video:'media/13.mp4',pad:false},
 {id:'14',num:14,name:"Rosé-nude claro",fam:"Rosé",hex:'#a68779',cut:'media/cut-14.webp',photo:'media/14.jpg',video:null,pad:false},
 {id:'15',num:15,name:"Preto com lapela de cetim",fam:"Preto",hex:'#13110f',cut:'media/cut-15.webp',photo:'media/15.jpg',video:'media/15.mp4',pad:false},
 {id:'16',num:16,name:"Preto clássico",fam:"Preto",hex:'#1a1816',cut:'media/cut-16.webp',photo:'media/16.jpg',video:'media/16.mp4',padimg:'media/pad-16.jpg',pad:true,padName:'Preto'},
 {id:'17',num:17,name:"Preto jacquard",fam:"Preto",hex:'#1c1a16',cut:'media/cut-17.webp',photo:'media/17.jpg',video:'media/17.mp4',pad:false},
 {id:'18',num:18,name:"Preto com brilhos",fam:"Preto",hex:'#151211',cut:'media/cut-18.webp',photo:'media/18.jpg',video:'media/18.mp4',pad:false},
 {id:'19',num:19,name:"Preto lapela de cetim",fam:"Preto",hex:'#171412',cut:'media/cut-19.webp',photo:'media/19.jpg',video:'media/19.mp4',pad:false},
 {id:'20',num:20,name:"Prata paisley",fam:"Cinza",hex:'#4d3e38',cut:'media/cut-20.webp',photo:'media/20.jpg',video:'media/20.mp4',pad:false},
 {id:'21',num:21,name:"Azul-marinho",fam:"Azul-marinho",hex:'#121a2d',cut:'media/cut-21.webp',photo:'media/21.jpg',video:'media/21.mp4',padimg:'media/pad-21.jpg',pad:true,padName:'Azul-marinho'},
 {id:'22',num:22,name:"Azul-royal com lapela de cetim",fam:"Azul royal",hex:'#0f254d',cut:'media/cut-22.webp',photo:'media/22.jpg',video:'media/22.mp4',pad:false},
 {id:'23',num:23,name:"Azul-marinho gravata champanhe",fam:"Azul-marinho",hex:'#131929',cut:'media/cut-23.webp',photo:'media/23.jpg',video:'media/23.mp4',pad:false},
 {id:'24',num:24,name:"Marsala",fam:"Vinho",hex:'#552c2d',cut:'media/cut-24.webp',photo:'media/24.jpg',video:'media/24.mp4',pad:false},
 {id:'25',num:25,name:"Marfim",fam:"Branco",hex:'#bdac95',cut:'media/cut-25.webp',photo:'media/25.jpg',video:'media/25.mp4',pad:false},
 {id:'26',num:26,name:"Grafite xadrez",fam:"Grafite",hex:'#2f2c2a',cut:'media/cut-26.webp',photo:'media/26.jpg',video:'media/26.mp4',pad:false},
 {id:'27',num:27,name:"Azul-royal",fam:"Azul royal",hex:'#182b51',cut:'media/cut-27.webp',photo:'media/27.jpg',video:'media/27.mp4',pad:false},
 {id:'28',num:28,name:"Mostarda",fam:"Amarelo",hex:'#a3631b',cut:'media/cut-28.webp',photo:'media/28.jpg',video:'media/28.mp4',pad:false},
 {id:'29',num:29,name:"Azul-marinho gravata champanhe",fam:"Azul-marinho",hex:'#141a2b',cut:'media/cut-29.webp',photo:'media/29.jpg',video:'media/29.mp4',pad:false},
 {id:'30',num:30,name:"Azul-marinho trespassado",fam:"Azul-marinho",hex:'#161c2c',cut:'media/cut-30.webp',photo:'media/30.jpg',video:'media/30.mp4',pad:false},
 {id:'31',num:31,name:"Cinza-claro",fam:"Cinza claro",hex:'#807468',cut:'media/cut-31.webp',photo:'media/31.jpg',video:'media/31.mp4',padimg:'media/pad-31.jpg',pad:true,padName:'Cinza-claro'},
 {id:'32',num:32,name:"Cinza com colete prata",fam:"Cinza",hex:'#433834',cut:'media/cut-32.webp',photo:'media/32.jpg',video:'media/32.mp4',pad:false},
 {id:'33',num:33,name:"Grafite xadrez escuro",fam:"Grafite",hex:'#2e2b26',cut:'media/cut-33.webp',photo:'media/33.jpg',video:'media/33.mp4',pad:false},
 {id:'34',num:34,name:"Cinza-médio",fam:"Cinza",hex:'#3e3a3a',cut:'media/cut-34.webp',photo:'media/34.jpg',video:'media/34.mp4',pad:false},
 {id:'35',num:35,name:"Azul-denim",fam:"Azul médio",hex:'#243956',cut:'media/cut-35.webp',photo:'media/35.jpg',video:'media/35.mp4',pad:false},
 {id:'36',num:36,name:"Azul-denim claro",fam:"Azul médio",hex:'#2c3f59',cut:'media/cut-36.webp',photo:'media/36.jpg',video:'media/36.mp4',pad:false},
 {id:'37',num:37,name:"Cinza-claro linho",fam:"Cinza claro",hex:'#918274',cut:'media/cut-37.webp',photo:'media/37.jpg',video:'media/37.mp4',pad:false},
 {id:'38',num:38,name:"Azul-cobalto",fam:"Azul royal",hex:'#183562',cut:'media/cut-38.webp',photo:'media/38.jpg',video:'media/38.mp4',pad:false},
 {id:'39',num:39,name:"Cinza-claro trespassado",fam:"Cinza claro",hex:'#82776c',cut:'media/cut-39.webp',photo:'media/39.jpg',video:'media/39.mp4',pad:false},
 {id:'40',num:40,name:"Cinza com detalhe nos bolsos",fam:"Cinza",hex:'#61564f',cut:'media/cut-40.webp',photo:'media/40.jpg',video:'media/40.mp4',pad:false},
 {id:'41',num:41,name:"Azul-celeste",fam:"Azul claro",hex:'#8c9db0',cut:'media/cut-41.webp',photo:'media/41.jpg',video:'media/41.mp4',pad:false},
 {id:'42',num:42,name:"Caramelo",fam:"Bege",hex:'#8b623c',cut:'media/cut-42.webp',photo:'media/42.jpg',video:'media/42.mp4',pad:false},
 {id:'43',num:43,name:"Azul-celeste com lapela preta",fam:"Azul claro",hex:'#758ca2',cut:'media/cut-43.webp',photo:'media/43.jpg',video:'media/43.mp4',pad:false},
 {id:'44',num:44,name:"Taupe claro",fam:"Bege",hex:'#988678',cut:'media/cut-44.webp',photo:'media/44.jpg',video:'media/44.mp4',pad:false},
 {id:'45',num:45,name:"Off-white linho",fam:"Branco",hex:'#b1a596',cut:'media/cut-45.webp',photo:'media/45.jpg',video:'media/45.mp4',pad:false},
 {id:'46',num:46,name:"Cinza com lapela de cetim",fam:"Cinza",hex:'#4d4540',cut:'media/cut-46.webp',photo:'media/46.jpg',video:'media/46.mp4',pad:false},
 {id:'47',num:47,name:"Grafite",fam:"Grafite",hex:'#35312d',cut:'media/cut-47.webp',photo:'media/47.jpg',video:'media/47.mp4',padimg:'media/pad-47.jpg',pad:true,padName:'Grafite'},
 {id:'48',num:48,name:"Cinza-azulado",fam:"Cinza claro",hex:'#7e787b',cut:'media/cut-48.webp',photo:'media/48.jpg',video:'media/48.mp4',pad:false},
 {id:'49',num:49,name:"Azul-celeste botões azuis",fam:"Azul claro",hex:'#909fa6',cut:'media/cut-49.webp',photo:'media/49.jpg',video:'media/49.mp4',pad:false},
 {id:'50',num:50,name:"Areia",fam:"Bege",hex:'#baa188',cut:'media/cut-50.webp',photo:'media/50.jpg',video:'media/50.mp4',padimg:'media/pad-50.jpg',pad:true,padName:'Bege'},
 {id:'51',num:51,name:"Azul-marinho escuro",fam:"Azul-marinho",hex:'#151a29',cut:'media/cut-51.webp',photo:'media/51.jpg',video:'media/51.mp4',pad:false},
 {id:'52',num:52,name:"Azul-petróleo",fam:"Petróleo",hex:'#212d36',cut:'media/cut-52.webp',photo:'media/52.jpg',video:'media/52.mp4',pad:false},
 {id:'53',num:53,name:"Azul paisley com lapela preta",fam:"Azul médio",hex:'#222735',cut:'media/cut-53.webp',photo:'media/53.jpg',video:'media/53.mp4',pad:false},
 {id:'54',num:54,name:"Azul-aço",fam:"Azul médio",hex:'#3a4d66',cut:'media/cut-54.webp',photo:'media/54.jpg',video:'media/54.mp4',pad:false},
 {id:'55',num:55,name:"Branco jacquard",fam:"Branco",hex:'#c9b9a8',cut:'media/cut-55.webp',photo:'media/55.jpg',video:'media/55.mp4',pad:false},
 {id:'56',num:56,name:"Bege trespassado",fam:"Bege",hex:'#bca387',cut:'media/cut-56.webp',photo:'media/56.jpg',video:'media/56.mp4',pad:false},
 {id:'57',num:57,name:"Bordô com lapela preta",fam:"Vinho",hex:'#3e1d20',cut:'media/cut-57.webp',photo:'media/57.jpg',video:'media/57.mp4',pad:false},
 {id:'58',num:58,name:"Azul com lapela preta",fam:"Azul médio",hex:'#31415d',cut:'media/cut-58.webp',photo:'media/58.jpg',video:'media/58.mp4',pad:false},
 {id:'59',num:59,name:"Azul-royal poá com lapela de cetim",fam:"Azul royal",hex:'#0f2140',cut:'media/cut-59.webp',photo:'media/59.jpg',video:'media/59.mp4',pad:false},
 {id:'60',num:60,name:"Azul médio",fam:"Azul médio",hex:'#27395a',cut:'media/cut-60.webp',photo:'media/60.jpg',video:'media/60.mp4',pad:false},
 {id:'61',num:61,name:"Cinza-azulado claro",fam:"Cinza claro",hex:'#6f7173',cut:'media/cut-61.webp',photo:'media/61.jpg',video:'media/61.mp4',pad:false},
 {id:'62',num:62,name:"Azul xadrez gravata champanhe",fam:"Azul-marinho",hex:'#262937',cut:'media/cut-62.webp',photo:'media/62.jpg',video:'media/62.mp4',pad:false},
 {id:'63',num:63,name:"Bege-areia claro",fam:"Bege",hex:'#baa68e',cut:'media/cut-63.webp',photo:'media/63.jpg',video:'media/63.mp4',pad:false},
 {id:'64',num:64,name:"Amarelo-mostarda",fam:"Amarelo",hex:'#bd8130',cut:'media/cut-64.webp',photo:'media/64.jpg',video:'media/64.mp4',pad:false},
 {id:'65',num:65,name:"Azul-marinho profundo",fam:"Azul-marinho",hex:'#1e263b',cut:'media/cut-65.webp',photo:'media/65.jpg',video:'media/65.mp4',pad:false}
];

var urls={};
var products=[],seq=[];
function isAd(id){return /^ad[0-9]+$/.test(String(id));}
function buildSeq(){seq=[];var ai=0;products.forEach(function(p,i){if(i%AD_EVERY===0&&ai<ADS.length)seq.push(ADS[ai++]);seq.push(p);});if(!seq.length)seq=ADS.slice();}
function seqItem(id){for(var i=0;i<seq.length;i++){if(seq[i].id===id)return seq[i];}return seq[0];}
function seqIdx(id){for(var i=0;i<seq.length;i++){if(seq[i].id===id)return i;}return 0;}
function suitAfter(id){for(var i=seqIdx(id);i<seq.length;i++){if(!seq[i].ad)return seq[i].id;}return products.length?products[0].id:id;}
function famIdx(f){var i=FAMS.indexOf(f);return i<0?99:i;}
function rebuildProducts(){
  var l=[];
  BUILTIN.forEach(function(b){
    var o=ST.over[b.id]||{};if(o.removed)return;
    l.push({id:b.id,num:b.num,name:b.name,fam:b.fam,pieces:'3 peças',desc:'',hex:b.hex,photo:b.photo,video:b.video,cut:b.cut,padName:b.padName||null,padimg:b.padimg||null,pad:o.pad===undefined?b.pad:!!o.pad,builtin:true});
  });
  l.sort(function(a,b){return famIdx(a.fam)-famIdx(b.fam)||lum(b.hex)-lum(a.hex)||a.num-b.num;});
  ST.custom.forEach(function(c){
    var u=urls[c.id];if(!u||!u.photo)return;
    l.push({id:c.id,num:900,name:c.name,fam:'Novos',pieces:c.pieces,desc:c.desc||'',hex:c.hex,photo:u.photo,video:u.video||null,cut:u.cut||null,padName:null,pad:!!c.pad,builtin:false});
  });
  products=l;buildSeq();
  if(!products.length)return;
  if(!byIdSafe(S.pid)&&!isAd(S.pid))S.pid=seq[0].id;
  var pl=padList();if(pl.length&&!pl.some(function(p){return p.id===S.pad;}))S.pad=pl[0].id;
}
function byIdSafe(id){for(var i=0;i<products.length;i++){if(products[i].id===id)return products[i];}return null;}
function byId(id){return byIdSafe(id)||products[0];}
function lum(h){h=String(h||'#000').replace('#','');return .299*parseInt(h.substr(0,2),16)+.587*parseInt(h.substr(2,2),16)+.114*parseInt(h.substr(4,2),16);}
var PADORD=['Azul-marinho','Cinza-claro','Grafite','Preto','Bege'];
function padRank(p){var i=PADORD.indexOf(p.padName||'');return i<0?99:i;}
function padList(){return products.filter(function(p){return p.pad;}).sort(function(a,b){return padRank(a)-padRank(b);});}
function padCount(){return padList().length;}
function pidx(id){for(var i=0;i<products.length;i++){if(products[i].id===id)return i;}return 0;}
function famList(){var o=[];products.forEach(function(p){if(o.indexOf(p.fam)<0)o.push(p.fam);});return o;}
async function loadCustomMedia(){
  for(var i=0;i<ST.custom.length;i++){
    var c=ST.custom[i];if(urls[c.id])continue;
    var ph=await idbGet(c.id+'|photo');if(!ph)continue;
    var vi=c.hasVideo?await idbGet(c.id+'|video'):null;
    var ct=c.hasCut?await idbGet(c.id+'|cut'):null;
    urls[c.id]={photo:URL.createObjectURL(ph),video:vi?URL.createObjectURL(vi):null,cut:ct?URL.createObjectURL(ct):null};
  }
}

var S={view:'shop',pid:'ad1',pad:'21',mode:'foto',staff:{on:false,tab:'modelos',confirm:null,msg:''}};
var vw=$('#vw'),photo=$('#photo'),bd=$('#bd'),vid=$('#vid'),cap=$('#cap'),gw=$('#gw'),grp=$('#grp');
var toastT=null;
function toast(msg){var t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true;},4200);}

/* ---------- vitrine ---------- */
var mediaKey='';
function ensurePad(){var l=padList();if(!l.length)return null;if(!l.some(function(p){return p.id===S.pad;}))S.pad=l[0].id;return byId(S.pad);}

var imgCache={},grpToken=0;
function loadImg(src){
  if(imgCache[src])return imgCache[src];
  imgCache[src]=new Promise(function(res,rej){var i=new Image();i.onload=function(){res(i);};i.onerror=function(){delete imgCache[src];rej(new Error('img'));};i.src=src;});
  return imgCache[src];
}
function flipped(img){var c=document.createElement('canvas');c.width=img.width;c.height=img.height;var x=c.getContext('2d');x.translate(img.width,0);x.scale(-1,1);x.drawImage(img,0,0);return c;}
function suitColor(img){
  var c=document.createElement('canvas'),w=img.width,h=img.height;c.width=w;c.height=h;var x=c.getContext('2d');x.drawImage(img,0,0);
  var y0=Math.round(h*.58),y1=Math.round(h*.85),x0=Math.round(w*.3),x1=Math.round(w*.7);
  var d=x.getImageData(x0,y0,x1-x0,y1-y0).data,R=[],G=[],B=[];
  for(var i=0;i<d.length;i+=4){if(d[i+3]>250){R.push(d[i]);G.push(d[i+1]);B.push(d[i+2]);}}
  function med(a){a.sort(function(p,q){return p-q;});return a.length?a[a.length>>1]:128;}
  return [med(R),med(G),med(B)];
}
function grade(img){
  var c=document.createElement('canvas');c.width=img.width;c.height=img.height;var x=c.getContext('2d');
  try{x.filter='blur('+(img.height>1000?1.1:0.6)+'px)';}catch(e){}
  x.drawImage(img,0,0);x.filter='none';
  x.globalCompositeOperation='source-atop';
  var g=x.createLinearGradient(0,0,c.width,0);g.addColorStop(0,'rgba(255,120,40,.12)');g.addColorStop(.5,'rgba(60,40,70,.06)');g.addColorStop(1,'rgba(255,120,40,.12)');x.fillStyle=g;x.fillRect(0,0,c.width,c.height);
  var v=x.createLinearGradient(0,0,0,c.height);v.addColorStop(0,'rgba(10,10,30,.10)');v.addColorStop(.6,'rgba(10,10,30,.04)');v.addColorStop(1,'rgba(255,110,40,.05)');x.fillStyle=v;x.fillRect(0,0,c.width,c.height);
  x.globalCompositeOperation='source-over';
  return c;
}
function drawFig(ctx,img,cx,feet,H,flip,sh){
  var src=flip?flipped(img):img,w=img.width/img.height*H;
  var g=ctx.createRadialGradient(cx,feet-4,2,cx,feet-4,w*.62);
  g.addColorStop(0,'rgba(0,0,0,'+sh+')');g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.save();ctx.translate(0,feet-4);ctx.scale(1,.12);ctx.translate(0,-(feet-4));ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,feet-4,w*.62,0,Math.PI*2);ctx.fill();ctx.restore();
  var Hr=Math.round(H*.42),oc=document.createElement('canvas');oc.width=Math.ceil(w);oc.height=Hr;
  var o=oc.getContext('2d');o.translate(0,H);o.scale(1,-1);o.drawImage(src,0,0,w,H);o.setTransform(1,0,0,1,0,0);
  o.globalCompositeOperation='destination-in';var lg=o.createLinearGradient(0,0,0,Hr);lg.addColorStop(0,'rgba(0,0,0,.30)');lg.addColorStop(1,'rgba(0,0,0,0)');o.fillStyle=lg;o.fillRect(0,0,oc.width,Hr);
  ctx.drawImage(oc,cx-w/2,feet-2);
  ctx.drawImage(src,cx-w/2,feet-H,w,H);
}

/* ---------- recolor dos padrinhos (qualquer terno com recorte) ---------- */
function s2l(c){c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function l2s(c){c=c<=0.0031308?12.92*c:1.055*Math.pow(c,1/2.4)-0.055;c=Math.round(c*255);return c<0?0:(c>255?255:c);}
function rgb2lab(r,g,b){r=s2l(r);g=s2l(g);b=s2l(b);
  var X=(0.4124*r+0.3576*g+0.1805*b)/0.95047,Y=0.2126*r+0.7152*g+0.0722*b,Z=(0.0193*r+0.1192*g+0.9505*b)/1.08883;
  function f(t){return t>0.008856?Math.cbrt(t):7.787*t+16/116;}
  var fx=f(X),fy=f(Y),fz=f(Z);return [116*fy-16,500*(fx-fy),200*(fy-fz)];}
function lab2rgb(L,a,b){var fy=(L+16)/116,fx=a/500+fy,fz=fy-b/200;
  function f(t){var t3=t*t*t;return t3>0.008856?t3:(t-16/116)/7.787;}
  var X=f(fx)*0.95047,Y=f(fy),Z=f(fz)*1.08883;
  return [l2s(3.2406*X-1.5372*Y-0.4986*Z),l2s(-0.9689*X+1.8758*Y+0.0415*Z),l2s(0.0557*X-0.2040*Y+1.0570*Z)];}
function cutLab(img){
  var c=document.createElement('canvas'),w=img.width,h=img.height;c.width=w;c.height=h;var x=c.getContext('2d');x.drawImage(img,0,0);
  var y0=Math.round(h*.58),y1=Math.round(h*.85),x0=Math.round(w*.3),x1=Math.round(w*.7);
  var d=x.getImageData(x0,y0,x1-x0,y1-y0).data,L=[],A=[],B=[];
  for(var i=0;i<d.length;i+=4){if(d[i+3]>250){var q=rgb2lab(d[i],d[i+1],d[i+2]);L.push(q[0]);A.push(q[1]);B.push(q[2]);}}
  function med(a){a.sort(function(p,q){return p-q;});return a.length?a[a.length>>1]:50;}
  var m=0;for(var j=0;j<L.length;j++)m+=L[j];m=L.length?m/L.length:50;var v=0;for(j=0;j<L.length;j++)v+=(L[j]-m)*(L[j]-m);
  return {L:med(L.slice()),a:med(A),b:med(B),sd:L.length?Math.sqrt(v/L.length):10};}
var padBase=null,padCache={};
function padSource(){
  if(padBase)return padBase;
  padBase=Promise.all([loadImg('media/pad-base.jpg'),loadImg('media/pad-mask.png')]).then(function(r){
    var w=1672,h=941,c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');
    x.drawImage(r[0],0,0,w,h);var img=x.getImageData(0,0,w,h);
    x.clearRect(0,0,w,h);x.drawImage(r[1],0,0,w,h);var md=x.getImageData(0,0,w,h).data;
    var n=0,sL=0,sa=0,sb=0,lab=new Float32Array(w*h*3),p=img.data;
    for(var i=0,k=0;i<w*h;i++,k+=4){var q=rgb2lab(p[k],p[k+1],p[k+2]);lab[i*3]=q[0];lab[i*3+1]=q[1];lab[i*3+2]=q[2];
      if(md[k]>128){n++;sL+=q[0];sa+=q[1];sb+=q[2];}}
    var mL=sL/n,ma=sa/n,mb=sb/n,v=0;for(i=0,k=0;i<w*h;i++,k+=4){if(md[k]>128){var d=lab[i*3]-mL;v+=d*d;}}
    return {w:w,h:h,img:img,md:md,lab:lab,mL:mL,ma:ma,mb:mb,sd:Math.sqrt(v/n)};
  });
  return padBase;
}
function padImage(pp){
  if(padCache[pp.id])return padCache[pp.id];
  if(pp.padimg){padCache[pp.id]=loadImg(pp.padimg).catch(function(){delete padCache[pp.id];pp.padimg=null;return padImage(pp);});return padCache[pp.id];}
  padCache[pp.id]=Promise.all([padSource(),loadImg(pp.cut)]).then(function(r){
    var s=r[0],t=cutLab(r[1]),k=Math.min(1.7,Math.max(0.7,t.sd/s.sd*1.15));
    var c=document.createElement('canvas');c.width=s.w;c.height=s.h;var x=c.getContext('2d');
    var out=x.createImageData(s.w,s.h),o=out.data,p=s.img.data,md=s.md;
    for(var i=0,j=0;i<s.w*s.h;i++,j+=4){
      var a=md[j]/255;
      if(a<=0.004){o[j]=p[j];o[j+1]=p[j+1];o[j+2]=p[j+2];o[j+3]=255;continue;}
      var L=(s.lab[i*3]-s.mL)*k+t.L,A=(s.lab[i*3+1]-s.ma)*0.4+t.a,B=(s.lab[i*3+2]-s.mb)*0.4+t.b;
      var q=lab2rgb(L<0?0:(L>100?100:L),A,B);
      o[j]=p[j]*(1-a)+q[0]*a;o[j+1]=p[j+1]*(1-a)+q[1]*a;o[j+2]=p[j+2]*(1-a)+q[2]*a;o[j+3]=255;}
    x.putImageData(out,0,0);return c;
  });
  return padCache[pp.id];
}
function padLabel(p){return p.padName||p.name;}
function renderGroup(){
  var g=byId(S.pid),pp=ensurePad(),tok=++grpToken;
  var tags='';
  if(!pp||!g.cut||!pp.cut){
    grp.dataset.k='';
    grp.innerHTML='<p class="gmsg">'+(!pp?'Nenhum terno de padrinhos escolhido.':'Este modelo foi cadastrado sem a foto recortada, por isso ainda não aparece na vista em grupo.')+'</p>';
    return;
  }
  if(!grp.querySelector('canvas')||grp.dataset.k!==g.id+'|'+pp.id){
    grp.innerHTML='<canvas width="1672" height="941" aria-label="Noivo de '+esc(g.name)+' com padrinhos de '+esc(padLabel(pp))+'" role="img"></canvas>'+tags;
    grp.dataset.k=g.id+'|'+pp.id;
    var cv=grp.querySelector('canvas'),ctx=cv.getContext('2d');
    Promise.all([padImage(pp),loadImg(g.cut)]).then(function(r){
      if(tok!==grpToken)return;
      ctx.drawImage(r[0],0,0,1672,941);
      drawFig(ctx,grade(r[1]),832,912,815,false,.6);
    }).catch(function(e){if(tok!==grpToken)return;grp.innerHTML='<p class="gmsg">Não foi possível montar a foto. Verifique se as imagens do grupo (media/pad-*.jpg) e os recortes (media/cut-*.webp) foram enviados.</p>';});
  }
}
function capHtml(p){
  return '<span>'+esc(p.name)+'</span><small>'+esc(p.fam)+' · '+(pidx(p.id)+1)+' de '+products.length+'</small>';
}
function setMedia(){
  var isG=S.mode==='grupo',isV=S.mode==='video';
  if(isG&&isAd(S.pid))S.pid=suitAfter(S.pid);
  var p=isG?byId(S.pid):seqItem(S.pid);
  vw.hidden=isG;gw.hidden=!isG;
  ['foto','video','grupo'].forEach(function(m){$('#m-'+m).setAttribute('aria-pressed',String(S.mode===m));});
  if(!isG){
    var useVid=isV&&!!p.video;
    photo.hidden=useVid;vid.hidden=!useVid;
    var key=p.id+'|'+(useVid?'v':'f');
    if(!useVid)vid.pause();
    if(key!==mediaKey){
      mediaKey=key;vw.classList.remove('zoom');
      bd.src=p.photo;photo.src=p.photo;photo.alt=p.ad?'Brasil Homens':'Modelo vestindo o terno '+p.name;
      if(useVid){vid.poster=p.photo;vid.src=p.video;try{vid.currentTime=0;}catch(e){}play(vid);}
    }else if(useVid&&vid.paused){play(vid);}
    cap.innerHTML=(isV&&!p.ad&&!p.video?'<em>Vídeo em breve</em>':'');cap.hidden=!cap.innerHTML;
  }else{
    mediaKey='';vid.pause();
    renderGroup();
    ensurePad();
    $('#padpick').innerHTML=padList().map(function(q){return '<button class="thumb sm" data-act="padpid" data-pid="'+q.id+'" aria-pressed="'+(q.id===S.pad)+'" aria-label="Padrinhos com o terno '+esc(padLabel(q))+'"><span class="timg"><img src="'+q.photo+'" alt="" loading="lazy"></span></button>';}).join('');
    var rl=$('#rail'),rst=rl.scrollTop;
    rl.innerHTML=products.map(function(q){return '<button class="thumb" data-act="pid" data-pid="'+q.id+'" title="'+esc(q.name)+'" aria-pressed="'+(q.id===S.pid)+'" aria-label="'+esc(q.name)+'"><span class="timg"><img src="'+q.photo+'" alt="" loading="lazy"></span></button>';}).join('');
    rl.scrollTop=rst;
    $('#title').textContent='Noivo + padrinhos';
  }
}
function renderShop(){
  if(!products.length)return;
  setMedia();
}
function step(d){
  if(!products.length)return;
  var n=seq.length,i=(seqIdx(S.pid)+d+n)%n;S.pid=seq[i].id;renderShop();
}
/* toque na foto: amplia o tecido; deslizar de lado: troca o terno */
var drag=null;
vw.addEventListener('pointerdown',function(e){
  if(e.target.closest('button'))return;
  drag={x:e.clientX,y:e.clientY,t:Date.now()};
  try{vw.setPointerCapture(e.pointerId);}catch(err){}
});
vw.addEventListener('pointermove',function(e){
  if(S.mode!=='grupo'&&vw.classList.contains('zoom')){var r=vw.getBoundingClientRect();photo.style.transformOrigin=((e.clientX-r.left)/r.width*100)+'% '+((e.clientY-r.top)/r.height*100)+'%';}
});
vw.addEventListener('pointerup',function(e){
  if(!drag)return;var d=drag;drag=null;
  var dx=e.clientX-d.x,dy=e.clientY-d.y;
  if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.5){step(dx<0?1:-1);return;}
  if(Math.abs(dx)<10&&Math.abs(dy)<10&&S.mode==='foto'){
    var r=vw.getBoundingClientRect();photo.style.transformOrigin=((e.clientX-r.left)/r.width*100)+'% '+((e.clientY-r.top)/r.height*100)+'%';
    vw.classList.toggle('zoom');
  }
});
vw.addEventListener('pointercancel',function(){drag=null;});
vid.addEventListener('contextmenu',function(e){e.preventDefault();});
vid.addEventListener('pause',function(){if(S.view==='shop'&&S.mode==='video'&&!vid.hidden&&!document.hidden){play(vid);}});


/* ---------- area da equipe ---------- */
function renderStaff(){
  var root=$('#staff-root');
  if(!S.staff.on){root.innerHTML='';return;}
  var t=S.staff.tab;
  var title=t==='modelos'?'Modelos do catálogo':t==='novo'?'Adicionar modelo':'Segurança e quiosco';
  var head='<div class="panelhead"><div class="block" style="gap:8px"><span class="eyebrow">Painel da equipe</span><h1>'+title+'</h1></div><button class="ghost" data-act="logout">Voltar ao catálogo</button></div>';
  var tabs='<div class="tabs" role="tablist"><button role="tab" data-act="stab" data-tab="modelos" aria-selected="'+(t==='modelos')+'">Modelos</button><button role="tab" data-act="stab" data-tab="novo" aria-selected="'+(t==='novo')+'">Adicionar modelo</button><button role="tab" data-act="stab" data-tab="seg" aria-selected="'+(t==='seg')+'">Segurança</button></div>';
  var body='';
  if(t==='modelos'){
    body='<p class="note" style="margin-bottom:16px">Escolha até '+MAXPAD+' ternos como opção para os padrinhos. Selecionados: <b>'+padCount()+' de '+MAXPAD+'</b>. Para trocar um, desmarque outro primeiro.</p><div class="mlist">';
    body+=products.map(function(p){
      var dis=(!p.pad&&!(p.grp||p.cut))?' disabled':'';
      var conf=S.staff.confirm===p.id;
      return '<div class="mrow"><img src="'+p.photo+'" alt=""><span class="swatch" style="background:'+esc(p.hex)+'"></span><span class="nm">'+esc(p.name)+'<small>'+esc(p.pieces)+' · '+(p.video?'com vídeo':'sem vídeo')+' · '+(p.cut?'com recorte':'sem recorte')+'</small></span><label class="chk"><input type="checkbox" data-pad="1" data-pid="'+p.id+'"'+(p.pad?' checked':'')+dis+'>Opção para padrinhos</label><button class="mini'+(conf?' warn':'')+'" data-act="removemodel" data-pid="'+p.id+'">'+(conf?'Toque de novo para remover':'Remover')+'</button></div>';
    }).join('')+'</div>';
  }else if(t==='novo'){
    var full=padCount()>=MAXPAD;
    body='<form class="form" id="f-new"><div class="box"><div class="field"><label class="label" for="n-nome">Nome da cor</label><input id="n-nome" required placeholder="Ex.: Bordô"></div><div class="row2"><div class="field"><label class="label" for="n-pecas">Peças</label><select id="n-pecas"><option>2 peças</option><option selected>3 peças</option></select></div><div class="field"><label class="label" for="n-hex">Cor de referência</label><input id="n-hex" type="color" value="#6e1423"></div></div><label class="chk"><input type="checkbox" id="n-pad"'+(full?' disabled':'')+'>Também como opção para padrinhos'+(full?' (limite de '+MAXPAD+' atingido)':'')+'</label><button class="cta" type="submit" id="n-save">Salvar e publicar no catálogo</button><div id="n-msg" role="status"></div></div><div class="box"><div class="field"><label class="label" for="n-foto">Foto do modelo</label><input id="n-foto" type="file" accept="image/*" required></div><div class="field"><label class="label" for="n-video">Vídeo do modelo (opcional)</label><input id="n-video" type="file" accept="video/*"></div><div class="field"><label class="label" for="n-cut">Foto recortada, fundo transparente (opcional)</label><input id="n-cut" type="file" accept="image/png,image/webp"><p class="note">Necessária para o modelo aparecer em noivo + padrinhos.</p></div><div class="preview"><div class="pv" id="pv-foto">Prévia da foto</div><div class="pv" id="pv-video">Prévia do vídeo</div></div></div></form>';
  }else{
    body='<div class="form"><div class="box"><h3 class="sec">Modo quiosco</h3><p class="note" id="kstatus">Verificando…</p><div class="actions"><button class="cta" data-act="kon">Ativar bloqueio</button><button class="ghost" data-act="koff">Sair do modo quiosco</button></div><p class="note">Sair do quiosco libera os botões do tablet para manutenção. Ao abrir o app de novo, ele bloqueia outra vez.</p></div><div class="box"><h3 class="sec">PIN do administrador</h3><div class="actions"><button class="ghost" data-act="chpin">Trocar PIN</button></div><p class="note">Versão do app: '+esc(APP_VERSION)+'</p></div></div>';
  }
  root.innerHTML=head+tabs+body;
  if(t==='seg'){kioskStatus().then(function(s){var e=$('#kstatus');if(!e)return;if(!s){e.textContent='Sem acesso ao bloqueio do Android (versão de navegador).';return;}e.textContent='Bloqueio: '+(s.locked?'ativo':'inativo')+'. Aparelho dedicado (proprietário do dispositivo): '+(s.deviceOwner?'sim, bloqueio completo':'não, o Android usa apenas a fixação de tela')+'.';});}
}

/* importacao de imagens */
function loadBitmapImg(file){return new Promise(function(res,rej){var u=URL.createObjectURL(file),i=new Image();i.onload=function(){URL.revokeObjectURL(u);res(i);};i.onerror=function(){URL.revokeObjectURL(u);rej(new Error('Não foi possível ler a imagem.'));};i.src=u;});}
function toBlob(c,type,q){return new Promise(function(res,rej){c.toBlob(function(b){b?res(b):rej(new Error('Falha ao preparar a imagem.'));},type,q);});}
async function prepPhoto(file){
  var im=await loadBitmapImg(file),maxH=1800,s=Math.min(1,maxH/im.naturalHeight);
  var c=document.createElement('canvas');c.width=Math.round(im.naturalWidth*s);c.height=Math.round(im.naturalHeight*s);
  c.getContext('2d').drawImage(im,0,0,c.width,c.height);
  return toBlob(c,'image/jpeg',.88);
}
async function prepCut(file){
  var im=await loadBitmapImg(file),maxH=1200,s=Math.min(1,maxH/im.naturalHeight);
  var c=document.createElement('canvas');c.width=Math.round(im.naturalWidth*s);c.height=Math.round(im.naturalHeight*s);
  var x=c.getContext('2d');x.drawImage(im,0,0,c.width,c.height);
  var d=x.getImageData(0,0,c.width,c.height).data,x0=c.width,x1=0,y0=c.height,y1=0;
  for(var y=0;y<c.height;y++){for(var xx=0;xx<c.width;xx++){if(d[(y*c.width+xx)*4+3]>25){if(xx<x0)x0=xx;if(xx>x1)x1=xx;if(y<y0)y0=y;if(y>y1)y1=y;}}}
  if(x1<=x0||y1<=y0)throw new Error('A foto recortada não tem fundo transparente.');
  var o=document.createElement('canvas');o.width=x1-x0+1;o.height=y1-y0+1;
  o.getContext('2d').drawImage(c,x0,y0,o.width,o.height,0,0,o.width,o.height);
  return toBlob(o,'image/webp',.9);
}

document.addEventListener('change',function(e){
  var t=e.target;
  if(t.matches&&t.matches('[data-pad]')){
    var id=t.dataset.pid,p=byId(id);
    if(t.checked&&padCount()>=MAXPAD){t.checked=false;toast('Já são '+MAXPAD+' ternos de padrinhos. Desmarque um antes de marcar outro.');return;}
    if(!t.checked&&padCount()<=1){t.checked=true;toast('Deixe ao menos 1 modelo para os padrinhos.');return;}
    if(p.builtin){ST.over[id]=ST.over[id]||{};ST.over[id].pad=t.checked;}
    else{ST.custom.forEach(function(c){if(c.id===id)c.pad=t.checked;});}
    saveState();rebuildProducts();renderStaff();toast('Lista de padrinhos atualizada.');
  }
  if(t.id==='n-foto'){var f=t.files[0],pv=$('#pv-foto');if(f){try{pv.innerHTML='<img alt="Prévia da foto" src="'+URL.createObjectURL(f)+'">';}catch(err){pv.textContent='Foto selecionada';}}}
  if(t.id==='n-video'){var g=t.files[0],pv2=$('#pv-video');if(g){try{pv2.innerHTML='<video muted playsinline preload="metadata" src="'+URL.createObjectURL(g)+'"></video>';}catch(err){pv2.textContent='Vídeo selecionado';}}}
});

/* ---------- acoes ---------- */
var actions={
  logo:function(){logoTap();},
  pid:function(b){S.pid=b.dataset.pid;renderShop();},
  fam:function(b){var f=b.dataset.fam,l=products.filter(function(q){return q.fam===f;});if(l.length){S.pid=l[0].id;renderShop();}},
  prev:function(){step(-1);},
  next:function(){step(1);},
  padpid:function(b){S.pad=b.dataset.pid;renderShop();},
  mode:function(b){S.mode=b.dataset.mode;renderShop();},
  pk:function(b){pinKey(b.dataset.k);},
  recok:function(){if(pinCtx&&pinCtx.recovery){var r=pinCtx.resolve;closeModal();r(true);}},
  txtok:function(){if(pinCtx&&pinCtx.text){var v=($('#txtin')||{}).value||'',r=pinCtx.resolve;closeModal();r(v);}},
  txtcancel:function(){if(pinCtx&&pinCtx.text){var r=pinCtx.resolve;closeModal();r(null);}},
  logout:function(){S.staff.on=false;S.view='shop';renderAll();window.scrollTo(0,0);},
  stab:function(b){S.staff.tab=b.dataset.tab;S.staff.confirm=null;renderStaff();},
  kon:function(){enableKiosk().then(function(){toast('Bloqueio ativado.');renderStaff();});},
  koff:function(){disableKiosk().then(function(){toast('Quiosco desativado. Os botões do tablet foram liberados.');renderStaff();});},
  chpin:function(){setupPin(false).then(function(ok){if(ok)toast('PIN atualizado.');});},
  removemodel:function(b){
    var id=b.dataset.pid,p=byId(id);
    if(products.length<=2){toast('Mantenha ao menos 2 modelos no catálogo.');return;}
    if(p.pad&&padCount()<=1){toast('Deixe ao menos 1 modelo para os padrinhos.');return;}
    if(S.staff.confirm!==id){S.staff.confirm=id;renderStaff();return;}
    S.staff.confirm=null;
    if(p.builtin){ST.over[id]=ST.over[id]||{};ST.over[id].removed=true;saveState();}
    else{
      ST.custom=ST.custom.filter(function(c){return c.id!==id;});saveState();
      var u=urls[id];if(u){['photo','video','cut'].forEach(function(k){if(u[k])try{URL.revokeObjectURL(u[k]);}catch(e){}});delete urls[id];}
      ['photo','video','cut'].forEach(function(k){idbDel(id+'|'+k);});
    }
    rebuildProducts();renderAll();toast('Modelo removido do catálogo.');
  }
};
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-act]');if(!b)return;var a=actions[b.dataset.act];if(a)a(b,e);
});
var uidn=Date.now();
document.addEventListener('submit',function(e){
  e.preventDefault();
  if(e.target.id!=='f-new')return;
  var f=$('#n-foto').files[0],name=$('#n-nome').value.trim();
  if(!f||!name)return;
  var v=$('#n-video').files[0],ct=$('#n-cut').files[0],msg=$('#n-msg'),btn=$('#n-save');
  if(v&&v.size>300*1024*1024){msg.innerHTML='<div class="err">O vídeo passa de 300 MB. Use um vídeo menor.</div>';return;}
  btn.disabled=true;msg.innerHTML='<div class="okmsg">Salvando… aguarde.</div>';
  var id='n'+(uidn++),wantPad=$('#n-pad').checked&&padCount()<MAXPAD&&!!ct,rec={id:id,name:name,pieces:$('#n-pecas').value,hex:$('#n-hex').value,pad:wantPad,hasVideo:!!v,hasCut:!!ct,desc:'Terno cadastrado pela equipe.'};
  (async function(){
    try{
      var pb=await prepPhoto(f);await idbPut(id+'|photo',pb);
      var cb=null;if(ct){cb=await prepCut(ct);await idbPut(id+'|cut',cb);}
      if(v)await idbPut(id+'|video',v);
      urls[id]={photo:URL.createObjectURL(pb),video:v?URL.createObjectURL(v):null,cut:cb?URL.createObjectURL(cb):null};
      ST.custom.push(rec);saveState();rebuildProducts();
      S.pid=id;renderAll();
      var m=$('#n-msg');if(m)m.innerHTML='<div class="okmsg">Modelo publicado. Ele já aparece no catálogo.</div>';
      toast('Modelo salvo no tablet.');
    }catch(err){
      ['photo','video','cut'].forEach(function(k){idbDel(id+'|'+k);});
      var m2=$('#n-msg');if(m2)m2.innerHTML='<div class="err">'+esc(err&&err.message?err.message:'Não foi possível salvar.')+'</div>';
      var b2=$('#n-save');if(b2)b2.disabled=false;
    }
  })();
});


function renderAll(){
  $('#view-shop').hidden=S.view!=='shop';$('#view-staff').hidden=S.view!=='staff';
  document.body.classList.toggle('is-staff',S.view==='staff');
  $('#modebar').hidden=S.view!=='shop';
  if(S.view==='shop'){renderShop();}else{vid.pause();}
  if(S.view==='staff')renderStaff();
}

/* volta ao inicio depois de um tempo sem toque */
var idleT=null;
function idleReset(){
  clearTimeout(idleT);
  idleT=setTimeout(function(){
    if(S.view==='staff'||!modal.hidden)return idleReset();
    if(products.length&&(S.view!=='shop'||S.mode!=='foto'||S.pid!==seq[0].id)){S.view='shop';S.mode='foto';S.pid=seq[0].id;vw.classList.remove('zoom');renderAll();window.scrollTo(0,0);}
    idleReset();
  },IDLE_MS);
}
['pointerdown','keydown'].forEach(function(ev){document.addEventListener(ev,idleReset,true);});

/* ---------- inicio ---------- */
(async function init(){
  loadState();
  try{await loadCustomMedia();}catch(e){}
  rebuildProducts();
  renderAll();idleReset();
  if(!ST.pin){await setupPin(true);}
  enableKiosk();
})();
})();
