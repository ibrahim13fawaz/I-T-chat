// =============================================
//  HALA CHAT APP - app.js
//  Firebase (Auth + Realtime Database)
//  No ES Modules - runs directly in browser
// =============================================

// ============ FIREBASE CONFIG ============
// ⚠️  استبدل هذه القيم بمعلومات مشروعك في Firebase Console
var firebaseConfig = {
  apiKey: "AIzaSyCcv6TYBlwM3wdASndMtqncQvJhzztFZ9k",
  authDomain: "uno-i-t.firebaseapp.com",
  databaseURL: "https://uno-i-t-default-rtdb.firebaseio.com",
  projectId: "uno-i-t",
  storageBucket: "uno-i-t.firebasestorage.app",
  messagingSenderId: "735333945529",
  appId: "1:735333945529:web:0de9350fe4d36009224b68",
  measurementId: "G-NFVJZ0L8DF"
};

firebase.initializeApp(firebaseConfig);
var auth = firebase.auth();
var db   = firebase.database();

// ============ APP STATE ============
var currentUser      = null;
var currentUserData  = null;
var messagesRef      = null;
var presenceRef      = null;
var messagesListener = null;
var membersListener  = null;
var userAvatarDataUrl = null;

// ---- Messages cache (stays alive across tab switches) ----
var cachedMessages  = [];
var messagesLoaded  = false;
var newMsgStartTs   = 0;

// ---- Voice / WebRTC ----
var VOICE = {
  myMicIndex : -1,
  localStream: null,
  peers      : {},
  micRef     : null,
  signalRef  : null,
  onMicUsers : {},
  muted      : false
};

// ============ SCREEN NAV ============
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) {
    s.classList.remove('active');
  });
  var t = document.getElementById('screen-' + id);
  if (t) t.classList.add('active');
}

function switchTab(tab) {
  ['home','games','profile','chat'].forEach(function(t) {
    var s = document.getElementById('screen-' + t);
    if (s) s.classList.remove('active');
  });
  var t = document.getElementById('screen-' + tab);
  if (t) t.classList.add('active');
  if (tab === 'home') refreshHomeMembers();
  if (tab === 'chat') loadMessages();
}

function showLoading(v) {
  document.getElementById('loading-overlay').style.display = v ? 'flex' : 'none';
}

function setError(id, msg) {
  var el = document.getElementById(id);
  if (el) el.textContent = msg || '';
}

function formatTime(ts) {
  var d = new Date(ts), h = d.getHours(), m = d.getMinutes();
  return (h<10?'0':'')+h+':'+(m<10?'0':'')+m;
}

// ============ AVATAR ============
function setAvatarEl(el, ud) {
  if (!el) return;
  if (ud && ud.photoURL && ud.photoURL.length > 10) {
    el.innerHTML = '<img src="'+ud.photoURL+'" alt="av" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />';
  } else {
    var n = (ud && ud.displayName) ? ud.displayName : '؟';
    el.textContent = n.charAt(0) || '؟';
  }
}

// ============ AUTH ============
auth.onAuthStateChanged(function(user) {
  if (user) {
    currentUser = user;
    db.ref('users/'+user.uid).once('value').then(function(snap) {
      currentUserData = snap.val() || {};
      setPresence(true);
      updateHomeUI();
      updateProfileUI();
      setupMembersListener();
      showScreen('home');
    });
  } else {
    currentUser = null; currentUserData = null;
    detachListeners();
    showScreen('splash');
  }
});

function doLogin() {
  var email = document.getElementById('login-email').value.trim();
  var pass  = document.getElementById('login-password').value;
  setError('login-error','');
  if (!email||!pass) { setError('login-error','يرجى ملء جميع الحقول'); return; }
  showLoading(true);
  auth.signInWithEmailAndPassword(email, pass)
    .then(function(){ showLoading(false); })
    .catch(function(e){
      showLoading(false);
      setError('login-error',
        e.code==='auth/user-not-found'?'البريد غير موجود':
        e.code==='auth/wrong-password'?'كلمة المرور خاطئة':
        e.code==='auth/invalid-email'?'بريد إلكتروني غير صالح':'خطأ في تسجيل الدخول');
    });
}

function previewAvatar(input) {
  var file = input.files[0]; if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    userAvatarDataUrl = e.target.result;
    document.getElementById('reg-avatar-preview').innerHTML =
      '<img src="'+userAvatarDataUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />';
  };
  reader.readAsDataURL(file);
}

function doRegister() {
  var name  = document.getElementById('reg-name').value.trim();
  var email = document.getElementById('reg-email').value.trim();
  var pass  = document.getElementById('reg-password').value;
  setError('reg-error','');
  if (!name||!email||!pass) { setError('reg-error','يرجى ملء جميع الحقول'); return; }
  if (pass.length<6) { setError('reg-error','كلمة المرور 6 أحرف على الأقل'); return; }
  showLoading(true);
  auth.createUserWithEmailAndPassword(email, pass)
    .then(function(cred) {
      var ud = { displayName:name, email:email, photoURL:userAvatarDataUrl||'', createdAt:Date.now() };
      return db.ref('users/'+cred.user.uid).set(ud).then(function(){ currentUserData = ud; });
    })
    .then(function(){ showLoading(false); })
    .catch(function(e){
      showLoading(false);
      setError('reg-error',
        e.code==='auth/email-already-in-use'?'البريد مستخدم بالفعل':
        e.code==='auth/invalid-email'?'بريد غير صالح':'خطأ في إنشاء الحساب');
    });
}

function doLogout() {
  setPresence(false); detachListeners(); unoCleanup(); auth.signOut();
}

// ============ PRESENCE ============
function setPresence(on) {
  if (!currentUser) return;
  var pRef = db.ref('presence/'+currentUser.uid);
  if (on) {
    pRef.set({ uid:currentUser.uid,
      displayName:(currentUserData&&currentUserData.displayName)||'مستخدم',
      photoURL:(currentUserData&&currentUserData.photoURL)||'',
      online:true, lastSeen:Date.now() });
    pRef.onDisconnect().remove();
  } else { pRef.remove(); }
}

// ============ HOME UI ============
function updateHomeUI() {
  if (!currentUserData) return;
  var n = document.getElementById('home-user-name');
  if (n) n.textContent = currentUserData.displayName||'مستخدم';
  setAvatarEl(document.getElementById('home-user-avatar'), currentUserData);
  // Update UNO lobby preview too
  var un = document.getElementById('uno-lobby-name');
  if (un) un.textContent = currentUserData.displayName||'مستخدم';
  setAvatarEl(document.getElementById('uno-lobby-av'), currentUserData);
}

function setupMembersListener() {
  if (membersListener) db.ref('presence').off('value', membersListener);
  membersListener = db.ref('presence').on('value', function(snap) {
    var cnt = snap.numChildren();
    var hc = document.getElementById('home-members-count');
    if (hc) hc.textContent = cnt+' عضو';
    var cc = document.getElementById('chat-members-count');
    if (cc) cc.textContent = cnt;
    updateMicSlots(snap.val());
  });
}

function refreshHomeMembers() {
  db.ref('presence').once('value').then(function(snap){
    var hc = document.getElementById('home-members-count');
    if (hc) hc.textContent = snap.numChildren()+' عضو';
  });
}

// ============ MICS ============
function updateMicSlots(pd) {
  var users = pd ? Object.values(pd) : [];
  for (var i=0; i<5; i++) {
    var slot = document.getElementById('mic-'+i); if (!slot) continue;
    var avDiv = slot.querySelector('.mic-avatar');
    var lblDiv = slot.querySelector('.mic-label');
    if (users[i]) {
      slot.classList.add('occupied');
      avDiv.innerHTML = users[i].photoURL
        ? '<img src="'+users[i].photoURL+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />'
        : (users[i].displayName||'?').charAt(0);
      lblDiv.textContent = users[i].displayName||'مستخدم';
    } else {
      slot.classList.remove('occupied');
      avDiv.innerHTML = '🎤';
      lblDiv.textContent = 'مايك '+(i+1);
    }
  }
}

// ============ CHAT ============
function loadMessages() {
  var area = document.getElementById('messages-area');
  if (!area) return;

  // مسح الرسائل القديمة في كل مرة يدخل المستخدم
  area.innerHTML = '';

  // إيقاف الاستماع القديم إن وجد
  if (messagesRef && messagesListener) {
    messagesRef.off('child_added', messagesListener);
    messagesListener = null;
  }

  messagesRef = db.ref('messages/general');
  var startTs = Date.now();

messagesListener = messagesRef
  .orderByChild('timestamp')
  .on('child_added', function(snap) {
    renderMessage(snap.val());
    scrollToBottom();
  });

function renderMessage(msg) {
  if (!msg) return;
  var area = document.getElementById('messages-area'); if (!area) return;
  var isMine = currentUser && msg.uid===currentUser.uid;
  var div = document.createElement('div');
  div.className = 'msg-bubble'+(isMine?' mine':'');
  var avHtml = msg.photoURL
    ? '<img src="'+msg.photoURL+'" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />'
    : (msg.displayName||'?').charAt(0);
  div.innerHTML =
    '<div class="msg-av">'+avHtml+'</div>'+
    '<div class="msg-content">'+
      '<div class="msg-name">'+(msg.displayName||'مستخدم')+'</div>'+
      '<div class="msg-text">'+escapeHtml(msg.text)+'</div>'+
      '<div class="msg-time">'+formatTime(msg.timestamp)+'</div>'+
    '</div>';
  area.appendChild(div);
}

function escapeHtml(s) {
  var d=document.createElement('div'); d.appendChild(document.createTextNode(s||'')); return d.innerHTML;
}
function scrollToBottom() {
  var a=document.getElementById('messages-area'); if(a) a.scrollTop=a.scrollHeight;
}
function sendMessage() {
  var inp = document.getElementById('chat-msg-input'); if (!inp) return;
  var text = inp.value.trim(); if (!text||!currentUser) return;
  inp.value='';
  db.ref('messages/general').push({
    uid:currentUser.uid,
    displayName:(currentUserData&&currentUserData.displayName)||'مستخدم',
    photoURL:(currentUserData&&currentUserData.photoURL)||'',
    text:text, timestamp:Date.now()
  });
}
function toggleEmojiPicker() {
  var p=document.getElementById('emoji-picker'); if(p) p.classList.toggle('open');
}
function addEmoji(e) {
  var inp=document.getElementById('chat-msg-input');
  if(inp) inp.value+=e;
  var p=document.getElementById('emoji-picker'); if(p) p.classList.remove('open');
  if(inp) inp.focus();
}

// ============ CLEANUP ============
function detachListeners() {
  if (messagesRef&&messagesListener){ messagesRef.off('child_added',messagesListener); messagesListener=null; }
  if (membersListener){ db.ref('presence').off('value',membersListener); membersListener=null; }
}

// ============ PROFILE ============
function updateProfileUI() {
  if (!currentUserData) return;
  var n=document.getElementById('profile-name-display'); if(n) n.textContent=currentUserData.displayName||'مستخدم';
  var e=document.getElementById('profile-email-display'); if(e) e.textContent=currentUser?currentUser.email:'—';
  setAvatarEl(document.getElementById('profile-avatar-display'), currentUserData);
}
function toggleEditName() {
  var ed=document.getElementById('profile-name-edit');
  var inp=document.getElementById('profile-name-input');
  if (!ed) return;
  if (ed.style.display==='none'||!ed.style.display) {
    ed.style.display='block';
    if(inp){ inp.value=currentUserData?currentUserData.displayName||'':''; inp.focus(); }
  } else { ed.style.display='none'; }
}
function saveProfileName() {
  var inp=document.getElementById('profile-name-input'); if(!inp||!currentUser) return;
  var newName=inp.value.trim(); if(!newName) return;
  showLoading(true);
  db.ref('users/'+currentUser.uid+'/displayName').set(newName).then(function(){
    if(currentUserData) currentUserData.displayName=newName;
    updateProfileUI(); updateHomeUI(); setPresence(true);
    document.getElementById('profile-name-edit').style.display='none';
    showLoading(false);
  }).catch(function(){ showLoading(false); });
}
function updateProfilePhoto(input) {
  var file=input.files[0]; if(!file||!currentUser) return;
  var reader=new FileReader();
  reader.onload=function(e){
    var url=e.target.result;
    showLoading(true);
    db.ref('users/'+currentUser.uid+'/photoURL').set(url).then(function(){
      if(currentUserData) currentUserData.photoURL=url;
      updateProfileUI(); updateHomeUI(); setPresence(true);
      showLoading(false);
    }).catch(function(){ showLoading(false); });
  };
  reader.readAsDataURL(file);
}

// ==============================================
//  ██╗   ██╗███╗   ██╗ ██████╗
//  ██║   ██║████╗  ██║██╔═══██╗
//  ██║   ██║██╔██╗ ██║██║   ██║
//  ██║   ██║██║╚██╗██║██║   ██║
//  ╚██████╔╝██║ ╚████║╚██████╔╝
//   ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝
//  GAME ENGINE — AI + ONLINE
// ==============================================

var UNO = {
  // Game state
  state: null,
  mode: null,        // 'ai' | 'online'
  myRole: null,      // 'player1' | 'player2'
  roomId: null,
  roomRef: null,
  gameListener: null,
  presRef: null,
  animating: false,
  selIdx: -1,
  aiTimer: null,
  pendingColor: null,

  // Card constants
  COLS: ['R','B','G','Y'],
  NUMS: '0123456789'.split(''),
  SPECS: ['Skip','Rev','+2'],

  // -------- HELPERS --------
  lbl: function(c) {
    if(!c) return'?';
    if(c.v==='Skip') return'⊘';
    if(c.v==='Rev')  return'⇄';
    if(c.v==='+2')   return'+2';
    if(c.v==='W')    return'★';
    if(c.v==='+4')   return'+4';
    return c.v;
  },
  cls: function(c) { return {R:'cR',B:'cB',G:'cG',Y:'cY',W:'cW'}[c]||'cW'; },
  clsCol: function(col) { return {R:'cR',B:'cB',G:'cG',Y:'cY'}[col]||'cW'; },

  mkDeck: function() {
    var d=[];
    this.COLS.forEach(function(c){
      UNO.NUMS.forEach(function(n){ d.push({c:c,v:n}); if(n!=='0') d.push({c:c,v:n}); });
      UNO.SPECS.forEach(function(s){ d.push({c:c,v:s}); d.push({c:c,v:s}); });
    });
    for(var i=0;i<4;i++){ d.push({c:'W',v:'W'}); d.push({c:'W',v:'+4'}); }
    return this.shuf(d);
  },
  shuf: function(a) {
    for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;}
    return a;
  },
  canPlay: function(card, st) {
    if(!st) return false;
    var top=st.pile[st.pile.length-1];
    if(st.pend>0){
      if(st.pend<=2&&card.v==='+2') return true;
      if(st.pend>=4&&card.v==='+4') return true;
      return false;
    }
    if(card.c==='W') return true;
    if(card.c===st.color) return true;
    if(card.v===top.v) return true;
    return false;
  },
  oppRole: function() { return this.myRole==='player1'?'player2':'player1'; },
  myHand: function(st) { return(st&&st.hands&&st.hands[this.myRole])||[]; },
  oppHand: function(st) { return(st&&st.hands&&st.hands[this.oppRole()])||[]; },
  myName: function(st)  { return(st&&st.names&&st.names[this.myRole])||currentUserData&&currentUserData.displayName||'أنت'; },
  oppName: function(st) { return(st&&st.names&&st.names[this.oppRole()])||'الخصم'; },
  myEmoji: function(st) {
    if(currentUserData&&currentUserData.photoURL&&currentUserData.photoURL.length>10) return null;
    return(currentUserData&&currentUserData.displayName||'أ').charAt(0);
  },
  nextPlayer: function(st, from, skip) {
    if(skip) return from;
    return from==='player1'?'player2':'player1';
  },
  drawOne: function(st) {
    if(!st.deck.length){ var top=st.pile.pop(); st.deck=this.shuf(st.pile); st.pile=[top]; }
    return st.deck.pop();
  },

  // -------- BUILD STATE --------
  buildState: function(p1name, p2name) {
    var deck=this.mkDeck(), h1=[], h2=[];
    for(var i=0;i<7;i++){ h1.push(deck.pop()); h2.push(deck.pop()); }
    var fc; do{ fc=deck.pop(); }while(fc.c==='W');
    var st = {
      deck:deck, pile:[fc], color:fc.c,
      hands:{player1:h1, player2:h2},
      names:{player1:p1name, player2:p2name},
      cur:'player1', dir:1, pend:0,
      over:false, winner:null, awaitColor:false, awaitBy:null
    };
    if(fc.v==='Rev')  st.dir=-1;
    if(fc.v==='Skip') st.cur='player2';
    if(fc.v==='+2')   { st.pend=2; st.cur='player2'; }
    return st;
  },

  doPlay: function(st, role, idx) {
    var hand=st.hands[role];
    if(idx<0||idx>=hand.length) return false;
    var card=hand[idx]; if(!this.canPlay(card,st)) return false;
    hand.splice(idx,1);
    st.pile.push(card);
    if(card.c!=='W') st.color=card.c;
    if(hand.length===0){ st.over=true; st.winner=role; return true; }
    if(card.c==='W'){
      st.awaitColor=true; st.awaitBy=role;
      if(card.v==='+4') st.pend+=4;
      return true;
    }
    this.applyFx(st,card,role);
    return true;
  },

  applyFx: function(st, card, from) {
    if(card.v==='+2')     { st.pend+=2; st.cur=this.nextPlayer(st,from,false); }
    else if(card.v==='Skip') { st.cur=this.nextPlayer(st,from,true); }
    else if(card.v==='Rev')  { st.dir*=-1; st.cur=this.nextPlayer(st,from,true); }
    else                     { st.cur=this.nextPlayer(st,from,false); }
  },

  // -------- AUDIO --------
  _ac: null,
  ac: function(){ if(!this._ac) this._ac=new(window.AudioContext||window.webkitAudioContext)(); return this._ac; },
  sPlay: function(){
    try{var a=this.ac(),b=a.createBuffer(1,a.sampleRate*0.12,a.sampleRate),d=b.getChannelData(0);
    for(var i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);
    var s=a.createBufferSource(),g=a.createGain(),f=a.createBiquadFilter();
    f.type='bandpass';f.frequency.value=3000;f.Q.value=0.5;
    s.buffer=b;s.connect(f);f.connect(g);g.connect(a.destination);
    g.gain.setValueAtTime(0.4,a.currentTime);g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+0.12);
    s.start();s.stop(a.currentTime+0.12);}catch(e){}
  },
  sDraw: function(){
    try{var a=this.ac(),o=a.createOscillator(),g=a.createGain();
    o.type='triangle';o.frequency.value=240;o.connect(g);g.connect(a.destination);
    g.gain.setValueAtTime(0.22,a.currentTime);g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+0.1);
    o.start();o.stop(a.currentTime+0.1);}catch(e){}
  },
  sUno: function(){
    try{var a=this.ac();[[520,0],[880,0.12]].forEach(function(p){
    var o=a.createOscillator(),g=a.createGain();o.type='square';o.frequency.value=p[0];
    o.connect(g);g.connect(a.destination);
    g.gain.setValueAtTime(0.14,a.currentTime+p[1]);g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+p[1]+0.15);
    o.start(a.currentTime+p[1]);o.stop(a.currentTime+p[1]+0.15);});}catch(e){}
  },
  sWin: function(){
    try{var a=this.ac();[523,659,784,1047].forEach(function(f,i){
    var o=a.createOscillator(),g=a.createGain();o.type='sine';o.frequency.value=f;o.connect(g);g.connect(a.destination);
    var t=a.currentTime+i*0.14;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.17,t+0.06);
    g.gain.exponentialRampToValueAtTime(0.001,t+0.3);o.start(t);o.stop(t+0.3);});}catch(e){}
  },

  // -------- START MODES --------
  startAI: function() {
    this.cleanup();
    this.mode='ai'; this.myRole='player1';
    var myName = (currentUserData&&currentUserData.displayName)||'أنت';
    this.state = this.buildState(myName, '🤖 كمبيوتر');
    document.getElementById('uno-game-mode-badge').textContent='🤖 كمبيوتر';
    showScreen('uno-game');
    this.renderAll(this.state);
    this.scheduleAI();
  },

  // -------- AI LOGIC --------
  scheduleAI: function() {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    if (!this.state || this.state.over) return;
    if (this.state.cur !== this.oppRole()) return;
    if (this.state.awaitColor && this.state.awaitBy === this.oppRole()) {
      // AI picks color
      var self = this;
      this.aiTimer = setTimeout(function(){
        if(!self.state) return;
        // count colors in AI hand
        var counts={R:0,B:0,G:0,Y:0};
        self.state.hands[self.oppRole()].forEach(function(c){ if(counts[c.c]!==undefined) counts[c.c]++; });
        var best='R'; var mx=0;
        Object.keys(counts).forEach(function(k){ if(counts[k]>mx){mx=counts[k];best=k;} });
        self.state.color=best; self.state.awaitColor=false; self.state.awaitBy=null;
        self.state.cur=self.nextPlayer(self.state, self.oppRole(), false);
        self.renderAll(self.state);
        self.scheduleAI();
      }, 900);
      return;
    }
    var self = this;
    this.aiTimer = setTimeout(function(){
      if (!self.state || self.state.over || self.state.cur!==self.oppRole()) return;
      var hand = self.state.hands[self.oppRole()];
      // Find best card
      var idx=-1, best=-1;
      hand.forEach(function(card,i){
        if(!self.canPlay(card,self.state)) return;
        var score=0;
        if(card.c==='W') score=5;
        else if(card.v==='+2'||card.v==='+4') score=8;
        else if(card.v==='Skip'||card.v==='Rev') score=6;
        else score=3;
        if(score>best){best=score;idx=i;}
      });
      if(idx>=0){
        var card=hand[idx];
        self.doPlay(self.state, self.oppRole(), idx);
        self.flashFx(card);
        self.renderAll(self.state);
        if(self.state.awaitColor && self.state.awaitBy===self.oppRole()){
          self.scheduleAI(); return;
        }
      } else {
        // Draw
        var n=self.state.pend>0?self.state.pend:1; self.state.pend=0;
        for(var i=0;i<n;i++) self.state.hands[self.oppRole()].push(self.drawOne(self.state));
        self.sDraw();
        self.state.cur=self.nextPlayer(self.state, self.oppRole(), false);
        self.renderAll(self.state);
      }
      if(!self.state.over) self.scheduleAI();
    }, 1100 + Math.random()*600);
  },

  // -------- ONLINE ROOM --------
  genRoomId: function() {
    var chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789', id='';
    for(var i=0;i<6;i++) id+=chars[Math.floor(Math.random()*chars.length)];
    return id;
  },

  createRoom: function() {
    if (!currentUser) return;
    this.cleanup();
    var rid = this.genRoomId();
    this.roomId = rid; this.myRole = 'player1'; this.mode = 'online';
    this.roomRef = db.ref('uno_rooms/'+rid);
    var self = this;
    this.roomRef.set({
      status:'waiting',
      names:{ player1:(currentUserData&&currentUserData.displayName)||'لاعب', player2:null },
      photos:{ player1:(currentUserData&&currentUserData.photoURL)||'', player2:null },
      connected:{ player1:true, player2:false }
    }).then(function(){
      self.presRef = self.roomRef.child('connected/player1');
      self.presRef.onDisconnect().set(false);
      document.getElementById('uno-room-code').textContent = rid;
      showScreen('uno-waiting');
      // Watch for player2 joining
      self.roomRef.child('status').on('value', function(snap){
        if(snap.val()==='playing'){
          self.roomRef.child('status').off('value');
          document.getElementById('uno-game-mode-badge').textContent='👥 أونلاين';
          showScreen('uno-game');
          self.attachOnlineListener();
        }
      });
      // Watch for disconnect
      self.roomRef.child('connected/player2').on('value', function(snap){
        if(document.getElementById('screen-uno-game').classList.contains('active')&&snap.val()===false)
          document.getElementById('uno-discov').classList.add('on');
      });
    });
  },

  joinRoom: function(rid) {
    if (!currentUser) return;
    this.cleanup();
    this.myRole='player2'; this.mode='online'; this.roomId=rid;
    this.roomRef = db.ref('uno_rooms/'+rid);
    var self=this;
    this.roomRef.get().then(function(snap){
      if(!snap.exists()){ setError('uno-join-error','❌ الغرفة غير موجودة'); return; }
      var room=snap.val();
      if(room.status!=='waiting'){ setError('uno-join-error','❌ الغرفة ممتلئة'); return; }
      self.roomRef.child('connected/player2').set(true);
      self.roomRef.child('names/player2').set((currentUserData&&currentUserData.displayName)||'لاعب');
      self.roomRef.child('photos/player2').set((currentUserData&&currentUserData.photoURL)||'');
      self.presRef=self.roomRef.child('connected/player2');
      self.presRef.onDisconnect().set(false);
      var names={player1:room.names.player1, player2:(currentUserData&&currentUserData.displayName)||'لاعب'};
      var st=self.buildState(names.player1, names.player2);
      self.roomRef.child('state').set(st);
      self.roomRef.child('status').set('playing');
      document.getElementById('uno-game-mode-badge').textContent='👥 أونلاين';
      showScreen('uno-game');
      self.attachOnlineListener();
      self.roomRef.child('connected/player1').on('value',function(snap){
        if(document.getElementById('screen-uno-game').classList.contains('active')&&snap.val()===false)
          document.getElementById('uno-discov').classList.add('on');
      });
    }).catch(function(e){ setError('uno-join-error','⚠️ خطأ: '+e.message); });
  },

  attachOnlineListener: function() {
    if(!this.roomRef) return;
    var self=this;
    this.gameListener=this.roomRef.child('state').on('value',function(snap){
      var st=snap.val(); if(st){ self.state=st; self.renderAll(st); }
    });
  },

  writeState: function(st) {
    if(this.roomRef) this.roomRef.child('state').set(st);
  },

  readAndAct: function(action) {
    // For online: read fresh state then act
    var self=this;
    if(this.mode==='online'){
      this.roomRef.child('state').once('value').then(function(snap){
        var st=snap.val(); if(!st) return;
        action(st);
      });
    } else {
      action(this.state);
    }
  },

  // -------- HUMAN ACTIONS --------
  tapCard: function(idx, el) {
    if(this.animating) return;
    var self=this;
    this.readAndAct(function(st){
      if(!st||st.over||st.awaitColor||st.cur!==self.myRole) return;
      var card=self.myHand(st)[idx]; if(!card||!self.canPlay(card,st)) return;
      if(self.selIdx===idx){
        self.selIdx=-1; self.animating=true;
        self.flyCard(el, card, function(){
          self.animating=false;
          if(self.doPlay(st, self.myRole, idx)){
            self.flashFx(card);
            if(self.mode==='online'){ self.writeState(st); }
            else { self.renderAll(st); if(!st.over) self.scheduleAI(); }
          }
        });
      } else {
        self.selIdx=idx;
        self.renderHand(st);
        self.setInfo('✔ اضغط على الورقة مرة أخرى للعبها');
      }
    });
  },

  humanDraw: function() {
    if(this.animating) return;
    var self=this;
    this.readAndAct(function(st){
      if(!st||st.over||st.awaitColor||st.cur!==self.myRole) return;
      var n=st.pend>0?st.pend:1; st.pend=0;
      for(var i=0;i<n;i++) st.hands[self.myRole].push(self.drawOne(st));
      self.sDraw();
      st.cur=self.nextPlayer(st, self.myRole, false);
      if(self.mode==='online'){ self.writeState(st); }
      else { self.state=st; self.renderAll(st); self.scheduleAI(); }
    });
  },

  pickColor: function(col) {
    var self=this;
    this.readAndAct(function(st){
      if(!st||!st.awaitColor||st.awaitBy!==self.myRole) return;
      st.color=col; st.awaitColor=false; st.awaitBy=null;
      st.cur=self.nextPlayer(st, self.myRole, false);
      document.getElementById('uno-colmodal').classList.remove('on');
      if(self.mode==='online'){ self.writeState(st); }
      else { self.state=st; self.renderAll(st); self.scheduleAI(); }
    });
  },

  callUno: function() { this.sUno(); this.setInfo('🔥 صرخت UNO!'); },

  // -------- FLY ANIMATION --------
  flyCard: function(cardEl, card, onDone) {
    var sR=cardEl.getBoundingClientRect(), dR=document.getElementById('uno-tcard').getBoundingClientRect();
    var fly=document.createElement('div');
    fly.className='fly-card '+this.cls(card.c);
    fly.innerHTML='<span class="csym">'+this.lbl(card)+'</span><span class="cval">'+this.lbl(card)+'</span><span class="csym2">'+this.lbl(card)+'</span>';
    fly.style.cssText='width:'+sR.width+'px;height:'+sR.height+'px;left:'+sR.left+'px;top:'+sR.top+'px;position:fixed;z-index:9999;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;border:2px solid rgba(255,255,255,0.3);box-shadow:0 12px 36px rgba(0,0,0,0.6);overflow:hidden;font-family:Nunito,sans-serif';
    document.body.appendChild(fly);
    cardEl.style.opacity='0';
    this.sPlay();
    requestAnimationFrame(function(){ requestAnimationFrame(function(){
      var dx=dR.left+dR.width/2-sR.left-sR.width/2, dy=dR.top+dR.height/2-sR.top-sR.height/2;
      fly.style.transition='transform 0.32s cubic-bezier(0.25,0,0.2,1),opacity 0.08s 0.26s';
      fly.style.transform='translate('+dx+'px,'+dy+'px) scale('+(dR.width/sR.width)+','+(dR.height/sR.height)+')';
      fly.style.opacity='0';
    });});
    setTimeout(function(){ if(fly.parentNode) fly.parentNode.removeChild(fly); onDone(); }, 390);
  },

  flashFx: function(c) {
    if(c.v==='Skip') this.flash('⊘ تخطي!');
    else if(c.v==='Rev') this.flash('⇄ عكس!');
    else if(c.v==='+2') this.flash('+2 اسحب!');
    else if(c.v==='+4') this.flash('+4 اسحب!');
  },

  flash: function(t) {
    var f=document.getElementById('uno-field'); if(!f) return;
    var r=f.getBoundingClientRect();
    var el=document.createElement('div');
    el.style.cssText='position:fixed;font-size:22px;font-weight:900;color:#f5c842;text-shadow:0 2px 8px rgba(0,0,0,0.6);pointer-events:none;z-index:9000;animation:sfUp 0.9s ease-out forwards;transform:translateX(-50%);font-family:Cairo,sans-serif;left:'+(r.left+r.width/2)+'px;top:'+(r.top+r.height/2-20)+'px';
    el.textContent=t;
    document.body.appendChild(el);
    setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 950);
  },

  // -------- RENDER --------
  renderAll: function(st) {
    if(!st) return;
    this.rTopCard(st); this.rDeck(st); this.rOpp(st);
    this.renderHand(st); this.rInfo(st); this.rYou(st);
    this.rUnoBtn(st); this.rDir(st);
    document.getElementById('uno-colmodal').classList.toggle('on',!!(st.awaitColor&&st.awaitBy===this.myRole));
    if(st.over&&st.winner) this.rWin(st);
  },

  rTopCard: function(st) {
    var top=st.pile[st.pile.length-1]; if(!top) return;
    var tc=document.getElementById('uno-tcard');
    tc.className='top-card '+(top.c==='W'?this.clsCol(st.color):this.cls(top.c));
    tc.innerHTML='<span class="csym">'+this.lbl(top)+'</span><span class="cval">'+this.lbl(top)+'</span><span class="csym2">'+this.lbl(top)+'</span>';
  },

  rDeck: function(st) {
    var el=document.getElementById('uno-dcnt'); if(el) el.textContent=st.deck?st.deck.length:0;
    var dp=document.getElementById('uno-dpile'); if(!dp) return;
    var canAny=this.myHand(st).some(function(c){ return UNO.canPlay(c,st); });
    var myT=st.cur===this.myRole&&!st.over&&!st.awaitColor;
    dp.classList.toggle('pulse',myT&&!canAny);
  },

  rDir: function(st) {
    var cw=st.dir===1;
    var dl=document.getElementById('uno-dirlbl'); if(dl) dl.textContent=cw?'↻':'↺';
    var bl=document.getElementById('uno-barl');   if(bl) bl.textContent=cw?'↺':'↻';
    var br=document.getElementById('uno-barr');   if(br) br.textContent=cw?'↻':'↺';
  },

  rOpp: function(st) {
    var isAct=st.cur===this.oppRole(), n=this.oppHand(st).length;
    var on=document.getElementById('uno-oppname');
    if(on){ on.textContent=this.oppName(st); on.style.color=isAct?'#f5c842':'rgba(255,255,255,0.6)'; }
    var oc=document.getElementById('uno-oppcnt');  if(oc) oc.textContent=n;
    var ot=document.getElementById('uno-otbar');   if(ot) ot.style.width=isAct?'75%':'8%';

    // Opp avatar
    var oav=document.getElementById('uno-oppav');
    if(oav){
      if(this.mode==='ai'){
        oav.textContent='🤖';
      } else {
        // online: try to show name initial
        oav.textContent=this.oppName(st).charAt(0)||'?';
      }
    }

    // Mini cards
    var el=document.getElementById('uno-oppcards'); if(!el) return;
    el.innerHTML='';
    var W=300, maxV=Math.min(n,10);
    var step=maxV<=1?0:Math.min(26,(W-46)/(maxV-1));
    var total=maxV<=1?46:(maxV-1)*step+46, startX=(W-total)/2;
    for(var j=0;j<maxV;j++){
      var mc=document.createElement('div'); mc.className='opp-mini';
      var ang=(j-(maxV-1)/2)*2.4, lift=Math.abs(j-(maxV-1)/2)*1.8;
      mc.style.cssText='left:'+(startX+j*step)+'px;top:'+lift+'px;z-index:'+j+';transform:rotate('+ang+'deg)';
      el.appendChild(mc);
    }
  },

  renderHand: function(st) {
    var wrap=document.getElementById('uno-hwrap'); if(!wrap) return;
    wrap.innerHTML='';
    var hand=this.myHand(st), myT=st.cur===this.myRole&&!st.over&&!st.awaitColor, n=hand.length;
    if(!n) return;
    var W=wrap.offsetWidth||370, cW=58, maxV=Math.min(n,11);
    var step=maxV<=1?0:Math.min(36,(W-cW-14)/(maxV-1));
    var total=maxV<=1?cW:(maxV-1)*step+cW, startX=(W-total)/2;
    var self=this;
    hand.forEach(function(card,idx){
      if(idx>=maxV) return;
      var div=document.createElement('div');
      div.className='h-card '+self.cls(card.c);
      div.innerHTML='<span class="csym">'+self.lbl(card)+'</span><span class="cval">'+self.lbl(card)+'</span><span class="csym2">'+self.lbl(card)+'</span>';
      div.style.left=(startX+idx*step)+'px';
      div.style.zIndex=idx+1;
      var ang=(idx-(maxV-1)/2)*2;
      div.style.transform='rotate('+ang+'deg)';
      div.style.transformOrigin='bottom center';
      var can=myT&&self.canPlay(card,st), isSel=self.selIdx===idx;
      if(isSel){
        div.style.bottom='20px'; div.classList.add('selected');
        div.style.transform='rotate(0deg)';
        var hint=document.createElement('div');
        hint.className='play-hint'; hint.textContent='اضغط للعب';
        div.appendChild(hint);
      } else { div.style.bottom='4px'; }
      if(can){
        div.classList.add('playable');
        (function(ci,el){ div.onclick=function(){ self.tapCard(ci,el); }; })(idx,div);
      } else { div.classList.add('no'); }
      wrap.appendChild(div);
    });
  },

  rYou: function(st) {
    var av=document.getElementById('uno-youav');
    if(av){
      av.className='you-av'+(st.cur===this.myRole?' active':'');
      if(currentUserData&&currentUserData.photoURL&&currentUserData.photoURL.length>10){
        av.innerHTML='<img src="'+currentUserData.photoURL+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />';
      } else {
        av.textContent=(currentUserData&&currentUserData.displayName||'أ').charAt(0);
      }
    }
    var nm=document.getElementById('uno-younm');
    if(nm) nm.textContent=this.myName(st);
  },

  rInfo: function(st) {
    if(st.over) return;
    if(st.awaitColor&&st.awaitBy===this.myRole){ this.setInfo('🎨 اختر لون البطاقة'); return; }
    if(st.awaitColor){ this.setInfo('⏳ الخصم يختار اللون...'); return; }
    if(st.cur===this.myRole){
      if(this.selIdx>=0) this.setInfo('✔ اضغط على الورقة مرة أخرى للعبها');
      else if(st.pend>0) this.setInfo('دورك! اسحب '+st.pend+' ورقة أو صد بـ +');
      else this.setInfo('🟢 دورك! اختر ورقة أو اسحب');
    } else {
      var bar=document.getElementById('uno-infobar');
      if(bar) bar.innerHTML='<span class="i-dot"></span> '+this.oppName(st)+' يلعب...';
    }
  },

  rUnoBtn: function(st) {
    var btn=document.getElementById('uno-unobtn');
    if(btn) btn.style.display=(st.cur===this.myRole&&this.myHand(st).length===2)?'block':'none';
  },

  rWin: function(st) {
    var win=st.winner===this.myRole;
    if(win) this.sWin();
    var ico=document.getElementById('uno-winico'); if(ico) ico.textContent=win?'🏆':'😢';
    var t=document.getElementById('uno-wint');   if(t)   t.textContent=win?'فزت! 🎉':'خسرت!';
    var s=document.getElementById('uno-wins');   if(s)   s.textContent=win?'أنت البطل! أحسنت':'حظاً أوفر المرة القادمة';
    document.getElementById('uno-winov').classList.add('on');
  },

  setInfo: function(t) {
    var bar=document.getElementById('uno-infobar'); if(bar) bar.textContent=t;
  },

  // -------- CLEANUP --------
  cleanup: function() {
    if(this.aiTimer){ clearTimeout(this.aiTimer); this.aiTimer=null; }
    if(this.roomRef&&this.gameListener){ this.roomRef.child('state').off('value',this.gameListener); this.gameListener=null; }
    if(this.presRef){ this.presRef.set(false); this.presRef=null; }
    if(this.roomRef){ this.roomRef=null; }
    this.state=null; this.selIdx=-1; this.animating=false;
    ['uno-winov','uno-colmodal','uno-discov'].forEach(function(id){
      var el=document.getElementById(id); if(el) el.classList.remove('on');
    });
  },

  copiedTimer: null,
  copyLink: function() {
    var url=window.location.href.split('?')[0]+'?unoroom='+this.roomId;
    if(navigator.clipboard) navigator.clipboard.writeText(url);
    var lbl=document.getElementById('uno-copy-lbl');
    if(lbl){ lbl.textContent='✅ تم النسخ!'; clearTimeout(this.copiedTimer);
      this.copiedTimer=setTimeout(function(){ lbl.textContent='انسخ رابط الدعوة'; },2200); }
  }
};

// ============ GLOBAL WRAPPERS ============
function startAIGame()       { UNO.startAI(); }
function unoCreateRoom()     { UNO.createRoom(); }
function unoJoinRoom() {
  var code=document.getElementById('uno-join-code').value.trim().toUpperCase();
  if(code.length!==6){ setError('uno-join-error','الكود يجب أن يكون 6 أحرف'); return; }
  setError('uno-join-error','🔍 جاري البحث...');
  UNO.joinRoom(code);
}
function unoCancelRoom()     { UNO.cleanup(); showScreen('uno-friend'); }
function unoCopyLink()       { UNO.copyLink(); }
function unoHumanDraw()      { UNO.humanDraw(); }
function unoPickColor(col)   { UNO.pickColor(col); }
function unoCallUno()        { UNO.callUno(); }
function unoExitGame()       { UNO.cleanup(); showScreen('uno-lobby'); }
function unoCleanup()        { UNO.cleanup(); }

// ============ AUTO JOIN FROM URL ============
window.addEventListener('load', function(){
  var params=new URLSearchParams(window.location.search);
  var unoRoom=params.get('unoroom');
  if(unoRoom && currentUser){
    UNO.myRole='player2'; UNO.mode='online';
    document.getElementById('uno-join-code').value=unoRoom.toUpperCase();
    UNO.joinRoom(unoRoom.toUpperCase());
  }
});

// ============ KEYFRAME for flash ============
(function(){
  var style=document.createElement('style');
  style.textContent='@keyframes sfUp{0%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}100%{opacity:0;transform:translateX(-50%) translateY(-56px) scale(1.35)}}';
  document.head.appendChild(style);
})();

// ============ LOBBY UI UPDATE ============
// Called after auth, updates lobby player card
function updateUnoLobbyUI() {
  if (!currentUserData) return;
  var nm=document.getElementById('uno-lobby-name');
  if(nm) nm.textContent=currentUserData.displayName||'مستخدم';
  var av=document.getElementById('uno-lobby-av');
  if(av){
    if(currentUserData.photoURL&&currentUserData.photoURL.length>10){
      av.innerHTML='<img src="'+currentUserData.photoURL+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />';
    } else {
      av.textContent=(currentUserData.displayName||'أ').charAt(0);
    }
  }
}

// Patch auth state to also update lobby
var _origAuthCb = auth.onAuthStateChanged.bind(auth);
// Re-hook updateHomeUI to also hit lobby
var _origUpdateHomeUI = updateHomeUI;
updateHomeUI = function() {
  _origUpdateHomeUI();
  updateUnoLobbyUI();
};

// ============ SPLASH FALLBACK ============
window.addEventListener('load', function(){
  setTimeout(function(){
    if(!auth.currentUser) showScreen('splash');
  }, 800);
});

// ==============================================
//  🎤 VOICE SYSTEM — WebRTC + Firebase Signaling
// ==============================================

var ICE_SERVERS = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]};

// ---- Toggle mic seat ----
function toggleMic(slotIndex) {
  if (!currentUser) return;

  // If I'm already on this slot → leave mic
  if (VOICE.myMicIndex === slotIndex) {
    leaveMic();
    return;
  }

  // If I'm on another slot → leave first
  if (VOICE.myMicIndex !== -1) {
    leaveMic();
  }

  // Request microphone permission
  navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(function(stream) {
      VOICE.localStream = stream;
      VOICE.myMicIndex  = slotIndex;
      VOICE.muted       = false;

      // Write my presence to this mic slot in Firebase
      var uid = currentUser.uid;
      VOICE.micRef = db.ref('voice_mics/' + slotIndex + '/' + uid);
      VOICE.micRef.set({
        uid         : uid,
        displayName : (currentUserData && currentUserData.displayName) || 'مستخدم',
        photoURL    : (currentUserData && currentUserData.photoURL)    || '',
        micIndex    : slotIndex,
        joinedAt    : Date.now()
      });
      VOICE.micRef.onDisconnect().remove();

      // Update UI immediately
      updateMicSlotUI(slotIndex, currentUserData, true);
      updateMicBtn(slotIndex);

      // Set up signaling listener
      VOICE.signalRef = db.ref('voice_signals/' + uid);
      VOICE.signalRef.on('child_added', function(snap) {
        handleSignal(snap.val(), snap.key);
        snap.ref.remove();
      });

      // Connect to everyone already on mics
      db.ref('voice_mics').once('value').then(function(snap) {
        snap.forEach(function(slotSnap) {
          slotSnap.forEach(function(userSnap) {
            var u = userSnap.val();
            if (u && u.uid !== uid) {
              callPeer(u.uid);
            }
          });
        });
      });

    })
    .catch(function(err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        showVoiceToast('❌ يرجى السماح بالوصول للمايكروفون من إعدادات المتصفح');
      } else {
        showVoiceToast('⚠️ لا يمكن الوصول للمايكروفون: ' + err.message);
      }
    });
}

// ---- Leave mic ----
function leaveMic() {
  var slotIndex = VOICE.myMicIndex;
  if (slotIndex === -1) return;

  // Stop local stream
  if (VOICE.localStream) {
    VOICE.localStream.getTracks().forEach(function(t) { t.stop(); });
    VOICE.localStream = null;
  }

  // Close all peer connections
  Object.keys(VOICE.peers).forEach(function(uid) {
    closePeer(uid);
  });

  // Remove from Firebase
  if (VOICE.micRef) { VOICE.micRef.remove(); VOICE.micRef = null; }
  if (VOICE.signalRef) { VOICE.signalRef.off(); VOICE.signalRef = null; }

  VOICE.myMicIndex = -1;
  VOICE.muted = false;

  // Reset slot UI
  resetMicSlotUI(slotIndex);
  showVoiceToast('🎤 خرجت من المايك');
}

// ---- Toggle mute ----
function toggleMute() {
  if (!VOICE.localStream || VOICE.myMicIndex === -1) return;
  VOICE.muted = !VOICE.muted;
  VOICE.localStream.getAudioTracks().forEach(function(t) {
    t.enabled = !VOICE.muted;
  });
  // Update mic slot UI to show mute indicator
  var slot = document.getElementById('mic-' + VOICE.myMicIndex);
  if (slot) {
    var lbl = slot.querySelector('.mic-label');
    if (lbl) lbl.textContent = VOICE.muted ? '🔇 كتم' : (currentUserData && currentUserData.displayName) || 'أنت';
  }
  showVoiceToast(VOICE.muted ? '🔇 تم الكتم' : '🔊 تم رفع الكتم');
}

// ---- WebRTC: call a peer ----
function callPeer(remoteUid) {
  if (VOICE.peers[remoteUid]) return; // already connected
  var pc = createPC(remoteUid);
  VOICE.peers[remoteUid] = pc;

  // Add local stream tracks
  if (VOICE.localStream) {
    VOICE.localStream.getTracks().forEach(function(t) {
      pc.addTrack(t, VOICE.localStream);
    });
  }

  // Create offer
  pc.createOffer().then(function(offer) {
    return pc.setLocalDescription(offer);
  }).then(function() {
    // Send offer to remote peer via Firebase signaling
    db.ref('voice_signals/' + remoteUid).push({
      type     : 'offer',
      sdp      : pc.localDescription.sdp,
      fromUid  : currentUser.uid
    });
  }).catch(function(e) { console.warn('offer error', e); });
}

// ---- WebRTC: handle incoming signal ----
function handleSignal(signal, key) {
  if (!signal || !signal.fromUid) return;
  var remoteUid = signal.fromUid;

  if (signal.type === 'offer') {
    var pc = VOICE.peers[remoteUid] || createPC(remoteUid);
    VOICE.peers[remoteUid] = pc;
    if (VOICE.localStream) {
      VOICE.localStream.getTracks().forEach(function(t) { pc.addTrack(t, VOICE.localStream); });
    }
    pc.setRemoteDescription({ type:'offer', sdp: signal.sdp })
      .then(function() { return pc.createAnswer(); })
      .then(function(ans) { return pc.setLocalDescription(ans); })
      .then(function() {
        db.ref('voice_signals/' + remoteUid).push({
          type    : 'answer',
          sdp     : pc.localDescription.sdp,
          fromUid : currentUser.uid
        });
      }).catch(function(e) { console.warn('answer error', e); });

  } else if (signal.type === 'answer') {
    var pc2 = VOICE.peers[remoteUid];
    if (pc2 && pc2.signalingState !== 'stable') {
      pc2.setRemoteDescription({ type:'answer', sdp: signal.sdp })
        .catch(function(e) { console.warn('setRemote answer error', e); });
    }

  } else if (signal.type === 'ice') {
    var pc3 = VOICE.peers[remoteUid];
    if (pc3 && signal.candidate) {
      pc3.addIceCandidate(new RTCIceCandidate(signal.candidate))
        .catch(function(e) { console.warn('ice error', e); });
    }
  }
}

// ---- Create RTCPeerConnection ----
function createPC(remoteUid) {
  var pc = new RTCPeerConnection(ICE_SERVERS);

  // Send ICE candidates to remote
  pc.onicecandidate = function(e) {
    if (e.candidate) {
      db.ref('voice_signals/' + remoteUid).push({
        type      : 'ice',
        candidate : e.candidate.toJSON(),
        fromUid   : currentUser.uid
      });
    }
  };

  // Play remote audio when track arrives
  pc.ontrack = function(e) {
    playRemoteAudio(remoteUid, e.streams[0]);
  };

  pc.onconnectionstatechange = function() {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      closePeer(remoteUid);
    }
  };

  return pc;
}

// ---- Play remote audio ----
function playRemoteAudio(uid, stream) {
  var id = 'remote-audio-' + uid;
  var existing = document.getElementById(id);
  if (existing) { existing.srcObject = stream; return; }
  var audio = document.createElement('audio');
  audio.id = id;
  audio.autoplay = true;
  audio.srcObject = stream;
  audio.style.display = 'none';
  document.body.appendChild(audio);
}

// ---- Close one peer ----
function closePeer(uid) {
  if (VOICE.peers[uid]) {
    try { VOICE.peers[uid].close(); } catch(e){}
    delete VOICE.peers[uid];
  }
  var ael = document.getElementById('remote-audio-' + uid);
  if (ael) ael.parentNode.removeChild(ael);
}

// ---- Listen for mic slot changes from Firebase ----
function setupVoiceMicsListener() {
  db.ref('voice_mics').on('value', function(snap) {
    var occupiedSlots = {};
    snap.forEach(function(slotSnap) {
      var slotIdx = parseInt(slotSnap.key);
      slotSnap.forEach(function(userSnap) {
        var u = userSnap.val();
        if (u) { occupiedSlots[slotIdx] = u; }
      });
    });

    // Update all 5 mic slots visually
    for (var i = 0; i < 5; i++) {
      var slot = document.getElementById('mic-' + i);
      if (!slot) continue;
      var avDiv  = slot.querySelector('.mic-avatar');
      var lblDiv = slot.querySelector('.mic-label');
      var u = occupiedSlots[i];

      if (u) {
        slot.classList.add('occupied');
        var isMe = currentUser && u.uid === currentUser.uid;
        slot.classList.toggle('my-mic', isMe);
        if (u.photoURL && u.photoURL.length > 10) {
          avDiv.innerHTML = '<img src="'+u.photoURL+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />';
        } else {
          avDiv.textContent = (u.displayName || '?').charAt(0);
        }
        lblDiv.textContent = isMe
          ? (VOICE.muted ? '🔇 كتم' : '🎙️ ' + (u.displayName || 'أنت'))
          : u.displayName || 'مستخدم';

        // Show mic indicator ring for speaking user
        if (isMe) {
          slot.style.borderColor = '#3ecf6a';
        }

        // If someone new joined and I'm on mic, call them
        if (!isMe && VOICE.myMicIndex !== -1 && !VOICE.peers[u.uid]) {
          callPeer(u.uid);
        }

      } else {
        slot.classList.remove('occupied', 'my-mic');
        slot.style.borderColor = '';
        avDiv.innerHTML = '🎤';
        lblDiv.textContent = 'مايك ' + (i + 1);
        if (VOICE.peers[occupiedSlots[i] && occupiedSlots[i].uid]) {
          closePeer(occupiedSlots[i].uid);
        }
      }
    }
  });
}

function updateMicSlotUI(slotIndex, ud, isMe) {
  var slot = document.getElementById('mic-' + slotIndex); if (!slot) return;
  var avDiv  = slot.querySelector('.mic-avatar');
  var lblDiv = slot.querySelector('.mic-label');
  slot.classList.add('occupied', 'my-mic');
  if (ud && ud.photoURL && ud.photoURL.length > 10) {
    avDiv.innerHTML = '<img src="'+ud.photoURL+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />';
  } else {
    avDiv.textContent = (ud && ud.displayName || '?').charAt(0);
  }
  lblDiv.textContent = '🎙️ ' + (ud && ud.displayName || 'أنت');
  slot.style.borderColor = '#3ecf6a';
}

function resetMicSlotUI(slotIndex) {
  var slot = document.getElementById('mic-' + slotIndex); if (!slot) return;
  slot.classList.remove('occupied', 'my-mic');
  slot.style.borderColor = '';
  slot.querySelector('.mic-avatar').innerHTML = '🎤';
  slot.querySelector('.mic-label').textContent = 'مايك ' + (slotIndex + 1);
}

function updateMicBtn(slotIndex) {
  // Visual feedback that this is MY mic
  for (var i = 0; i < 5; i++) {
    var s = document.getElementById('mic-' + i);
    if (s) s.classList.toggle('my-mic', i === slotIndex);
  }
}

function showVoiceToast(msg) {
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);' +
    'background:rgba(0,0,0,0.85);color:white;padding:10px 20px;border-radius:20px;' +
    'font-size:13px;font-family:Cairo,sans-serif;font-weight:600;z-index:99999;' +
    'white-space:nowrap;border:1px solid rgba(255,255,255,0.15);' +
    'animation:fadeInUp 0.2s ease;pointer-events:none;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 2500);
}

// Inject fadeInUp animation
(function() {
  var s = document.createElement('style');
  s.textContent = '@keyframes fadeInUp{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}' +
    '.mic-slot.my-mic{border-color:#3ecf6a!important;background:rgba(62,207,106,0.15)!important;box-shadow:0 0 12px rgba(62,207,106,0.35)!important;}' +
    '.mic-slot.my-mic .mic-label{color:#3ecf6a!important;}';
  document.head.appendChild(s);
})();

// Hook mic slots to toggle voice
window.addEventListener('load', function() {
  for (var i = 0; i < 5; i++) {
    (function(idx) {
      var slot = document.getElementById('mic-' + idx);
      if (slot) {
        slot.onclick = function() { toggleMic(idx); };
        slot.title = 'اضغط للانضمام للمايك';
        slot.style.cursor = 'pointer';
      }
    })(i);
  }
});

// Start voice mics listener after auth
var _voiceListenerStarted = false;
var _origSetupMembersListener = setupMembersListener;
setupMembersListener = function() {
  _origSetupMembersListener();
  if (!_voiceListenerStarted) {
    _voiceListenerStarted = true;
    setupVoiceMicsListener();
  }
};

// Clean up voice on logout
var _origDoLogout = doLogout;
doLogout = function() {
  leaveMic();
  _origDoLogout();
};

// Reset messages cache on logout so next login reloads fresh
var _origAuthCbFix = auth.onAuthStateChanged;
// We patch via the existing onAuthStateChanged already set above —
// just reset cache when user logs out (user === null)
(function() {
  var originalCb = auth.onAuthStateChanged.bind(auth);
  // The main listener already handles this; just add cache reset
  auth.onAuthStateChanged(function(user) {
    if (!user) {
      cachedMessages  = [];
      messagesLoaded  = false;
      newMsgStartTs   = 0;
      _voiceListenerStarted = false;
    }
  });
})();
