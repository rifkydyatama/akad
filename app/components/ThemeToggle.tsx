"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<string>(() => typeof window !== 'undefined' ? (localStorage.getItem('theme') || 'light') : 'light');

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (theme === 'dark') document.documentElement.classList.add('theme-dark');
    else document.documentElement.classList.remove('theme-dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <button aria-label="Toggle theme" className="theme-toggle" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        {theme === 'dark' ? (
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" fill="currentColor" />
        ) : (
          <path d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42M12 7a5 5 0 100 10 5 5 0 000-10z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
