import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

// ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
// ここにFirebase設定を入力してください
// ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
const firebaseConfig = {
    apiKey: "AIzaSyBzbgq7AAjNgvRCa5RcAmhPftkYpO23Bis",
    authDomain: "mutsuura-ed80d.firebaseapp.com",
    projectId: "mutsuura-ed80d",
    storageBucket: "mutsuura-ed80d.firebasestorage.app",
    messagingSenderId: "477365452806",
    appId: "1:477365452806:web:e0ed25f9a7312301698387"
  };

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// 匿名認証を自動実行
signInAnonymously(auth)
    .then(() => {
        console.log("Signed in anonymously");
    })
    .catch((error) => {
        console.error("Authentication failed", error);
    });

export { db, auth, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp };
