import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './globals.css';

export const metadata: Metadata = {
    title: 'App Health Checker',
    description: 'Health of the apps you choose to watch',
    robots: { index: false, follow: false },
};

const themeBoot = `(function(){try{var k='app-health-checker-theme';var t=localStorage.getItem(k);var dark=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',dark);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body>
                <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
                {children}
            </body>
        </html>
    );
}
