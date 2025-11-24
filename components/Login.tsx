
import React, { useState, useEffect } from 'react';
import { storageService } from '../services/storageService';

interface Props {
  onLogin: () => void;
}

const Login: React.FC<Props> = ({ onLogin }) => {
  const [username, setUsername] = useState('');

  useEffect(() => {
     // Auto-fill last used username
     const lastUser = localStorage.getItem('ecogo_last_username');
     if (lastUser) setUsername(lastUser);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      storageService.login(username);
      // Save for next time
      localStorage.setItem('ecogo_last_username', username);
      onLogin();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md border border-gray-100">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-eco-100 text-eco-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">
            <i className="fas fa-leaf"></i>
          </div>
          <h2 className="text-2xl font-bold text-gray-800">EcoGo Logistics</h2>
          <p className="text-gray-500">Đăng nhập hệ thống quản lý</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tên nhân viên / Kho</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Nhập tên của bạn..."
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-eco-500 outline-none transition-all"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-eco-600 text-white py-3 rounded-lg hover:bg-eco-700 font-bold transition-all transform hover:-translate-y-0.5"
          >
            Vào Hệ Thống
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
