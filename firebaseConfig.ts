
import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

// Cấu hình Firebase từ console của bạn
const firebaseConfig = {
  apiKey: "AIzaSyCYniods-hnvA74_Wjdli-kuW7ly5aXAoA",
  authDomain: "ecogo-logistics-24bc0.firebaseapp.com",
  projectId: "ecogo-logistics-24bc0",
  storageBucket: "ecogo-logistics-24bc0.firebasestorage.app",
  messagingSenderId: "947527564968",
  appId: "1:947527564968:web:6ed09c5464cd1711128c9d"
};

let app;
let db: any = null;

try {
    // Khởi tạo Firebase
    app = initializeApp(firebaseConfig);
    
    // Sử dụng initializeFirestore với experimentalForceLongPolling để vượt qua tường lửa công ty
    db = initializeFirestore(app, {
        localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()}),
        experimentalForceLongPolling: true, 
    });
    
    console.log("🔥 Firebase đã được kết nối thành công (Long Polling)!");
} catch (e) {
    console.error("❌ Lỗi khởi tạo Firebase:", e);
    console.warn("Đang chạy chế độ Offline do lỗi kết nối.");
}

export { db };
