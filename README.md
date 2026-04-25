# 🌟 هلا Chat App

تطبيق دردشة احترافي بتصميم عصري مع Firebase.

---

## 📁 هيكل الملفات

```
chat-app/
├── index.html          # الملف الرئيسي (كل الشاشات)
├── style.css           # كل التصميم (CSS متغيرات + ريسبونسف)
├── app.js              # كل المنطق + Firebase
├── game.html           # لعبة الذاكرة (مدمجة داخل التطبيق)
├── firebase-rules.json # قواعد أمان Firebase
└── README.md           # هذا الملف
```

---

## ⚡ خطوات الإعداد

### 1. إنشاء مشروع Firebase

1. اذهب إلى [Firebase Console](https://console.firebase.google.com/)
2. أنشئ مشروعاً جديداً
3. فعّل **Authentication** → Email/Password
4. أنشئ **Realtime Database** (اختر المنطقة الأقرب)
5. انسخ إعدادات المشروع (Project Settings → Your Apps → Web App)

### 2. ضع إعداداتك في app.js

افتح `app.js` وابحث عن هذا الجزء في الأعلى:

```javascript
var firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  ...
};
```

استبدلها بمعلومات مشروعك الفعلية.

### 3. قواعد الأمان في Firebase

في Firebase Console → Realtime Database → Rules، الصق محتوى `firebase-rules.json`:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null",
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "messages": {
      "general": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    },
    "presence": {
      "$uid": {
        ".read": "auth != null",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

---

## 🚀 النشر على GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit - Hala Chat App"
git remote add origin https://github.com/username/hala-chat.git
git push -u origin main
```

ثم في GitHub → Settings → Pages → Source: `main branch`

---

## 🎮 دمج لعبة خاصة بك

لاستبدال لعبة الذاكرة بلعبتك:

1. ضع كود HTML/CSS/JS للعبتك في ملف `game.html`
2. التطبيق يحملها تلقائياً داخل `<iframe>` عند الضغط على "العب الآن"

---

## ✨ المميزات

- ✅ شاشة ترحيب مع أنيميشن
- ✅ تسجيل دخول / إنشاء حساب (Firebase Auth)
- ✅ الصفحة الرئيسية مع الغرف
- ✅ غرفة دردشة مباشرة (Realtime Database)
- ✅ 5 مايكات تُعرض فيها أسماء وصور المتصلين
- ✅ عدد الأعضاء المتصلين (Presence)
- ✅ Emoji Picker
- ✅ صفحة الألعاب مع iframe
- ✅ لعبة الذاكرة كاملة
- ✅ صفحة البروفايل مع تعديل الاسم والصورة
- ✅ تصميم 9:16 (موبايل)
- ✅ بدون ES Modules - يعمل مباشرة في المتصفح
