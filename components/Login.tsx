
import React, { useState, useEffect, useMemo } from 'react';
import { storageService } from '../services/storageService';

interface Props {
  onLogin: () => void;
}

const Login: React.FC<Props> = ({ onLogin }) => {
  const [username, setUsername] = useState('');

  // Tạo dữ liệu tuyết ngẫu nhiên để tránh re-render làm thay đổi vị trí
  const snowflakes = useMemo(() => {
    return Array.from({ length: 50 }).map((_, i) => ({
      id: i,
      left: Math.random() * 100,
      duration: 5 + Math.random() * 10,
      delay: Math.random() * 5,
      size: 2 + Math.random() * 6,
      opacity: 0.3 + Math.random() * 0.7,
      sway: 10 + Math.random() * 20
    }));
  }, []);

  useEffect(() => {
     const lastUser = localStorage.getItem('ecogo_last_username');
     if (lastUser) setUsername(lastUser);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      storageService.login(username);
      localStorage.setItem('ecogo_last_username', username);
      onLogin();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 relative overflow-hidden">
      
      {/* CSS Animations for Snow */}
      <style>{`
        @keyframes fall {
          0% { transform: translateY(-10vh) translateX(0); }
          100% { transform: translateY(110vh) translateX(20px); }
        }
        .snowflake {
          position: absolute;
          top: -10px;
          background: white;
          border-radius: 50%;
          pointer-events: none;
          filter: blur(1px);
        }
      `}</style>

      {/* Snowflakes Layer */}
      {snowflakes.map((snow) => (
        <div
          key={snow.id}
          className="snowflake"
          style={{
            left: `${snow.left}%`,
            width: `${snow.size}px`,
            height: `${snow.size}px`,
            opacity: snow.opacity,
            animation: `fall ${snow.duration}s linear infinite`,
            animationDelay: `${snow.delay}s`
          }}
        />
      ))}

      {/* Login Card */}
      <div className="relative z-10 w-full max-w-md px-4">
        <div className="bg-white border-4 border-gray-900 rounded-[2.5rem] shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] p-8 md:p-10">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-eco-500 text-white rounded-2xl flex items-center justify-center text-4xl mx-auto mb-4 border-4 border-gray-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rotate-3">
              <i className="fas fa-shipping-fast"></i>
            </div>
            <h2 className="text-3xl font-black text-gray-900 uppercase tracking-tighter italic">
              EcoGo <span className="text-eco-600">Logistics</span>
            </h2>
            <div className="h-1.5 w-20 bg-eco-500 mx-auto mt-2 rounded-full border border-gray-900"></div>
            <p className="text-gray-500 font-bold mt-4 text-sm uppercase tracking-widest">Hệ thống quản lý nội bộ</p>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase mb-2 ml-1 tracking-widest">Danh tính người dùng</label>
              <div className="relative">
                <span className="absolute left-4 top-3.5 text-gray-400">
                    <i className="fas fa-user-tag"></i>
                </span>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Nhập tên của bạn..."
                  className="w-full pl-11 pr-4 py-4 bg-white border-2 border-gray-900 rounded-2xl focus:ring-4 focus:ring-eco-100 outline-none transition-all font-black text-gray-900 placeholder-gray-300 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-black text-white py-5 rounded-2xl hover:bg-gray-800 font-black text-sm transition-all transform active:scale-95 shadow-[6px_6px_0px_0px_rgba(22,163,74,1)] uppercase tracking-[0.2em] flex items-center justify-center gap-3"
            >
              Bắt đầu làm việc <i className="fas fa-arrow-right"></i>
            </button>
          </form>

          <div className="mt-10 text-center">
            <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">
              Phiên bản 1.2.1 • © 2024 EcoGo Team
            </p>
          </div>
        </div>
      </div>

      {/* Decorative Bottom Gradient */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>
    </div>
  );
};

export default Login;
