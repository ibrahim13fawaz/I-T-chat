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

// ============ INIT FIREBASE ============
firebase.initializeApp(firebaseConfig);
var auth = firebase.auth();
var db = firebase.database();

// ============ STATE ============
var currentUser = null;
var currentUserData = null;
var messagesRef = null;
var presenceRef = null;
var messagesListener = null;
var membersListener = null;
var userAvatarDataUrl = null; // for registration

// ============ UTILS ============
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) {
    s.classList.remove('active');
    s.style.display = '';
  });
  var target = document.getElementById('screen-' + id);
  if (target) {
    target.classList.add('active');
    target.style.display = 'flex';
  }
}

function switchTab(tab) {
  var tabs = ['home', 'games', 'profile'];
  tabs.forEach(function(t) {
    var sc = document.getElementById('screen-' + t);
    if (sc) {
      sc.classList.remove('active');
      sc.style.display = '';
    }
  });
  var target = document.getElementById('screen-' + tab);
  if (target) {
    target.classList.add('active');
    target.style.display = 'flex';
  }
  if (tab === 'home') refreshHomeMembers();
}

function showLoading(show) {
  document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

function setError(id, msg) {
  var el = document.getElementById(id);
  if (el) el.textContent = msg || '';
}

function formatTime(ts) {
  var d = new Date(ts);
  var h = d.getHours(), m = d.getMinutes();
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

// ============ AVATAR HELPERS ============
function setAvatarEl(el, userData) {
  if (!el) return;
  if (userData && userData.photoURL && userData.photoURL.length > 0) {
    el.innerHTML = '<img src="' + userData.photoURL + '" alt="avatar" />';
  } else {
    var name = (userData && userData.displayName) ? userData.displayName : '؟';
    el.textContent = name.charAt(0) || '؟';
  }
}

// ============ AUTH ============
auth.onAuthStateChanged(function(user) {
  if (user) {
    currentUser = user;
    db.ref('users/' + user.uid).once('value').then(function(snap) {
      currentUserData = snap.val() || {};
      // Set presence
      setPresence(true);
      updateHomeUI();
      updateProfileUI();
      setupMembersListener();
      showScreen('home');
    });
  } else {
    currentUser = null;
    currentUserData = null;
    detachListeners();
    showScreen('login');
  }
});

function doLogin() {
  var email = document.getElementById('login-email').value.trim();
  var pass = document.getElementById('login-password').value;
  setError('login-error', '');
  if (!email || !pass) { setError('login-error', 'يرجى ملء جميع الحقول'); return; }
  showLoading(true);
  auth.signInWithEmailAndPassword(email, pass)
    .then(function() { showLoading(false); })
    .catch(function(e) {
      showLoading(false);
      var msg = e.code === 'auth/user-not-found' ? 'البريد غير موجود' :
                e.code === 'auth/wrong-password' ? 'كلمة المرور خاطئة' :
                e.code === 'auth/invalid-email' ? 'بريد إلكتروني غير صالح' :
                'خطأ في تسجيل الدخول';
      setError('login-error', msg);
    });
}

function previewAvatar(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    userAvatarDataUrl = e.target.result;
    var preview = document.getElementById('reg-avatar-preview');
    preview.innerHTML = '<img src="' + userAvatarDataUrl + '" alt="avatar" />';
  };
  reader.readAsDataURL(file);
}

function doRegister() {
  var name = document.getElementById('reg-name').value.trim();
  var email = document.getElementById('reg-email').value.trim();
  var pass = document.getElementById('reg-password').value;
  setError('reg-error', '');
  if (!name || !email || !pass) { setError('reg-error', 'يرجى ملء جميع الحقول'); return; }
  if (pass.length < 6) { setError('reg-error', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }
  showLoading(true);
  auth.createUserWithEmailAndPassword(email, pass)
    .then(function(cred) {
      var uid = cred.user.uid;
      var userData = {
        displayName: name,
        email: email,
        photoURL: userAvatarDataUrl || '',
        createdAt: Date.now()
      };
      return db.ref('users/' + uid).set(userData).then(function() {
        currentUserData = userData;
      });
    })
    .then(function() { showLoading(false); })
    .catch(function(e) {
      showLoading(false);
      var msg = e.code === 'auth/email-already-in-use' ? 'البريد مستخدم بالفعل' :
                e.code === 'auth/invalid-email' ? 'بريد إلكتروني غير صالح' :
                'خطأ في إنشاء الحساب';
      setError('reg-error', msg);
    });
}

function doLogout() {
  setPresence(false);
  detachListeners();
  auth.signOut();
}

// ============ PRESENCE ============
function setPresence(online) {
  if (!currentUser) return;
  var pRef = db.ref('presence/' + currentUser.uid);
  if (online) {
    pRef.set({
      uid: currentUser.uid,
      displayName: (currentUserData && currentUserData.displayName) || 'مستخدم',
      photoURL: (currentUserData && currentUserData.photoURL) || '',
      online: true,
      lastSeen: Date.now()
    });
    pRef.onDisconnect().remove();
  } else {
    pRef.remove();
  }
}

// ============ HOME UI ============
function updateHomeUI() {
  if (!currentUserData) return;
  var nameEl = document.getElementById('home-user-name');
  if (nameEl) nameEl.textContent = currentUserData.displayName || 'مستخدم';
  var avEl = document.getElementById('home-user-avatar');
  if (avEl) setAvatarEl(avEl, currentUserData);
}

function setupMembersListener() {
  if (membersListener) db.ref('presence').off('value', membersListener);
  membersListener = db.ref('presence').on('value', function(snap) {
    var count = snap.numChildren();
    var homeCount = document.getElementById('home-members-count');
    if (homeCount) homeCount.textContent = count + ' عضو';
    var chatCount = document.getElementById('chat-members-count');
    if (chatCount) chatCount.textContent = count;
    updateMicSlots(snap.val());
  });
}

function refreshHomeMembers() {
  db.ref('presence').once('value').then(function(snap) {
    var count = snap.numChildren();
    var homeCount = document.getElementById('home-members-count');
    if (homeCount) homeCount.textContent = count + ' عضو';
  });
}

// ============ MICS ============
function updateMicSlots(presenceData) {
  var users = [];
  if (presenceData) {
    Object.values(presenceData).forEach(function(u) { users.push(u); });
  }
  for (var i = 0; i < 5; i++) {
    var slot = document.getElementById('mic-' + i);
    if (!slot) continue;
    var avDiv = slot.querySelector('.mic-avatar');
    var labelDiv = slot.querySelector('.mic-label');
    if (users[i]) {
      slot.classList.add('occupied');
      if (users[i].photoURL) {
        avDiv.innerHTML = '<img src="' + users[i].photoURL + '" alt="" />';
      } else {
        avDiv.textContent = (users[i].displayName || '?').charAt(0);
      }
      labelDiv.textContent = users[i].displayName || 'مستخدم';
    } else {
      slot.classList.remove('occupied');
      avDiv.innerHTML = '🎤';
      labelDiv.textContent = 'مايك ' + (i + 1);
    }
  }
}

// ============ CHAT ============
function showChatScreen() {
  showScreen('chat');
  loadMessages();
}

function loadMessages() {
  // Detach previous listener
  if (messagesRef && messagesListener) {
    messagesRef.off('child_added', messagesListener);
  }
  var area = document.getElementById('messages-area');
  if (area) area.innerHTML = '';

  messagesRef = db.ref('messages/general');
  // Load last 50
  messagesRef.limitToLast(50).once('value').then(function(snap) {
    var msgs = [];
    snap.forEach(function(child) { msgs.push(child.val()); });
    msgs.forEach(function(m) { renderMessage(m); });
    scrollToBottom();
  });

  // Listen for new
  var lastTs = Date.now();
  messagesListener = messagesRef.orderByChild('timestamp').startAt(lastTs).on('child_added', function(snap) {
    renderMessage(snap.val());
    scrollToBottom();
  });
}

function renderMessage(msg) {
  if (!msg) return;
  var area = document.getElementById('messages-area');
  if (!area) return;
  var isMine = currentUser && msg.uid === currentUser.uid;
  var div = document.createElement('div');
  div.className = 'msg-bubble' + (isMine ? ' mine' : '');

  var avHtml = '';
  if (msg.photoURL) {
    avHtml = '<img src="' + msg.photoURL + '" alt="" />';
  } else {
    avHtml = (msg.displayName || '?').charAt(0);
  }

  div.innerHTML =
    '<div class="msg-av">' + avHtml + '</div>' +
    '<div class="msg-content">' +
      '<div class="msg-name">' + (msg.displayName || 'مستخدم') + '</div>' +
      '<div class="msg-text">' + escapeHtml(msg.text) + '</div>' +
      '<div class="msg-time">' + formatTime(msg.timestamp) + '</div>' +
    '</div>';

  area.appendChild(div);
}

function escapeHtml(str) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}

function scrollToBottom() {
  var area = document.getElementById('messages-area');
  if (area) area.scrollTop = area.scrollHeight;
}

function sendMessage() {
  var input = document.getElementById('chat-msg-input');
  if (!input) return;
  var text = input.value.trim();
  if (!text || !currentUser) return;
  input.value = '';
  var msgData = {
    uid: currentUser.uid,
    displayName: (currentUserData && currentUserData.displayName) || 'مستخدم',
    photoURL: (currentUserData && currentUserData.photoURL) || '',
    text: text,
    timestamp: Date.now()
  };
  db.ref('messages/general').push(msgData);
}

// ============ EMOJI ============
function toggleEmojiPicker() {
  var picker = document.getElementById('emoji-picker');
  if (picker) picker.classList.toggle('open');
}

function addEmoji(e) {
  var input = document.getElementById('chat-msg-input');
  if (input) input.value += e;
  var picker = document.getElementById('emoji-picker');
  if (picker) picker.classList.remove('open');
  input.focus();
}

// ============ GAMES ============
function launchGame() {
  var modal = document.getElementById('game-modal');
  if (modal) modal.style.display = 'flex';
}

function closeGame() {
  var modal = document.getElementById('game-modal');
  if (modal) modal.style.display = 'none';
}

// ============ PROFILE ============
function updateProfileUI() {
  if (!currentUserData) return;
  var nameEl = document.getElementById('profile-name-display');
  if (nameEl) nameEl.textContent = currentUserData.displayName || 'مستخدم';
  var emailEl = document.getElementById('profile-email-display');
  if (emailEl) emailEl.textContent = currentUser ? currentUser.email : '—';
  var avEl = document.getElementById('profile-avatar-display');
  if (avEl) setAvatarEl(avEl, currentUserData);
}

function toggleEditName() {
  var ed = document.getElementById('profile-name-edit');
  var inp = document.getElementById('profile-name-input');
  if (!ed) return;
  if (ed.style.display === 'none') {
    ed.style.display = 'block';
    if (inp) inp.value = currentUserData ? currentUserData.displayName || '' : '';
    inp.focus();
  } else {
    ed.style.display = 'none';
  }
}

function saveProfileName() {
  var inp = document.getElementById('profile-name-input');
  if (!inp || !currentUser) return;
  var newName = inp.value.trim();
  if (!newName) return;
  showLoading(true);
  db.ref('users/' + currentUser.uid + '/displayName').set(newName)
    .then(function() {
      if (currentUserData) currentUserData.displayName = newName;
      updateProfileUI();
      updateHomeUI();
      setPresence(true); // update presence with new name
      document.getElementById('profile-name-edit').style.display = 'none';
      showLoading(false);
    })
    .catch(function() { showLoading(false); });
}

function updateProfilePhoto(input) {
  var file = input.files[0];
  if (!file || !currentUser) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var dataUrl = e.target.result;
    showLoading(true);
    db.ref('users/' + currentUser.uid + '/photoURL').set(dataUrl)
      .then(function() {
        if (currentUserData) currentUserData.photoURL = dataUrl;
        updateProfileUI();
        updateHomeUI();
        setPresence(true);
        showLoading(false);
      })
      .catch(function() { showLoading(false); });
  };
  reader.readAsDataURL(file);
}

// ============ CLEANUP ============
function detachListeners() {
  if (messagesRef && messagesListener) {
    messagesRef.off('child_added', messagesListener);
    messagesListener = null;
  }
  if (membersListener) {
    db.ref('presence').off('value', membersListener);
    membersListener = null;
  }
}

// Override showScreen for chat (need to load messages)
var _origShowScreen = showScreen;
showScreen = function(id) {
  _origShowScreen(id);
  if (id === 'chat') {
    loadMessages();
  }
};

// ============ SPLASH AUTO ============
window.addEventListener('load', function() {
  // Auth state will handle redirect
  // If not logged in within short delay, show splash
  setTimeout(function() {
    if (!auth.currentUser) {
      showScreen('splash');
    }
  }, 300);
});
