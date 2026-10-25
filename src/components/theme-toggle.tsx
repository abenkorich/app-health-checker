'use client';

import { useEffect, useState } from 'react';

const KEY = 'app-health-checker-theme';

export function ThemeToggle() {
    const [dark, setDark] = useState(false);

    useEffect(() => {
        setDark(document.documentElement.classList.contains('dark'));
    }, []);

    function toggle() {
        const next = !document.documentElement.classList.contains('dark');
        document.documentElement.classList.toggle('dark', next);
        localStorage.setItem(KEY, next ? 'dark' : 'light');
        setDark(next);
    }

    return (
        <label className="mode-switch">
            Dark
            <button
                type="button"
                role="switch"
                className={dark ? 'on' : undefined}
                aria-checked={dark}
                aria-label="Dark mode"
                onClick={toggle}
            >
                <span className="thumb" />
            </button>
        </label>
    );
}
