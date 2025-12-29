
import React, { useState, useEffect, useRef } from 'react';
import { storageService } from '../services/storageService';

// Ensure variable is recognized
declare const __APP_VERSION__: string;

interface Props {
  onLogin: () => void;
}

const Login: React.FC<Props> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  
  // --- MASCOT STATE ---
  // Head Rotation (-1 to 1)
  const [headRot, setHeadRot] = useState({ x: 0, y: 0 }); 
  // Pupil Translation (Pixels)
  const [pupilOffset, setPupilOffset] = useState({ x: 0, y: 0 }); 
  
  const [isBlinking, setIsBlinking] = useState(false);
  const [mood, setMood] = useState<'IDLE' | 'HAPPY' | 'SAD' | 'FOCUSED' | 'LOADING' | 'SLEEP'>('IDLE');
  
  const containerRef = useRef<HTMLDivElement>(null);
  const mascotRef = useRef<HTMLDivElement>(null);
  const idleTimeout = useRef<any>(null);

  // --- PHYSICS & TRACKING LOGIC ---
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!mascotRef.current) return;
      
      const rect = mascotRef.current.getBoundingClientRect();
      // Center of the mascot head
      const faceCenterX = rect.left + rect.width / 2;
      const faceCenterY = rect.top + rect.height / 2;
      
      // Vector from face center to mouse
      const dx = e.clientX - faceCenterX;
      const dy = e.clientY - faceCenterY;
      
      // 1. HEAD ROTATION (Damped)
      // Limit rotation to +/- 20 degrees effectively
      const rotX = Math.max(-1, Math.min(1, dx / (window.innerWidth / 1.5))); 
      const rotY = Math.max(-1, Math.min(1, dy / (window.innerHeight / 1.5)));
      setHeadRot({ x: rotX, y: rotY });

      // 2. PUPIL MOVEMENT (Clamped Vector)
      // Radius of the eye available for movement
      const maxR = 6; 
      const angle = Math.atan2(dy, dx);
      // Distance is proportional to mouse distance but capped at maxR
      const dist = Math.min(maxR, Math.hypot(dx, dy) / 15);
      
      setPupilOffset({
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist
      });

      resetIdle();
    };

    const resetIdle = () => {
        if (idleTimeout.current) clearTimeout(idleTimeout.current);
        if (mood === 'SLEEP') {
            setMood('IDLE');
            speak("Chào bạn!", 1.5);
        }
        if (mood !== 'FOCUSED' && mood !== 'LOADING') {
             idleTimeout.current = setTimeout(() => setMood('SLEEP'), 8000);
        }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', resetIdle);
    window.addEventListener('click', resetIdle);
    
    // Auto Blink Loop (Randomized)
    const blinkLoop = () => {
        if (mood !== 'SLEEP' && mood !== 'LOADING') {
            setIsBlinking(true);
            setTimeout(() => setIsBlinking(false), 150); // Fast blink
        }
        // Blink every 3-6 seconds
        idleTimeout.current = setTimeout(blinkLoop, Math.random() * 3000 + 3000);
    };
    const blinkTimer = setTimeout(blinkLoop, 3000);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', resetIdle);
      window.removeEventListener('click', resetIdle);
      clearTimeout(blinkTimer);
      if (idleTimeout.current) clearTimeout(idleTimeout.current);
    };
  }, [mood]);

  // Load last user
  useEffect(() => {
      const last = localStorage.getItem('ecogo_last_username');
      if (last) setUsername(last);
  }, []);

  const speak = (text: string, pitch = 1.3) => {
      if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(text);
          u.lang = 'vi-VN';
          u.rate = 1.1; 
          u.pitch = pitch;
          window.speechSynthesis.speak(u);
      }
  };

  const handleInteract = () => {
      if (mood === 'LOADING') return;
      setMood('HAPPY');
      speak("Xin chào!");
      setTimeout(() => setMood('IDLE'), 2000);
  };

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!username.trim()) {
          setMood('SAD');
          speak("Bạn chưa nhập tên.", 0.8);
          setTimeout(() => setMood('IDLE'), 2000);
          return;
      }
      setLoading(true);
      setMood('LOADING');
      speak(`Đang truy cập. Xin chào ${username}!`);
      setTimeout(() => {
          storageService.login(username);
          localStorage.setItem('ecogo_last_username', username);
          onLogin();
      }, 1500);
  };

  return (
    <div ref={containerRef} className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-100 to-emerald-50 flex flex-col items-center justify-center relative overflow-hidden font-sans select-none perspective-1000">
      
      {/* Background Ambience */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-20%] left-[-20%] w-[80vh] h-[80vh] bg-emerald-400/5 rounded-full blur-[120px] animate-pulse"></div>
          <div className="absolute bottom-[-20%] right-[-20%] w-[80vh] h-[80vh] bg-blue-400/5 rounded-full blur-[120px] animate-pulse animation-delay-2000"></div>
          {/* Grid lines for Cyberpunk feel */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_80%)]"></div>
      </div>

      <div className="relative z-10 w-full max-w-xs flex flex-col items-center gap-10">
        
        {/* === ECOBOT MASCOT V4 (High Fidelity) === */}
        <div 
            ref={mascotRef}
            className="relative w-48 h-48 cursor-pointer group" 
            onClick={handleInteract}
        >   
            {/* 1. ANTENNA (Attached to head transformation logic but with lag) */}
            <div 
                className="absolute -top-8 left-1/2 -translate-x-1/2 z-10 transition-transform duration-300 ease-out origin-bottom"
                style={{ 
                    transform: `translateX(-50%) rotate(${headRot.x * 10}deg) translateY(${mood === 'SLEEP' ? '10px' : '0'})` 
                }}
            >
                <div className="w-1.5 h-8 bg-slate-300 rounded-full mx-auto relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-slate-200 to-slate-400"></div>
                </div>
                <div className={`w-3.5 h-3.5 -mt-1 rounded-full border-2 border-white shadow-md mx-auto transition-colors duration-500 relative z-20 ${mood === 'SAD' ? 'bg-red-500 animate-pulse' : (mood === 'LOADING' ? 'bg-blue-400 animate-spin' : 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]')}`}></div>
            </div>

            {/* 2. HEAD CONTAINER (3D Rotation) */}
            <div 
                className="w-full h-full relative z-20 transition-transform duration-100 ease-out origin-center"
                style={{ 
                    transform: `rotateY(${headRot.x * 20}deg) rotateX(${-headRot.y * 15}deg) translateY(${mood === 'SLEEP' ? '15px' : '0'})` 
                }}
            >
                {/* Main Head Shell */}
                <div className="w-full h-40 bg-white rounded-[2.8rem] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.15),inset_0_-8px_20px_rgba(0,0,0,0.05),0_-2px_10px_rgba(255,255,255,0.8)] border-[3px] border-white relative overflow-hidden">
                    
                    {/* FACE SCREEN (The Black Glass) */}
                    <div className="absolute top-3 left-3 right-3 bottom-5 bg-slate-900 rounded-[2.4rem] overflow-hidden shadow-inner ring-1 ring-slate-800 flex flex-col items-center justify-center relative">
                        
                        {/* Screen Reflection (Glossy Effect) */}
                        <div className="absolute -top-[40%] -left-[40%] w-[180%] h-[180%] bg-gradient-to-br from-white/15 via-transparent to-transparent rotate-45 pointer-events-none z-30 rounded-full blur-sm"></div>

                        {/* === EYES CONTAINER === */}
                        {/* Using Flexbox ensures perfect centering relative to the face */}
                        <div className="flex gap-5 items-center justify-center w-full z-20 mt-2 transition-all duration-300">
                            
                            {/* LEFT EYE */}
                            <div className={`relative bg-slate-800/80 backdrop-blur-sm rounded-full overflow-hidden transition-all duration-300 ring-1 ring-slate-700/50
                                ${mood === 'HAPPY' ? 'h-8 w-12 rounded-t-full rounded-b-lg scale-y-75' : 
                                  mood === 'SLEEP' ? 'h-1.5 w-12 bg-slate-700 border-none opacity-50' : 
                                  'w-12 h-12'}`}
                            >
                                {/* Digital Glow (Sclera) */}
                                {mood !== 'SLEEP' && (
                                    <div className={`absolute inset-0 opacity-20 rounded-full blur-sm ${mood === 'SAD' ? 'bg-red-500' : 'bg-emerald-400 animate-pulse-slow'}`}></div>
                                )}
                                
                                {/* Pupil (The Dot) */}
                                {mood !== 'SLEEP' && !isBlinking && (
                                    <div 
                                        className={`absolute w-6 h-6 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.8)] transition-transform duration-75 ease-linear
                                            ${mood === 'SAD' ? 'bg-red-500 shadow-red-500' : 
                                              mood === 'LOADING' ? 'bg-blue-400 animate-spin rounded-sm scale-75' : 
                                              'bg-emerald-400'}`}
                                        style={{ 
                                            // Center origin
                                            top: '50%', left: '50%',
                                            marginTop: '-12px', marginLeft: '-12px', 
                                            // Apply clamped calculation
                                            transform: `translate(${mood === 'FOCUSED' ? 0 : pupilOffset.x}px, ${mood === 'FOCUSED' ? 3 : pupilOffset.y}px) scale(${mood === 'HAPPY' ? 0.8 : 1})`
                                        }}
                                    >
                                        {/* Pupil Reflection */}
                                        <div className="absolute top-1 right-1.5 w-1.5 h-1.5 bg-white rounded-full opacity-90 blur-[0.5px]"></div>
                                    </div>
                                )}
                            </div>

                            {/* RIGHT EYE */}
                            <div className={`relative bg-slate-800/80 backdrop-blur-sm rounded-full overflow-hidden transition-all duration-300 ring-1 ring-slate-700/50
                                ${mood === 'HAPPY' ? 'h-8 w-12 rounded-t-full rounded-b-lg scale-y-75' : 
                                  mood === 'SLEEP' ? 'h-1.5 w-12 bg-slate-700 border-none opacity-50' : 
                                  'w-12 h-12'}`}
                            >
                                {mood !== 'SLEEP' && (
                                    <div className={`absolute inset-0 opacity-20 rounded-full blur-sm ${mood === 'SAD' ? 'bg-red-500' : 'bg-emerald-400 animate-pulse-slow'}`}></div>
                                )}
                                {mood !== 'SLEEP' && !isBlinking && (
                                    <div 
                                        className={`absolute w-6 h-6 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.8)] transition-transform duration-75 ease-linear
                                            ${mood === 'SAD' ? 'bg-red-500 shadow-red-500' : 
                                              mood === 'LOADING' ? 'bg-blue-400 animate-spin rounded-sm scale-75' : 
                                              'bg-emerald-400'}`}
                                        style={{ 
                                            top: '50%', left: '50%',
                                            marginTop: '-12px', marginLeft: '-12px',
                                            transform: `translate(${mood === 'FOCUSED' ? 0 : pupilOffset.x}px, ${mood === 'FOCUSED' ? 3 : pupilOffset.y}px) scale(${mood === 'HAPPY' ? 0.8 : 1})`
                                        }}
                                    >
                                        <div className="absolute top-1 right-1.5 w-1.5 h-1.5 bg-white rounded-full opacity-90 blur-[0.5px]"></div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* MOUTH (Dynamic SVG or Div) */}
                        <div className="h-8 flex items-center justify-center w-full z-20 mt-3">
                            <div className={`transition-all duration-300 
                                ${mood === 'HAPPY' ? 'w-6 h-3 border-b-[3px] border-slate-500 rounded-b-full' : 
                                  mood === 'SAD' ? 'w-6 h-3 border-t-[3px] border-slate-500 rounded-t-full mt-2' : 
                                  mood === 'SLEEP' ? 'w-2 h-2 rounded-full bg-slate-700 animate-pulse' :
                                  mood === 'LOADING' ? 'w-8 h-2 rounded-full border border-slate-600 animate-pulse bg-slate-800' :
                                  username.length > 0 ? 'w-3 h-1.5 bg-emerald-500/50 rounded-full shadow-[0_0_5px_rgba(16,185,129,0.5)]' :
                                  'w-2 h-1 bg-slate-600 rounded-full'
                                }`}
                            ></div>
                        </div>

                        {/* SLEEP Zzz */}
                        {mood === 'SLEEP' && (
                            <div className="absolute top-4 right-6 font-black text-slate-500 text-[10px] animate-float-sleep">Zzz</div>
                        )}
                    </div>
                </div>
            </div>

            {/* 3. HANDS (Relative to Container but float differently) */}
            <div className={`absolute top-28 -left-4 w-9 h-11 bg-white rounded-full border-2 border-gray-100 shadow-lg transition-all duration-500 ease-elastic origin-top-right z-30 
                ${mood === 'HAPPY' ? '-rotate-[140deg] -translate-y-8' : 
                  mood === 'SAD' ? 'rotate-[-30deg] translate-y-2' : 
                  mood === 'FOCUSED' ? 'rotate-[40deg] translate-x-6 -translate-y-4' :
                  'rotate-[10deg] animate-sway-left'}`}
            ></div>
            <div className={`absolute top-28 -right-4 w-9 h-11 bg-white rounded-full border-2 border-gray-100 shadow-lg transition-all duration-500 ease-elastic origin-top-left z-30 
                ${mood === 'HAPPY' ? 'rotate-[140deg] -translate-y-8' : 
                  mood === 'SAD' ? '-rotate-[30deg] translate-y-2' : 
                  mood === 'FOCUSED' ? '-rotate-[40deg] -translate-x-6 -translate-y-4' :
                  '-rotate-[10deg] animate-sway-right'}`}
            ></div>

            {/* 4. SHADOW (Grounding) */}
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-24 h-4 bg-black/10 blur-md rounded-[100%] animate-shadow-pulse"></div>
        </div>

        {/* === LOGIN CARD === */}
        <div className="w-full bg-white/70 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/60 p-8 relative overflow-hidden group hover:shadow-emerald-200/40 transition-all duration-500">
            
            <div className="text-center mb-8">
                <h2 className="text-3xl font-black text-slate-800 tracking-tighter uppercase italic">EcoGo <span className="text-emerald-500">Logistics</span></h2>
                <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-[0.2em]">Hệ thống quản lý thông minh</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
                <div className="group/input">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4 mb-2 block transition-colors group-focus-within/input:text-emerald-600">Tên hiển thị</label>
                    <div className="relative transform transition-all duration-300 group-focus-within/input:scale-[1.02]">
                        <input 
                            type="text" 
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            onFocus={() => { setMood('FOCUSED'); setIsBlinking(false); }}
                            onBlur={() => setMood('IDLE')}
                            className="w-full pl-5 pr-12 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-slate-800 text-sm placeholder:text-slate-300 focus:bg-white focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50/50 transition-all shadow-inner"
                            placeholder="Nhập tên của bạn..."
                            disabled={loading}
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 transition-colors duration-300">
                            {username ? <i className="fas fa-check-circle text-emerald-500 text-lg animate-in zoom-in"></i> : <i className="fas fa-user-astronaut text-slate-300 text-lg"></i>}
                        </div>
                    </div>
                </div>

                <button 
                    type="submit"
                    disabled={loading}
                    onMouseEnter={() => !loading && setMood('HAPPY')}
                    onMouseLeave={() => !loading && setMood('IDLE')}
                    className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-slate-200 hover:bg-black hover:shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-3 group/btn relative overflow-hidden"
                >
                    {loading ? (
                        <>
                            <i className="fas fa-circle-notch fa-spin"></i>
                            <span>Đang truy cập...</span>
                        </>
                    ) : (
                        <>
                            <span>Bắt đầu phiên làm việc</span>
                            <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-slate-900 group-hover/btn:rotate-90 transition-transform">
                                <i className="fas fa-arrow-right text-[10px]"></i>
                            </div>
                        </>
                    )}
                </button>
            </form>
        </div>

        {/* Footer */}
        <div className="text-[9px] font-bold text-slate-400 text-center opacity-60 uppercase tracking-wider">
            Powered by Gemini AI • v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '4.0'}
        </div>

      </div>

      <style>{`
        @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-8px); }
        }
        @keyframes sway-left {
            0%, 100% { transform: rotate(10deg); }
            50% { transform: rotate(15deg); }
        }
        @keyframes sway-right {
            0%, 100% { transform: rotate(-10deg); }
            50% { transform: rotate(-15deg); }
        }
        @keyframes pulse-slow {
            0%, 100% { opacity: 0.1; }
            50% { opacity: 0.3; }
        }
        @keyframes float-sleep {
            0% { opacity: 0; transform: translate(0, 0) scale(0.5); }
            50% { opacity: 1; transform: translate(5px, -10px) scale(1); }
            100% { opacity: 0; transform: translate(10px, -20px) scale(1.2); }
        }
        @keyframes shadow-pulse {
            0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.1; }
            50% { transform: translateX(-50%) scale(0.85); opacity: 0.05; }
        }
        .animate-float { animation: float 5s ease-in-out infinite; }
        .animate-sway-left { animation: sway-left 4s ease-in-out infinite; }
        .animate-sway-right { animation: sway-right 4.5s ease-in-out infinite; }
        .animate-pulse-slow { animation: pulse-slow 3s infinite; }
        .animate-float-sleep { animation: float-sleep 2.5s infinite; }
        .animate-shadow-pulse { animation: shadow-pulse 5s ease-in-out infinite; }
        .perspective-1000 { perspective: 1000px; }
        .animation-delay-2000 { animation-delay: 2s; }
        .ease-elastic { transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1); }
      `}</style>
    </div>
  );
};

export default Login;
