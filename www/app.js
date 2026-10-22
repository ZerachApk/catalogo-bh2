(function(){
'use strict';
/* Catalogo Brasil Homens: app offline para tablet. Dados em localStorage + IndexedDB (somente no aparelho). */
var APP_VERSION='2.0 (teste)';
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
var BUILTIN=[
 {id:'azul-royal',cut:'media/cut-azul-royal.webp',name:'Azul-royal',pieces:'3 peças',desc:'Paletó, colete e calça em azul vivo. Lapela de ponta clássica.',hex:'#2e5fa3',photo:'media/azul-royal.jpg',video:'media/azul-royal.mp4',bg:'hall',pad:false},
 {id:'azul-smoking',cut:'media/cut-azul-smoking.webp',name:'Azul-royal com lapela preta',pieces:'3 peças',desc:'Paletó, colete e calça em azul com lapela de cetim preta.',hex:'#33609c',photo:'media/azul-smoking.jpg',video:'media/azul-smoking.mp4',bg:'hall',pad:false},
 {id:'branco-jacquard',cut:'media/cut-branco-jacquard.webp',name:'Branco jacquard',pieces:'3 peças',desc:'Paletó, colete e calça em jacquard branco com lapela preta.',hex:'#e9e6e0',photo:'media/branco-jacquard.jpg',video:'media/branco-jacquard.mp4',bg:'stage',pad:false},
 {id:'areia',cut:'media/cut-areia.webp',name:'Areia',pieces:'3 peças',desc:'Paletó, colete e calça em tom areia, tecido leve.',hex:'#d9cdb4',photo:'media/areia.jpg',video:'media/areia.mp4',bg:'stage',pad:false},
 {id:'mostarda',cut:'media/cut-mostarda.webp',name:'Mostarda',pieces:'3 peças',desc:'Paletó, colete trespassado e calça em mostarda, botões em tom prata.',hex:'#c28a1a',photo:'media/mostarda.jpg',video:'media/mostarda.mp4',bg:'stage',pad:false},
 {id:'amarelo-ouro',cut:'media/cut-amarelo-ouro.webp',name:'Amarelo-ouro',pieces:'3 peças',desc:'Paletó, colete trespassado e calça em amarelo-ouro.',hex:'#d9a92a',photo:'media/amarelo-ouro.jpg',video:'media/amarelo-ouro.mp4',bg:'stage',pad:false},
 {id:'caramelo',cut:'media/cut-caramelo.webp',name:'Caramelo',pieces:'3 peças',desc:'Paletó, colete e calça em linho caramelo, botões marrons.',hex:'#b58b57',photo:'media/caramelo.jpg',video:'media/caramelo.mp4',bg:'stage',pad:false},
 {id:'taupe',cut:'media/cut-taupe.webp',name:'Taupe',pieces:'3 peças',desc:'Paletó, colete e calça em linho taupe.',hex:'#b39a84',photo:'media/taupe.jpg',video:'media/taupe.mp4',bg:'stage',pad:false},
 {id:'bege-trespassado',cut:'media/cut-bege-trespassado.webp',name:'Bege trespassado',pieces:'3 peças',desc:'Paletó, colete trespassado e calça em bege claro.',hex:'#dccfb6',photo:'media/bege-trespassado.jpg',video:'media/bege-trespassado.mp4',bg:'stage',pad:false},
 {id:'champanhe',cut:'media/cut-champanhe.webp',name:'Champanhe',pieces:'3 peças',desc:'Paletó, colete e calça em champanhe, botões no mesmo tom.',hex:'#ddd0b8',photo:'media/champanhe.jpg',video:'media/champanhe.mp4',bg:'stage',pad:false},
 {id:'marinho-cetim',cut:'media/cut-marinho-cetim.webp',name:'Azul-marinho com lapela de cetim',pieces:'3 peças',desc:'Paletó, colete e calça em azul-marinho com lapela de cetim.',hex:'#1f3f7a',photo:'media/marinho-cetim.jpg',video:'media/marinho-cetim.mp4',bg:'hall',pad:false},
 {id:'marinho',cut:'media/cut-marinho.webp',name:'Azul-marinho',pieces:'3 peças',desc:'Paletó, colete e calça em azul-marinho, lapela clássica.',hex:'#24498a',photo:'media/marinho.jpg',video:'media/marinho.mp4',bg:'hall',pad:false},
 {id:'cobalto',cut:'media/cut-cobalto.webp',name:'Azul-cobalto',pieces:'3 peças',desc:'Paletó, colete e calça em azul cobalto vivo.',hex:'#2a62b5',photo:'media/cobalto.jpg',video:'media/cobalto.mp4',bg:'hall',pad:false},
 {id:'denim',cut:'media/cut-denim.webp',name:'Azul-denim',pieces:'3 peças',desc:'Paletó, colete e calça em azul-denim, tecido texturizado.',hex:'#3d6fa3',photo:'media/denim.jpg',video:'media/denim.mp4',bg:'hall',pad:false},
 {id:'denim-claro',cut:'media/cut-denim-claro.webp',name:'Azul-denim claro',pieces:'3 peças',desc:'Paletó, colete e calça em azul texturizado, botões marinho.',hex:'#3f6fa6',photo:'media/denim-claro.jpg',video:'media/denim-claro.mp4',bg:'hall',pad:false},
 {id:'celeste-lapela-preta',cut:'media/cut-celeste-lapela-preta.webp',name:'Azul-celeste com lapela preta',pieces:'3 peças',desc:'Paletó, colete e calça em azul-celeste com lapela de cetim preta.',hex:'#8fb6e3',photo:'media/celeste-lapela-preta.jpg',video:'media/celeste-lapela-preta.mp4',bg:'hall',pad:false},
 {id:'celeste-linho',cut:'media/cut-celeste-linho.webp',name:'Azul-celeste linho',pieces:'3 peças',desc:'Paletó, colete e calça em linho azul-celeste.',hex:'#a9c8ec',photo:'media/celeste-linho.jpg',video:'media/celeste-linho.mp4',bg:'hall',pad:false},
 {id:'celeste',cut:'media/cut-celeste.webp',name:'Azul-celeste',pieces:'3 peças',desc:'Paletó, colete e calça em azul-celeste, botões marinho.',hex:'#b4d3ef',photo:'media/celeste.jpg',video:'media/celeste.mp4',bg:'hall',pad:false},
 {id:'cinza-claro',cut:'media/cut-cinza-claro.webp',name:'Cinza-claro',pieces:'3 peças',desc:'Paletó, colete e calça em linho cinza-claro, botões bege.',hex:'#cfcfcc',photo:'media/cinza-claro.jpg',video:'media/cinza-claro.mp4',bg:'hall',pad:false},
 {id:'off-white',cut:'media/cut-off-white.webp',name:'Off-white com lapela de cetim',pieces:'3 peças',desc:'Paletó, colete e calça off-white com lapela de cetim.',hex:'#f1e9d8',photo:'media/off-white.jpg',video:'media/off-white.mp4',bg:'hall',pad:false},
 {id:'azul-noite',cut:'media/cut-azul-noite.webp',name:'Azul-noite',pieces:'3 peças',desc:'Paletó, colete e calça em azul-noite, lapela clássica.',hex:'#1f3354',photo:'media/azul-noite.jpg',video:'media/azul-noite.mp4',bg:'warm',pad:false},
 {id:'azul-jacquard',cut:'media/cut-azul-jacquard.webp',name:'Azul jacquard com lapela preta',pieces:'3 peças',desc:'Paletó, colete e calça em jacquard azul com lapela de cetim preta.',hex:'#3c5578',photo:'media/azul-jacquard.jpg',video:'media/azul-jacquard.mp4',bg:'warm',pad:false},
 {id:'grafite-xadrez',cut:'media/cut-grafite-xadrez.webp',name:'Grafite xadrez',pieces:'3 peças',desc:'Paletó, colete e calça em xadrez grafite, botões marrons.',hex:'#4a4d48',photo:'media/grafite-xadrez.jpg',video:'media/grafite-xadrez.mp4',bg:'warm',pad:false},
 {id:'grafite-mescla',cut:'media/cut-grafite-mescla.webp',name:'Grafite mescla',pieces:'3 peças',desc:'Paletó, colete e calça em grafite mesclado.',hex:'#4b4e4d',photo:'media/grafite-mescla.jpg',video:'media/grafite-mescla.mp4',bg:'warm',pad:false},
 {id:'verde-salvia',cut:'media/cut-verde-salvia.webp',name:'Verde-sálvia',pieces:'3 peças',desc:'Paletó, colete e calça em verde-sálvia, botões pretos.',hex:'#8a9e76',photo:'media/verde-salvia.jpg',video:'media/verde-salvia.mp4',bg:'warm',pad:false},
 {id:'azul-petroleo',cut:'media/cut-azul-petroleo.webp',name:'Azul-petróleo',pieces:'3 peças',desc:'Paletó, colete e calça em azul-petróleo.',hex:'#2f5666',photo:'media/azul-petroleo.jpg',video:'media/azul-petroleo.mp4',bg:'warm',pad:false},
 {id:'turquesa',cut:'media/cut-turquesa.webp',name:'Turquesa',pieces:'3 peças',desc:'Paletó, colete e calça em turquesa texturizado.',hex:'#2f8a96',photo:'media/turquesa.jpg',video:'media/turquesa.mp4',bg:'warm',pad:false},
 {id:'verde-menta',cut:'media/cut-verde-menta.webp',name:'Verde-menta',pieces:'3 peças',desc:'Paletó, colete e calça em verde-menta, botões brancos.',hex:'#a9c78f',photo:'media/verde-menta.jpg',video:'media/verde-menta.mp4',bg:'warm',pad:false},
 {id:'verde-esmeralda',cut:'media/cut-verde-esmeralda.webp',name:'Verde-esmeralda',pieces:'3 peças',desc:'Paletó, colete e calça em verde-esmeralda.',hex:'#12705c',photo:'media/verde-esmeralda.jpg',video:'media/verde-esmeralda.mp4',bg:'warm',pad:false},
 {id:'verde-oliva',cut:'media/cut-verde-oliva.webp',name:'Verde-oliva',pieces:'3 peças',desc:'Paletó, colete e calça em verde-oliva, botões bege.',hex:'#6b6b2e',photo:'media/verde-oliva.jpg',video:'media/verde-oliva.mp4',bg:'warm',pad:false},
 {id:'preto-jacquard',cut:'media/cut-preto-jacquard.webp',name:'Preto jacquard',pieces:'3 peças',desc:'Paletó, colete e calça em jacquard floral preto, lapela de cetim.',hex:'#1c1c1e',photo:'media/preto-jacquard.jpg',video:'media/preto-jacquard.mp4',bg:'dusk',pad:false},
 {id:'smoking-trespassado',cut:'media/cut-smoking-trespassado.webp',name:'Azul-marinho smoking',pieces:'3 peças',desc:'Paletó com lapela de cetim preta e colete trespassado em azul-marinho.',hex:'#1f3a73',photo:'media/smoking-trespassado.jpg',video:'media/smoking-trespassado.mp4',bg:'dusk',pad:false},
 {id:'preto',cut:'media/cut-preto.webp',name:'Preto clássico',pieces:'3 peças',desc:'Paletó, colete e calça em preto, lapela de cetim.',hex:'#141414',photo:'media/preto.jpg',video:'media/preto.mp4',bg:'dusk',pad:false},
 {id:'preto-brilho',cut:'media/cut-preto-brilho.webp',name:'Preto com brilhos',pieces:'3 peças',desc:'Paletó com microbrilhos, colete trespassado e calça em preto.',hex:'#18181a',photo:'media/preto-brilho.jpg',video:'media/preto-brilho.mp4',bg:'dusk',pad:false},
 {id:'prata-paisley',cut:'media/cut-prata-paisley.webp',name:'Prata paisley',pieces:'3 peças',desc:'Paletó, colete e calça em jacquard paisley prata e preto, lapela xale.',hex:'#8d8d90',photo:'media/prata-paisley.jpg',video:'media/prata-paisley.mp4',bg:'dusk',pad:false},
 {id:'azul-poa',cut:'media/cut-azul-poa.webp',name:'Azul poá smoking',pieces:'3 peças',desc:'Paletó, colete e calça em azul com micro-pontos e lapela xale preta.',hex:'#27499a',photo:'media/azul-poa.jpg',video:'media/azul-poa.mp4',bg:'dusk',pad:false},
 {id:'marinho-trespassado',cut:'media/cut-marinho-trespassado.webp',name:'Azul-marinho trespassado',pieces:'3 peças',desc:'Paletó, colete trespassado e calça em azul-marinho.',hex:'#1c2e57',photo:'media/marinho-trespassado.jpg',video:'media/marinho-trespassado.mp4',bg:'dusk',pad:false},
 {id:'ardosia-xadrez',cut:'media/cut-ardosia-xadrez.webp',name:'Azul-ardósia xadrez',pieces:'3 peças',desc:'Paletó, colete e calça em azul-ardósia xadrez.',hex:'#46587a',photo:'media/ardosia-xadrez.jpg',video:'media/ardosia-xadrez.mp4',bg:'dusk',pad:false},
 {id:'marinho-escuro',cut:'media/cut-marinho-escuro.webp',name:'Azul-marinho escuro',pieces:'3 peças',desc:'Paletó, colete e calça em azul-marinho escuro.',hex:'#1b2c4f',photo:'media/marinho-escuro.jpg',video:'media/marinho-escuro.mp4',bg:'warm',pad:false},
 {id:'marinho-textura',cut:'media/cut-marinho-textura.webp',name:'Azul-marinho texturizado',pieces:'3 peças',desc:'Paletó, colete e calça em azul-marinho texturizado.',hex:'#1f3057',photo:'media/marinho-textura.jpg',video:'media/marinho-textura.mp4',bg:'warm',pad:false},
 {id:'cinza-trespassado',cut:'media/cut-cinza-trespassado.webp',name:'Cinza-claro trespassado',pieces:'3 peças',desc:'Paletó, colete trespassado e calça em cinza-claro.',hex:'#b4b3ae',photo:'media/cinza-trespassado.jpg',video:'media/cinza-trespassado.mp4',bg:'dusk',pad:false},
 {id:'cinza-cetim',cut:'media/cut-cinza-cetim.webp',name:'Cinza com lapela de cetim',pieces:'3 peças',desc:'Paletó com lapela de cetim, colete e calça em cinza texturizado.',hex:'#7d7d7f',photo:'media/cinza-cetim.jpg',video:'media/cinza-cetim.mp4',bg:'dusk',pad:false},
 {id:'cinza-perola',cut:'media/cut-cinza-perola.webp',name:'Cinza-pérola',pieces:'3 peças',desc:'Paletó, colete e calça em cinza-pérola, botões cinza.',hex:'#b9b7b0',photo:'media/cinza-perola.jpg',video:'media/cinza-perola.mp4',bg:'dusk',pad:false},
 {id:'cinza-gelo',cut:'media/cut-cinza-gelo.webp',name:'Cinza-gelo',pieces:'3 peças',desc:'Paletó, colete e calça em cinza-gelo.',hex:'#c2bfb8',photo:'media/cinza-gelo.jpg',video:'media/cinza-gelo.mp4',bg:'dusk',pad:false},
 {id:'preto-cetim',cut:'media/cut-preto-cetim.webp',name:'Preto com lapela de cetim',pieces:'3 peças',desc:'Paletó com lapela de cetim, colete e calça em preto.',hex:'#161616',photo:'media/preto-cetim.jpg',video:'media/preto-cetim.mp4',bg:'dusk',pad:false},
 {id:'vinho-trespassado',cut:'media/cut-vinho-trespassado.webp',name:'Vinho trespassado',pieces:'3 peças',desc:'Paletó com lapela preta, colete trespassado e calça em vinho.',hex:'#6e1f2c',photo:'media/vinho-trespassado.jpg',video:'media/vinho-trespassado.mp4',bg:'dusk',pad:false},
 {id:'bordo',cut:'media/cut-bordo.webp',name:'Bordô com lapela preta',pieces:'3 peças',desc:'Paletó com lapela preta, colete e calça em bordô.',hex:'#5c2a34',photo:'media/bordo.jpg',video:'media/bordo.mp4',bg:'dusk',pad:false},
 {id:'malva-trespassado',cut:'media/cut-malva-trespassado.webp',name:'Malva texturizado',pieces:'3 peças',desc:'Paletó, colete trespassado e calça em malva texturizado.',hex:'#7d4a4f',photo:'media/malva-trespassado.jpg',video:'media/malva-trespassado.mp4',bg:'dusk',pad:false},
 {id:'grafite-classico',cut:'media/cut-grafite-classico.webp',name:'Grafite',pieces:'3 peças',desc:'Paletó, colete e calça em grafite.',hex:'#5a5b5e',photo:'media/grafite-classico.jpg',video:'media/grafite-classico.mp4',bg:'dusk',pad:false},
 {id:'cinza-prata',cut:'media/cut-cinza-prata.webp',name:'Cinza-prata',pieces:'3 peças',desc:'Paletó, colete e calça em cinza-prata, botões escuros.',hex:'#a7a7a5',photo:'media/cinza-prata.jpg',video:'media/cinza-prata.mp4',bg:'dusk',pad:false},
 {id:'marfim',cut:'media/cut-marfim.webp',name:'Marfim',pieces:'3 peças',desc:'Paletó, colete e calça em marfim, botões dourados.',hex:'#e9e4d8',photo:'media/marfim.jpg',video:'media/marfim.mp4',bg:'red',pad:false},
 {id:'cinza-azulado',cut:'media/cut-cinza-azulado.webp',name:'Cinza-azulado',pieces:'3 peças',desc:'Paletó, colete e calça em cinza-azulado, botões tom sobre tom.',hex:'#9aa3b5',photo:'media/cinza-azulado.jpg',video:'media/cinza-azulado.mp4',bg:'red',pad:false},
 {id:'nude',cut:'media/cut-nude.webp',name:'Bege-nude',pieces:'3 peças',desc:'Paletó, colete e calça em bege-nude.',hex:'#d6bfa7',photo:'media/nude.jpg',video:'media/nude.mp4',bg:'red',pad:false},
 {id:'rose',cut:'media/cut-rose.webp',name:'Rosé-nude',pieces:'3 peças',desc:'Paletó, colete e calça em rosé-nude, botões brancos.',hex:'#d4b3a6',photo:'media/rose.jpg',video:'media/rose.mp4',bg:'red',pad:false},
 {id:'rose-claro',cut:'media/cut-rose-claro.webp',name:'Rosé-claro',pieces:'3 peças',desc:'Paletó, colete e calça em rosé-claro, botões brancos.',hex:'#cfb5aa',photo:'media/rose-claro.jpg',video:'media/rose-claro.mp4',bg:'red',pad:false},
 {id:'cinza-medio',cut:'media/cut-cinza-medio.webp',name:'Cinza-médio com vivo',pieces:'3 peças',desc:'Paletó com detalhes em vivo, colete e calça em cinza-médio.',hex:'#8e8e8e',photo:'media/cinza-medio.jpg',video:'media/cinza-medio.mp4',bg:'red',pad:false},
 {id:'cinza-colete-prata',cut:'media/cut-cinza-colete-prata.webp',name:'Cinza texturizado, colete prata',pieces:'3 peças',desc:'Paletó e calça em cinza texturizado com colete de cetim prata.',hex:'#6f6f72',photo:'media/cinza-colete-prata.jpg',video:'media/cinza-colete-prata.mp4',bg:'red',pad:false},
 {id:'vinho-vivo',cut:'media/cut-vinho-vivo.webp',name:'Vinho com vivo preto',pieces:'3 peças',desc:'Paletó com vivo preto, colete e calça em vinho.',hex:'#7a1f2b',photo:'media/vinho-vivo.jpg',video:'media/vinho-vivo.mp4',bg:'red',pad:false},
 {id:'terracota',cut:'media/cut-terracota.webp',name:'Terracota',pieces:'3 peças',desc:'Paletó, colete e calça em terracota, botões bronze.',hex:'#8a3a30',photo:'media/terracota.jpg',video:'media/terracota.mp4',bg:'red',pad:false},
 {id:'preto-lapela-classica',cut:'media/cut-preto-lapela-classica.webp',name:'Preto lapela clássica',pieces:'3 peças',desc:'Paletó, colete e calça em preto, lapela clássica.',hex:'#151515',photo:'media/preto-lapela-classica.jpg',video:'media/preto-lapela-classica.mp4',bg:'red',pad:false},
 {id:'marinho-profundo',cut:'media/cut-marinho-profundo.webp',name:'Azul-marinho profundo',pieces:'3 peças',desc:'Paletó, colete e calça em azul-marinho profundo.',hex:'#14295a',grp:'media/pad-marinho-profundo.jpg',photo:'media/marinho-profundo.jpg',video:'media/marinho-profundo.mp4',bg:'red',pad:true},
 {id:'azul-acinzentado',cut:'media/cut-azul-acinzentado.webp',name:'Azul-acinzentado',pieces:'3 peças',desc:'Paletó, colete e calça em azul-acinzentado claro.',hex:'#8fa3b3',grp:'media/pad-azul-acinzentado.jpg',photo:'media/azul-acinzentado.jpg',video:'media/azul-acinzentado.mp4',bg:'red',pad:true},
 {id:'cinza-chumbo',cut:'media/cut-cinza-chumbo.webp',name:'Cinza-chumbo',pieces:'3 peças',desc:'Paletó, colete e calça em cinza-chumbo.',hex:'#4a4c4e',grp:'media/pad-cinza-chumbo.jpg',photo:'media/cinza-chumbo.jpg',video:'media/cinza-chumbo.mp4',bg:'red',pad:true},
 {id:'azul-indigo',cut:'media/cut-azul-indigo.webp',name:'Azul-índigo',pieces:'3 peças',desc:'Paletó, colete e calça em azul-índigo.',hex:'#243f78',grp:'media/pad-azul-indigo.jpg',photo:'media/azul-indigo.jpg',video:'media/azul-indigo.mp4',bg:'red',pad:true},
 {id:'azul-aco',cut:'media/cut-azul-aco.webp',name:'Azul-aço',pieces:'3 peças',desc:'Paletó, colete e calça em azul-aço, botões marinho.',hex:'#4f77a6',grp:'media/pad-azul-aco.jpg',photo:'media/azul-aco.jpg',video:'media/azul-aco.mp4',bg:'red',pad:true}
];
var urls={};
var products=[];
function rebuildProducts(){
  var l=[];
  BUILTIN.forEach(function(b){
    var o=ST.over[b.id]||{};if(o.removed)return;
    l.push({id:b.id,name:b.name,pieces:b.pieces,desc:b.desc,hex:b.hex,photo:b.photo,video:b.video,cut:b.cut,grp:b.grp||null,gp:b.gp||null,bg:b.bg,pad:o.pad===undefined?b.pad:!!o.pad,builtin:true});
  });
  ST.custom.forEach(function(c){
    var u=urls[c.id];if(!u||!u.photo)return;
    l.push({id:c.id,name:c.name,pieces:c.pieces,desc:c.desc||'Terno cadastrado pela equipe.',hex:c.hex,photo:u.photo,video:u.video||null,cut:u.cut||null,grp:null,gp:null,bg:'stage',pad:!!c.pad,builtin:false});
  });
  products=l;
  if(!products.length)return;
  if(!byIdSafe(S.pid))S.pid=products[0].id;
  var pl=padList();if(pl.length&&!pl.some(function(p){return p.id===S.pad;}))S.pad=pl[0].id;
}
function byIdSafe(id){for(var i=0;i<products.length;i++){if(products[i].id===id)return products[i];}return null;}
function byId(id){return byIdSafe(id)||products[0];}
function padList(){return products.filter(function(p){return p.pad;});}
function padCount(){return padList().length;}
async function loadCustomMedia(){
  for(var i=0;i<ST.custom.length;i++){
    var c=ST.custom[i];if(urls[c.id])continue;
    var ph=await idbGet(c.id+'|photo');if(!ph)continue;
    var vi=c.hasVideo?await idbGet(c.id+'|video'):null;
    var ct=c.hasCut?await idbGet(c.id+'|cut'):null;
    urls[c.id]={photo:URL.createObjectURL(ph),video:vi?URL.createObjectURL(vi):null,cut:ct?URL.createObjectURL(ct):null};
  }
}

var S={view:'shop',pid:'azul-royal',pad:'marinho-profundo',mode:'foto',cmp:[null,null],cmode:'foto',cplaying:true,staff:{on:false,tab:'modelos',confirm:null,msg:''}};
var frame=$('#frame'),photo=$('#photo'),vid=$('#vid'),vctl=$('#vctl'),vplay=$('#vplay'),vrange=$('#vrange'),vtime=$('#vtime'),hint=$('#hint'),grp=$('#grp');
var PLAY='<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><polygon points="8,5 19,12 8,19" fill="#f2f0ec"></polygon></svg>';
var PAUSE='<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="5" width="4" height="14" fill="#f2f0ec"></rect><rect x="14" y="5" width="4" height="14" fill="#f2f0ec"></rect></svg>';
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
function renderGroup(){
  var g=byId(S.pid),pp=ensurePad(),tok=++grpToken;
  var tags='<span class="tag tg">Noivo · '+esc(g.name)+'</span><span class="tag tp">Padrinhos · '+(pp?esc(pp.name):'-')+'</span>';
  if(!pp||!g.cut||!pp.grp){
    grp.dataset.k='';
    grp.innerHTML='<p style="margin:0;padding:96px 24px;text-align:center;color:var(--muted)">'+(!pp?'Nenhum modelo de padrinho escolhido.':(!pp.grp?'Este terno de padrinho ainda não tem a foto do grupo.':'Este modelo foi cadastrado sem a foto recortada, por isso ainda não aparece na vista em grupo.'))+'</p>';
    return;
  }
  if(!grp.querySelector('canvas')||grp.dataset.k!==g.id+'|'+pp.id){
    grp.innerHTML='<canvas width="1672" height="941" aria-label="Noivo de '+esc(g.name)+' com padrinhos de '+esc(pp.name)+'" role="img"></canvas>'+tags;
    grp.dataset.k=g.id+'|'+pp.id;
    var cv=grp.querySelector('canvas'),ctx=cv.getContext('2d');
    Promise.all([loadImg(pp.grp),loadImg(g.cut)]).then(function(r){
      if(tok!==grpToken)return;
      ctx.drawImage(r[0],0,0,1672,941);
      drawFig(ctx,grade(r[1]),836,868,830,false,.6);
    }).catch(function(){});
  }
}
function setMedia(){
  var p=byId(S.pid);
  if(S.mode==='video'&&!p.video)S.mode='foto';
  var key=p.id+'|'+S.mode;
  var isG=S.mode==='grupo',isV=S.mode==='video';
  photo.hidden=S.mode!=='foto';vid.hidden=!isV;vctl.hidden=!isV;grp.hidden=!isG;
  frame.classList.toggle('group',isG);frame.classList.toggle('scrub',isV);
  hint.hidden=isG;
  if(!isV)vid.pause();
  if(isG){renderGroup();}
  if(key!==mediaKey){
    mediaKey=key;frame.classList.remove('zoom');
    photo.src=p.photo;photo.alt='Modelo vestindo o terno '+p.name;
    if(isV){vid.poster=p.photo;vid.src=p.video;try{vid.currentTime=0;}catch(e){}play(vid);}
  }
  hint.textContent=isV?'Arraste para avançar ou voltar o vídeo':(frame.classList.contains('zoom')?'Toque para voltar':'Toque para ampliar o tecido');
  ['foto','video','grupo'].forEach(function(m){$('#m-'+m).setAttribute('aria-pressed',String(S.mode===m));});
  var mv=$('#m-video');mv.disabled=!p.video;mv.textContent=p.video?'Vídeo':'Vídeo em breve';
  $('#btn-group').textContent=isG?'Ver o terno sozinho':'Ver noivo + padrinhos';
  var pb=$('#padbox');pb.hidden=!isG;
  if(isG){
    ensurePad();
    $('#padpick').innerHTML=padList().map(function(q){return '<button class="thumb sm" data-act="padpid" data-pid="'+q.id+'" aria-pressed="'+(q.id===S.pad)+'" aria-label="Padrinhos com o terno '+esc(q.name)+'"><span class="timg"><img src="'+q.photo+'" alt="" loading="lazy"></span><span class="tname">'+esc(q.name)+'</span></button>';}).join('');
  }
}
function renderShop(){
  if(!products.length){$('#title').textContent='Sem ternos';return;}
  var p=byId(S.pid);
  setMedia();
  var rl=$('#rail'),rst=rl.scrollTop;
  rl.innerHTML=products.map(function(q){
    return '<button class="thumb" data-act="pid" data-pid="'+q.id+'" title="'+esc(q.name)+'" aria-pressed="'+(q.id===S.pid)+'" aria-label="'+esc(q.name)+'"><span class="timg"><img src="'+q.photo+'" alt="" loading="lazy"></span></button>';
  }).join('');
  rl.scrollTop=rst;
  $('#eyebrow').textContent=S.mode==='grupo'?'Noivo e padrinhos':'Locação e venda de trajes';
  $('#title').innerHTML=(S.mode==='grupo'?'Noivo<em>'+esc(p.name)+'</em>':'Terno<em>'+esc(p.name)+'</em>');
  $('#sub').textContent=S.mode==='grupo'?'Veja como o noivo e os padrinhos ficam juntos na mesma foto.':p.desc+' Valores de locação e venda na loja.';
}
function syncVideoUI(){
  var d=vid.duration||8;vrange.value=Math.round((vid.currentTime/d)*1000);
  vtime.textContent=fmtTime(vid.currentTime)+' / '+fmtTime(d);
  vplay.innerHTML=vid.paused?PLAY:PAUSE;vplay.setAttribute('aria-label',vid.paused?'Reproduzir vídeo':'Pausar vídeo');
}
['timeupdate','play','pause','loadedmetadata'].forEach(function(ev){vid.addEventListener(ev,syncVideoUI);});
vplay.addEventListener('click',function(){if(vid.paused)play(vid);else vid.pause();});
vrange.addEventListener('input',function(){var d=vid.duration||8;vid.pause();vid.currentTime=(vrange.value/1000)*d;});
var drag=null;
frame.addEventListener('pointerdown',function(e){
  if(e.target.closest('button,input'))return;
  drag={x:e.clientX,t:vid.currentTime,was:!vid.paused,moved:false};
  try{frame.setPointerCapture(e.pointerId);}catch(err){}
});
frame.addEventListener('pointermove',function(e){
  if(S.mode==='foto'&&frame.classList.contains('zoom')){var r=frame.getBoundingClientRect();photo.style.transformOrigin=((e.clientX-r.left)/r.width*100)+'% '+((e.clientY-r.top)/r.height*100)+'%';}
  if(!drag||S.mode!=='video')return;
  var dx=e.clientX-drag.x;
  if(Math.abs(dx)>6&&!drag.moved){drag.moved=true;vid.pause();}
  if(drag.moved){var d=vid.duration||8,t=drag.t+dx/frame.clientWidth*d*1.4;t=((t%d)+d)%d;vid.currentTime=t;}
});
frame.addEventListener('pointerup',function(e){
  if(!drag)return;var d=drag;drag=null;
  if(S.mode==='video'){if(!d.moved){if(vid.paused)play(vid);else vid.pause();}else if(d.was){play(vid);}}
  else if(S.mode==='foto'){
    var r=frame.getBoundingClientRect();photo.style.transformOrigin=((e.clientX-r.left)/r.width*100)+'% '+((e.clientY-r.top)/r.height*100)+'%';
    frame.classList.toggle('zoom');
    hint.textContent=frame.classList.contains('zoom')?'Toque para voltar':'Toque para ampliar o tecido';
  }
});
frame.addEventListener('pointercancel',function(){drag=null;});

/* ---------- comparar ---------- */
var cmpBuilt=false,cmpEls=[];
function buildCmp(){
  if(cmpBuilt)return;cmpBuilt=true;
  $('#cmp').innerHTML=[0,1].map(function(i){
    return '<div class="ccol"><div class="frame"><img alt="" decoding="async"><video muted loop playsinline preload="metadata" hidden></video><span class="slotlab">TERNO '+(i?'B':'A')+'</span><span class="nov" hidden>Vídeo em breve para este terno</span></div><div class="cname"></div><div class="cpick" role="group"></div></div>';
  }).join('');
  cmpEls=$$('.ccol').map(function(c){return {img:$('img',c),vid:$('video',c),nov:$('.nov',c),name:$('.cname',c),pick:$('.cpick',c),key:''};});
  cmpEls[0].vid.addEventListener('timeupdate',function(){var d=cmpEls[0].vid.duration||8;$('#crange').value=Math.round(cmpEls[0].vid.currentTime/d*1000);});
}
function ensureCmp(){
  if(!byIdSafe(S.cmp[0]))S.cmp[0]=S.pid;
  if(!byIdSafe(S.cmp[1])||S.cmp[1]===S.cmp[0]){var o=products.filter(function(p){return p.id!==S.cmp[0];})[0]||products[0];S.cmp[1]=o.id;}
}
function renderCompare(){
  if(!products.length)return;
  buildCmp();ensureCmp();
  var vmode=S.cmode==='video';
  $('#cm-foto').setAttribute('aria-pressed',String(!vmode));$('#cm-video').setAttribute('aria-pressed',String(vmode));
  $('#cplay').hidden=!vmode;$('#crng').hidden=!vmode;
  var rows=[[],[],[]];
  S.cmp.forEach(function(pid,i){
    var p=byId(pid),el=cmpEls[i];
    var showVideo=vmode&&!!p.video;
    el.img.hidden=showVideo;el.vid.hidden=!showVideo;el.nov.hidden=!(vmode&&!p.video);
    var key=p.id+'|'+showVideo;
    if(key!==el.key){el.key=key;el.img.src=p.photo;el.img.alt='Modelo vestindo o terno '+p.name;
      if(showVideo){el.vid.poster=p.photo;el.vid.src=p.video;try{el.vid.currentTime=0;}catch(e){}
        var other=cmpEls[1-i].vid;if(!other.hidden&&other.currentTime){try{el.vid.currentTime=other.currentTime;}catch(e){}}
        if(S.cplaying)play(el.vid);}
      else el.vid.pause();}
    el.name.innerHTML='Terno <em>'+esc(p.name)+'</em>';
    el.pick.setAttribute('aria-label','Cor, terno '+(i?'B':'A'));
    el.pick.innerHTML=products.map(function(q){return '<button class="thumb sm" data-act="cpid" data-i="'+i+'" data-pid="'+q.id+'" aria-pressed="'+(q.id===pid)+'" aria-label="'+esc(q.name)+'"><span class="timg"><img src="'+q.photo+'" alt="" loading="lazy"></span></button>';}).join('');
    rows[0].push(p.name);rows[1].push(p.pieces);rows[2].push(p.video?'Sim':'Em breve');
  });
  var labels=['Cor','Peças','Vídeo do modelo'];
  $('#cmp-rows').innerHTML=labels.map(function(l,i){return '<tr><td>'+l+'</td><td>'+esc(rows[i][0])+'</td><td>'+esc(rows[i][1])+'</td></tr>';}).join('');
  $('#cplay').textContent=S.cplaying?'Pausar os dois':'Reproduzir os dois';
}
$('#crange').addEventListener('input',function(){
  S.cplaying=false;cmpEls.forEach(function(el){if(!el.vid.hidden){el.vid.pause();var d=el.vid.duration||8;el.vid.currentTime=($('#crange').value/1000)*d;}});
  $('#cplay').textContent='Reproduzir os dois';
});
function cmpPlayState(){cmpEls.forEach(function(el){if(!el.vid.hidden){if(S.cplaying){try{el.vid.currentTime=cmpEls[0].vid.currentTime||el.vid.currentTime;}catch(e){}play(el.vid);}else el.vid.pause();}});}

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
    body='<p class="note" style="margin-bottom:16px">Marque até '+MAXPAD+' modelos como opção de terno dos padrinhos. Selecionados: <b>'+padCount()+' de '+MAXPAD+'</b>.</p><div class="mlist">';
    body+=products.map(function(p){
      var dis=((!p.pad&&padCount()>=MAXPAD)||(!p.grp))?' disabled':'';
      var conf=S.staff.confirm===p.id;
      return '<div class="mrow"><img src="'+p.photo+'" alt=""><span class="swatch" style="background:'+esc(p.hex)+'"></span><span class="nm">'+esc(p.name)+'<small>'+esc(p.pieces)+' · '+(p.video?'com vídeo':'sem vídeo')+' · '+(p.cut?'com recorte':'sem recorte')+'</small></span><label class="chk"><input type="checkbox" data-pad="1" data-pid="'+p.id+'"'+(p.pad?' checked':'')+dis+'>Opção para padrinhos</label><button class="mini'+(conf?' warn':'')+'" data-act="removemodel" data-pid="'+p.id+'">'+(conf?'Toque de novo para remover':'Remover')+'</button></div>';
    }).join('')+'</div>';
  }else if(t==='novo'){
    var full=padCount()>=MAXPAD;
    body='<form class="form" id="f-new"><div class="box"><div class="field"><label class="label" for="n-nome">Nome da cor</label><input id="n-nome" required placeholder="Ex.: Bordô"></div><div class="row2"><div class="field"><label class="label" for="n-pecas">Peças</label><select id="n-pecas"><option>2 peças</option><option selected>3 peças</option></select></div><div class="field"><label class="label" for="n-hex">Cor de referência</label><input id="n-hex" type="color" value="#6e1423"></div></div><button class="cta" type="submit" id="n-save">Salvar e publicar no catálogo</button><div id="n-msg" role="status"></div></div><div class="box"><div class="field"><label class="label" for="n-foto">Foto do modelo</label><input id="n-foto" type="file" accept="image/*" required></div><div class="field"><label class="label" for="n-video">Vídeo do modelo (opcional)</label><input id="n-video" type="file" accept="video/*"></div><div class="field"><label class="label" for="n-cut">Foto recortada, fundo transparente (opcional)</label><input id="n-cut" type="file" accept="image/png,image/webp"><p class="note">Necessária para o modelo aparecer em noivo + padrinhos.</p></div><div class="preview"><div class="pv" id="pv-foto">Prévia da foto</div><div class="pv" id="pv-video">Prévia do vídeo</div></div></div></form>';
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
    if(t.checked&&padCount()>=MAXPAD){t.checked=false;toast('Limite de '+MAXPAD+' modelos para padrinhos.');return;}
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
  nav:function(b){S.view=b.dataset.view;if(S.view!=='staff')S.staff.on=false;renderAll();window.scrollTo(0,0);},
  logo:function(){logoTap();},
  pid:function(b){S.pid=b.dataset.pid;renderShop();},
  pickcard:function(b){S.pid=b.dataset.pid;renderShop();window.scrollTo({top:0,behavior:'smooth'});},
  padpid:function(b){S.pad=b.dataset.pid;renderShop();},
  mode:function(b){S.mode=b.dataset.mode;renderShop();},
  togroup:function(){S.mode=S.mode==='grupo'?'foto':'grupo';renderShop();},
  addcmp:function(){S.cmp=[S.pid,null];S.view='compare';renderAll();window.scrollTo(0,0);},
  cmode:function(b){S.cmode=b.dataset.mode;renderCompare();if(S.cmode==='video')setTimeout(cmpPlayState,60);},
  cplay:function(){S.cplaying=!S.cplaying;cmpPlayState();$('#cplay').textContent=S.cplaying?'Pausar os dois':'Reproduzir os dois';},
  cpid:function(b){S.cmp[+b.dataset.i]=b.dataset.pid;renderCompare();},
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
    S.cmp=[null,null];rebuildProducts();renderAll();toast('Modelo removido do catálogo.');
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
  var id='n'+(uidn++),wantPad=false,rec={id:id,name:name,pieces:$('#n-pecas').value,hex:$('#n-hex').value,pad:wantPad,hasVideo:!!v,hasCut:!!ct,desc:'Terno cadastrado pela equipe.'};
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

function renderNav(){['shop','compare'].forEach(function(v){var b=$('#nav-'+v);if(S.view===v)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
function renderAll(){
  $('#view-shop').hidden=S.view!=='shop';$('#view-compare').hidden=S.view!=='compare';$('#view-staff').hidden=S.view!=='staff';
  document.body.classList.toggle('is-staff',S.view==='staff');
  renderNav();
  if(S.view==='shop'){renderShop();if(S.mode==='video')play(vid);}else{vid.pause();}
  if(S.view==='compare'){renderCompare();if(S.cmode==='video')setTimeout(cmpPlayState,60);}else{cmpEls.forEach(function(el){el.vid.pause();});}
  if(S.view==='staff')renderStaff();
}

/* volta ao inicio depois de um tempo sem toque */
var idleT=null;
function idleReset(){
  clearTimeout(idleT);
  idleT=setTimeout(function(){
    if(S.view==='staff'||!modal.hidden)return idleReset();
    if(products.length&&(S.view!=='shop'||S.mode!=='foto'||S.pid!==products[0].id)){S.view='shop';S.mode='foto';S.pid=products[0].id;S.cmp=[null,null];frame.classList.remove('zoom');renderAll();window.scrollTo(0,0);}
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
